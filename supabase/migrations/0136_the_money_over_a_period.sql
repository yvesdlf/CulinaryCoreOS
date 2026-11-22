-- ---------------------------------------------------------------------------
-- The money, over a period you choose
-- ---------------------------------------------------------------------------
-- The reports CCOS already has each answer one question — the margin trend,
-- the labour ratio, the cost of goods. What the venue has never had is the
-- one thing a Simphony dashboard leads with and an owner asks first: *how is
-- this period doing against the last one, and against the same stretch a year
-- ago.* The figures all exist in `unit_profit_daily` (a full daily P&L per
-- outlet); nothing has ever summed them across an arbitrary range and set two
-- ranges side by side.
--
-- `financial_summary` is that sum, for one range. It returns net and gross
-- revenue, covers and average spend, labour (hours, cost, and cost as a
-- percent of net), goods and waste cost, and gross profit with its percent —
-- plus two honesty columns the dashboard must carry through: the goods cost
-- that could not be attributed to an outlet, and the number of distinct days
-- in the range that actually had data.
--
-- ── One range, called three times, not three ranges in one call ───────────
--
-- The comparison a dashboard shows — this period, the period before it, the
-- same period last year — needs three date ranges, and the rule for "the same
-- period last year" is not obvious: 52 weeks for a day or a week, the same
-- calendar month for a month. That rule already lives in one tested place,
-- the front-end period engine (`periods.ts`, `sameTimeLastYear`). Re-deriving
-- it in SQL would be the `venue_date()` mistake again: two derivations of the
-- same thing, free to drift. So this function aggregates a single range and
-- the caller asks three times with ranges the engine computed. The variance
-- between them is arithmetic the front end unit-tests.
--
-- ── Access ────────────────────────────────────────────────────────────────
--
-- Invoker rights over `unit_profit_daily`, which is `security_invoker` and
-- built from tables gated on REVENUE (takings), PAY (labour) and the recipe
-- sections (goods). A reader with REVENUE but not PAY sees revenue and no
-- labour, exactly as the view already decides — this function inherits that
-- and adds only the venue scope, so a reader in two venues gets the one they
-- are working in rather than both summed together.
-- ---------------------------------------------------------------------------

create or replace function public.financial_summary(
  p_from date,
  p_to date
)
returns table (
  net_revenue numeric,
  gross_revenue numeric,
  covers numeric,
  avg_spend numeric,
  labour_hours numeric,
  labour_cost numeric,
  labour_percent numeric,
  goods_cost numeric,
  waste_cost numeric,
  gross_profit numeric,
  gross_profit_percent numeric,
  unattributed_goods_cost numeric,
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
    raise exception 'a financial summary needs a period'
      using hint = 'Both dates are required.';
  end if;
  if p_to < p_from then
    raise exception 'the period ends before it begins';
  end if;

  return query
  with d as (
    select u.on_date, u.revenue_net, u.revenue_gross, u.covers,
           u.labour_hours, u.labour_cost, u.goods_cost, u.waste_cost,
           u.gross_profit, u.unattributed_goods_cost
      from public.unit_profit_daily u
     where u.org_id = org
       and u.on_date between p_from and p_to
  )
  select
    coalesce(sum(d.revenue_net), 0),
    coalesce(sum(d.revenue_gross), 0),
    coalesce(sum(d.covers), 0),
    -- Average spend is net over covers, not a sum of per-day averages: a
    -- quiet Tuesday must not weigh as much as a full Saturday.
    case when coalesce(sum(d.covers), 0) > 0
         then round(sum(d.revenue_net) / sum(d.covers), 2) end,
    coalesce(sum(d.labour_hours), 0),
    coalesce(sum(d.labour_cost), 0),
    case when coalesce(sum(d.revenue_net), 0) > 0
         then round(sum(d.labour_cost) / sum(d.revenue_net) * 100, 1) end,
    coalesce(sum(d.goods_cost), 0),
    coalesce(sum(d.waste_cost), 0),
    coalesce(sum(d.gross_profit), 0),
    case when coalesce(sum(d.revenue_net), 0) > 0
         then round(sum(d.gross_profit) / sum(d.revenue_net) * 100, 1) end,
    coalesce(sum(d.unattributed_goods_cost), 0),
    count(distinct d.on_date)::integer
  from d;
end $$;

comment on function public.financial_summary(date, date) is
  'The venue P&L summed over one date range, for the caller''s active venue: '
  'revenue, covers, labour, goods, gross profit, with the unattributed goods '
  'cost and the count of days that had data. Called once per range; the '
  'period-over-period and year-ago comparison is assembled by the caller from '
  'ranges the period engine computes.';

revoke all on function public.financial_summary(date, date) from anon;
grant execute on function public.financial_summary(date, date) to authenticated;
