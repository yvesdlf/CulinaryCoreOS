-- ---------------------------------------------------------------------------
-- What an hour of work costs
-- ---------------------------------------------------------------------------
-- Gap 9, and decision D1. Hours have been recorded properly since 0043 —
-- clocked in, clocked out, breaks, corrections, geofence and all — and there
-- has been nowhere to put a wage. So there is no labour cost, so there is no
-- profit figure for anything, so the question every one of these screens exists
-- to answer stops one step short.
--
-- ## The decision this was waiting on, and why it stopped waiting
--
-- D1 asks whether the platform should know what people are paid. It is a real
-- question — a rate is the most sensitive figure a venue holds — and it was
-- unanswered. What is built here is the reversible middle: rates held **for
-- calculating cost only**. No payslips, no payments, no tax, no filing, and
-- nothing that makes this a payroll system. If the answer turns out to be
-- "hours only, keep pay out of it", the table stays empty and every other
-- screen behaves exactly as it does today. That property is what made it safe
-- to build before the answer arrived.
--
-- ## Four positions
--
-- **A rate is a period, and periods are append-only.** `effective_from` and no
-- end date: the rate in force on a day is the latest row starting on or before
-- it. Ending a rate is writing the next one. This is the only shape in which
-- "last month stays calculated at last month's rate" is true by construction
-- rather than by everybody remembering to be careful — and recalculating a
-- closed month at today's rate is the single most expensive thing a system
-- like this can do quietly.
--
-- **A rate already in force cannot be edited. One not yet in force can.** The
-- compromise the append-only rule needs to survive contact with typing. A rate
-- starting next month is a plan and may be corrected; a rate that has been in
-- force since March has been used to cost March, and changing it rewrites a
-- figure somebody has already acted on. Correcting that is superseding it from
-- a new date, which leaves both rows and says what happened.
--
-- **Hourly and monthly are different facts, not one number with a flag.** A
-- porter paid by the hour costs nothing on a day they do not work. A salaried
-- head chef costs the same whether the kitchen is busy or shut. Collapsing
-- the two into "an hourly equivalent" makes the second one wrong on exactly
-- the days anybody cares about, and the error is invisible because the figure
-- still looks like money.
--
-- **Its own section in the access grid.** Not People. Somebody who manages the
-- rota, approves leave and keeps certificates up to date has no business
-- seeing what their colleagues earn, and every venue seen so far draws that
-- line in the same place. `PAY` is a separate grant, and nobody has it by
-- default — not even an ADMIN, who gets WRITE on everything else.
--
-- ## Not scopable by business unit, deliberately
--
-- 0062 lets a grant name one department. A rate is a fact about a *person*,
-- and a person transfers between departments: a grant scoped to the kitchen
-- would silently gain and lose rows as people moved, so what somebody could
-- see would depend on where a colleague happened to be filed this week.
-- Access to pay is a venue-level trust or it is not a trust at all.
-- ---------------------------------------------------------------------------

create type pay_basis as enum (
  'HOURLY',   -- Costs what is worked. Most of a venue.
  'MONTHLY'   -- Costs the same whether they work or not. Salaried.
);

create table if not exists pay_rates (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,

  basis pay_basis not null,

  /*
   * numeric, because it is money. The organisation's own currency; there is
   * one per venue and `organizations.currency_code` holds it, so a currency
   * column here would be a second place for it to be wrong.
   */
  amount numeric(18,5) not null check (amount >= 0),

  /*
   * The day it starts. No end date: the next row ends it.
   *
   * An end date is a second place to say the same thing, and the two disagree
   * the first time somebody sets one and forgets the other — which produces a
   * day with two rates in force, or none, and either way a labour cost that is
   * wrong without being obviously wrong.
   */
  effective_from date not null,

  note text,

  set_by_id uuid references auth.users(id) on delete set null,
  set_by_email text,
  created_at timestamptz not null default now(),

  -- One rate per person per day it starts. Two rows starting the same morning
  -- is a question with no answer.
  constraint pay_rates_one_per_day unique (employee_id, effective_from)
);

create index if not exists idx_pay_rates_employee
  on pay_rates(employee_id, effective_from desc);
create index if not exists idx_pay_rates_org on pay_rates(org_id, effective_from desc);

