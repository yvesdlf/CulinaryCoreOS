-- ---------------------------------------------------------------------------
-- What an hour of labour earned — the honest "sales per head"
-- ---------------------------------------------------------------------------
-- "Sales per staff" is the number a GM wants and the one the data cannot give
-- literally: takings are recorded per outlet, not per server, so there is no
-- true row that says *this waiter sold that much*. Inventing one — splitting an
-- outlet's till evenly across whoever clocked in — would be a figure that
-- looks per-person and means nothing, the kind of number this system refuses
-- to print. What the data *can* answer honestly is the question underneath it:
-- how hard is each hour of labour working? Revenue and covers per labour hour,
-- and how many rupiah of sales each rupiah of wages brought in.
--
-- `labour_productivity` is that, per outlet, over a range. The money, covers
-- and hours come from `unit_profit_daily` (the daily P&L per outlet); the head
-- count — how many people those hours were spread across — comes from
-- `labour_cost_daily`. Per hour and per wage-rupiah are left null when there
-- were no hours or no wage to divide by, never shown as zero or infinity: a
-- quiet outlet with no one clocked on has no productivity to report, which is
-- not the same as a productivity of nothing.
--
-- ── Two gated sources, one grain ──────────────────────────────────────────
--
-- `unit_profit_daily` is `security_invoker` and gated on REVENUE and PAY (and
-- the recipe sections); `labour_cost_daily` is gated on PAY. A reader with
-- REVENUE but not PAY sees the revenue and null hours — so per-hour comes back
-- null rather than leaking a wage they may not read. The head count is a
-- left-joined lookup on the already-gated revenue grain, so it never adds an
-- outlet the caller could not otherwise see, and the only thing added on top
-- is the venue scope.
-- ---------------------------------------------------------------------------

create or replace function public.labour_productivity(
  p_from date,
  p_to date
)
returns table (
  unit_code text,
  unit_name text,
  net_revenue numeric,
  covers numeric,
  labour_hours numeric,
  labour_cost numeric,
  people integer,
  revenue_per_hour numeric,
  covers_per_hour numeric,
  sales_to_labour numeric,
  days_with_data integer
)
language plpgsql
stable
set search_path = ''
as $$
declare
  org uuid := public.auth_default_org_id();
begin
  if p_from is null or p_to is null then
    raise exception 'a productivity report needs a period'
      using hint = 'Both dates are required.';
  end if;
  if p_to < p_from then
    raise exception 'the period ends before it begins';
  end if;

  return query
  with u as (
    select d.business_unit_id, d.unit_code, d.unit_name,
           sum(d.revenue_net) as net_revenue,
           sum(d.covers)      as covers,
           sum(d.labour_hours) as labour_hours,
           sum(d.labour_cost)  as labour_cost,
           count(distinct d.on_date) as days_with_data
      from public.unit_profit_daily d
     where d.org_id = org
       and d.on_date between p_from and p_to
     group by d.business_unit_id, d.unit_code, d.unit_name
  ),
  heads as (
    select l.business_unit_id, count(distinct l.employee_id) as people
      from public.labour_cost_daily l
     where l.org_id = org
       and l.on_date between p_from and p_to
     group by l.business_unit_id
  )
  select
    u.unit_code,
    u.unit_name,
    coalesce(u.net_revenue, 0),
    coalesce(u.covers, 0)::numeric,
    coalesce(u.labour_hours, 0),
    coalesce(u.labour_cost, 0),
    coalesce(h.people, 0)::integer,
    -- Per hour and per wage-rupiah: null when there is nothing to divide by,
    -- so a quiet outlet reads as "no hours" rather than a false zero or a
    -- division by nothing.
    case when coalesce(u.labour_hours, 0) > 0
         then round(u.net_revenue / u.labour_hours, 2) end,
    case when coalesce(u.labour_hours, 0) > 0
         then round(u.covers::numeric / u.labour_hours, 2) end,
    case when coalesce(u.labour_cost, 0) > 0
         then round(u.net_revenue / u.labour_cost, 2) end,
    u.days_with_data::integer
  from u
  left join heads h on h.business_unit_id = u.business_unit_id
  order by u.net_revenue desc nulls last;
end $$;

comment on function public.labour_productivity(date, date) is
  'Per-outlet labour productivity over one date range for the caller''s active '
  'venue: revenue, covers, hours, wage bill, head count, and revenue/covers '
  'per labour hour plus sales per wage-rupiah — the honest answer to "sales '
  'per staff", which the data cannot give literally. Gated through '
  'unit_profit_daily (REVENUE+PAY); per-hour is null without the hours to '
  'divide by.';

revoke all on function public.labour_productivity(date, date) from anon;
grant execute on function public.labour_productivity(date, date) to authenticated;
