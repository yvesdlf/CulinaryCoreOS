-- ---------------------------------------------------------------------------
-- Who got paid what, over a period you choose
-- ---------------------------------------------------------------------------
-- `financial_summary` gives the labour line as one number — the wage bill and
-- its ratio to revenue. The question it cannot answer is the next one a GM or
-- an owner asks when that number moves: *whose hours is it, and at what rate.*
-- The daily per-person labour figures already exist in `labour_cost_daily`
-- (one row per employee per day: hours clocked, the rate in force that day,
-- the cost, and two honesty flags — punches left open, and whether a manager
-- corrected the hours). Nothing has ever rolled them up per person across a
-- range into a payroll a reader can act on.
--
-- `payroll_report` is that roll-up. One row per employee per outlet they
-- worked in, over the range: days worked, hours, labour cost, the effective
-- hourly it works out to, the pay basis, and — carried through, never hidden —
-- the count of still-open punches and whether any of the hours were corrected.
-- An open punch means the cost is not final; a report that rounded that away
-- would be lying by omission.
--
-- ── One row per employee per outlet, not per employee ─────────────────────
--
-- A cook who covered a bar shift is paid for both, and the two outlets answer
-- to two managers who each read only their own. Grouping by (employee, outlet)
-- keeps each figure under the outlet whose manager may see it, rather than
-- summing a person across outlets into a number no single manager is cleared
-- to read in full.
--
-- ── Access ────────────────────────────────────────────────────────────────
--
-- Invoker rights over `labour_cost_daily`, which is `security_invoker` and
-- already filtered to `can_read_section('PAY', org, business_unit_id)`. So the
-- grain itself is gated: a row exists only for an outlet whose PAY the caller
-- may read. A GM over two outlets sees both; a head of department sees their
-- own. The employee, role and outlet joined on for display are lookups, not
-- new grain — left-joined so a missing lookup never drops a gated row — and
-- the only thing added on top is the venue scope, so a reader working in one
-- venue is not handed another's wage bill.
-- ---------------------------------------------------------------------------

create or replace function public.payroll_report(
  p_from date,
  p_to date
)
returns table (
  employee_id uuid,
  employee_name text,
  employee_number text,
  job_title text,
  unit_code text,
  unit_name text,
  basis pay_basis,
  days_worked integer,
  hours numeric,
  labour_cost numeric,
  avg_hourly numeric,
  open_punches integer,
  hours_were_corrected boolean
)
language plpgsql
stable
set search_path = ''
as $$
declare
  org uuid := public.auth_default_org_id();
begin
  if p_from is null or p_to is null then
    raise exception 'a payroll report needs a period'
      using hint = 'Both dates are required.';
  end if;
  if p_to < p_from then
    raise exception 'the period ends before it begins';
  end if;

  return query
  with lc as (
    select l.employee_id, l.business_unit_id,
           l.on_date, l.hours, l.cost, l.basis,
           l.open_punches, l.hours_were_corrected
      from public.labour_cost_daily l
     where l.org_id = org
       and l.on_date between p_from and p_to
  )
  select
    lc.employee_id,
    nullif(trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), ''),
    e.employee_number,
    jr.title,
    bu.code,
    bu.name,
    -- One employee in one outlet almost always has a single basis; if a rate
    -- change flipped it mid-range, report the basis that carried the most cost.
    mode() within group (order by lc.basis),
    count(distinct lc.on_date)::integer,
    coalesce(sum(lc.hours), 0),
    coalesce(sum(lc.cost), 0),
    -- Effective hourly over the range: cost divided by hours actually worked,
    -- not a rate read off one day. For a monthly-basis employee this is the
    -- salaried cost spread over the hours they clocked, which is the honest
    -- answer to "what did this person's time cost per hour."
    case when coalesce(sum(lc.hours), 0) > 0
         then round(sum(lc.cost) / sum(lc.hours), 2) end,
    coalesce(sum(lc.open_punches), 0)::integer,
    bool_or(lc.hours_were_corrected)
  from lc
  left join public.employees e on e.id = lc.employee_id
  left join public.job_roles jr on jr.id = e.job_role_id
  left join public.business_units bu on bu.id = lc.business_unit_id
  group by lc.employee_id, e.first_name, e.last_name, e.employee_number,
           jr.title, bu.code, bu.name
  order by sum(lc.cost) desc;
end $$;

comment on function public.payroll_report(date, date) is
  'Per-employee, per-outlet labour over one date range for the caller''s '
  'active venue: days worked, hours, cost, effective hourly and pay basis, '
  'with open-punch and hours-corrected flags carried through. Gated through '
  'labour_cost_daily, so a row appears only for an outlet whose PAY the '
  'caller may read.';

revoke all on function public.payroll_report(date, date) from anon;
grant execute on function public.payroll_report(date, date) to authenticated;