/*
 * The rate is filed under the person's own venue, and names who set it.
 *
 * Both taken from the row and the session rather than from the client, which
 * is the fix 0054 had to make twice: a figure filed under a colleague's name
 * reads as a fact about that colleague.
 */
create or replace function public.enforce_pay_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  staff_org uuid;
  caller_email text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  select e.org_id into staff_org from public.employees e where e.id = new.employee_id;
  if staff_org is null then
    raise exception 'there is no such employee to set a rate for';
  end if;
  new.org_id := staff_org;

  if caller_email is not null then
    new.set_by_email := caller_email;
    new.set_by_id := auth.uid();
  elsif coalesce(btrim(new.set_by_email), '') = '' then
    raise exception 'a pay rate must record who set it';
  end if;

  return new;
end;
$$;

create trigger pay_rates_enforce
  before insert on pay_rates
  for each row execute function public.enforce_pay_rate();

/*
 * A rate that has already taken effect does not move.
 *
 * The edit window is strictly the future: a rate starting tomorrow is a plan,
 * a rate starting today has been in force for the whole of today and may have
 * costed a shift already. OLD and NEW are both checked, so a rate cannot be
 * dragged backwards into the past either — which is the same escape 0062's
 * section guard had to close for units, in a different table.
 */
create or replace function public.refuse_backdated_pay_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  if old.effective_from <= current_date then
    raise exception 'that rate has been in force since % and cannot be changed',
      to_char(old.effective_from, 'FMDD Month YYYY')
      using hint = 'Set a new rate from a future date instead. Both stay on the record.';
  end if;

  if tg_op = 'UPDATE' and new.effective_from <= current_date then
    raise exception 'a rate cannot be moved to a date that has already passed'
      using hint = 'The cost of a day that has already happened is already settled.';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger pay_rates_no_backdating
  before update or delete on pay_rates
  for each row execute function public.refuse_backdated_pay_change();

-- ── Who may see it ──────────────────────────────────────────────────────────

insert into app_sections (code, name, description, sort_order, is_core)
values ('PAY', 'Pay', 'What people are paid, for costing labour. Granted separately from People.', 95, false)
on conflict (code) do nothing;

/*
 * Nobody gets this by default, including an ADMIN.
 *
 * `seed_member_access` gives an ADMIN WRITE on every section, which is right
 * for every section that existed when it was written and wrong for this one.
 * Rather than rewrite that function — the mistake 0060 made and 0062 had to
 * clean up after — the default is removed here for the one section it is wrong
 * for, and `seed_member_access` is left to keep saying what it says.
 */
create or replace function public.seed_member_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  lvl public.access_level;
begin
  if new.role = 'OWNER' then
    return new;
  end if;

  for s in select code from public.app_sections loop
    lvl := case
      -- Pay is granted by a person, never by a role. See 0064.
      when s.code = 'PAY' then 'NONE'::public.access_level
      when new.role = 'ADMIN' then 'WRITE'::public.access_level
      when new.role = 'CHEF' then
        case
          when s.code = 'ADMIN' then 'NONE'::public.access_level
          when s.code = 'PARAMETERS' then 'READ'::public.access_level
          else 'WRITE'::public.access_level
        end
      else
        case
          when s.code in ('ADMIN', 'HR_CASES') then 'NONE'::public.access_level
          else 'READ'::public.access_level
        end
    end;

    if lvl <> 'NONE' then
      insert into public.member_access (org_id, user_id, section_code, level)
      values (new.organization_id, new.user_id, s.code, lvl)
      on conflict (org_id, user_id, section_code) where business_unit_id is null
        do nothing;
    end if;
  end loop;
  return new;
end;
$$;

alter table pay_rates enable row level security;

/*
 * Read needs the grant, not merely membership. Every other table in this
 * schema is readable by anybody in the venue and narrowed on write; this one
 * is narrowed on read, because the harm here is in the looking.
 */
create policy pay_rates_read on pay_rates
  for select to authenticated
  using (public.can_read_section('PAY', org_id, null::uuid));
create policy pay_rates_insert on pay_rates
  for insert to authenticated
  with check (public.can_write_section('PAY', org_id, null::uuid));
create policy pay_rates_update on pay_rates
  for update to authenticated
  using (public.can_write_section('PAY', org_id, null::uuid))
  with check (public.can_write_section('PAY', org_id, null::uuid));
create policy pay_rates_delete on pay_rates
  for delete to authenticated
  using (public.can_write_section('PAY', org_id, null::uuid));

grant select, insert, update, delete on pay_rates to authenticated;

create trigger pay_rates_section_guard
  before insert or update or delete on pay_rates
  for each row execute function public.require_section_write('PAY');

-- ── What it costs ───────────────────────────────────────────────────────────

/*
 * The rate in force for one person on one day, or nothing.
 *
 * Nothing is a real answer and is never coerced to zero: "nobody has set a
 * rate" and "they cost nothing" are different statements, and a labour cost
 * that reads the first as the second is a profit figure that is too good by
 * exactly the wages of everybody nobody got round to entering.
 *
 * SECURITY INVOKER, so the policy above decides. A costing function that could
 * see rates its caller cannot would be the leak, dressed as an aggregate.
 */
create or replace function public.pay_rate_on(p_employee uuid, p_day date)
returns table (basis public.pay_basis, amount numeric)
language sql
stable
set search_path = ''
as $$
  select r.basis, r.amount
    from public.pay_rates r
   where r.employee_id = p_employee
     and r.effective_from <= p_day
   order by r.effective_from desc
   limit 1;
$$;

grant execute on function public.pay_rate_on(uuid, date) to authenticated;

/*
 * What a day of work cost, per person per unit.
 *
 * Hourly: hours actually worked, less breaks, times the rate in force that
 * day. Salaried: the month's figure divided by the days in that month, on
 * every day they were employed — which is what a salary is, and is why it
 * appears on days nobody clocked in.
 *
 * `security_invoker`, so a caller without Pay sees nothing here rather than an
 * aggregate they could difference back to a rate.
 *
 * The unit is the employee's, taken at read time rather than from the shift.
 * That is a real limitation and not an oversight: a person who transfers in
 * June has their May cost attributed to the department they are in today. The
 * fix is a unit on the time entry, which is a bigger change than this and is
 * not worth making until somebody asks a question it would answer.
 */
create or replace view labour_cost_daily with (security_invoker = true) as
  with worked as (
    select
      t.org_id,
      t.employee_id,
      (t.clock_in_at at time zone 'UTC')::date as on_date,
      sum(
        greatest(
          extract(epoch from (t.clock_out_at - t.clock_in_at)) / 3600.0
            - (t.break_minutes / 60.0),
          0)
      ) as hours
    from public.time_entries t
    where t.clock_out_at is not null
    group by 1, 2, 3
  )
  select
    w.org_id,
    w.employee_id,
    e.business_unit_id,
    w.on_date,
    round(w.hours::numeric, 3) as hours,
    r.basis,
    r.amount as rate,
    case r.basis
      when 'HOURLY' then round((w.hours * r.amount)::numeric, 2)
      when 'MONTHLY' then round(
        (r.amount / extract(day from (date_trunc('month', w.on_date)
          + interval '1 month - 1 day')))::numeric, 2)
    end as cost
  from worked w
  join public.employees e on e.id = w.employee_id
  left join lateral public.pay_rate_on(w.employee_id, w.on_date) r on true
  /*
   * And nothing at all without the grant.
   *
   * `security_invoker` already hides the rates — `pay_rate_on` reads
   * `pay_rates`, whose policy answers — so without this a caller with People
   * and no Pay saw a row per person per day with the cost column null. No
   * figure leaked, and it was still wrong twice over: a labour cost report
   * that lists everybody and costs nobody reads as "nobody is paid" rather
   * than "you may not see this", and the day somebody adds a total to this
   * view the null column becomes a real one.
   */
  where public.can_read_section('PAY', w.org_id, null::uuid);

grant select on labour_cost_daily to authenticated;

comment on table pay_rates is
  'Append-only periods. The rate in force on a day is the latest row starting on or before it.';
comment on column pay_rates.effective_from is
  'No end date on purpose: the next row ends this one, so a day cannot have two rates or none.';
comment on function public.pay_rate_on(uuid, date) is
  'The rate in force, or nothing. Nothing is never read as zero.';
comment on view labour_cost_daily is
  'What a day of work cost. Hourly pays for hours; salary costs the same whether they worked or not.';
