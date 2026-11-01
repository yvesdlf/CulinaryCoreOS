-- ---------------------------------------------------------------------------
-- A trend that says how much of each period is real
-- ---------------------------------------------------------------------------
-- Every costing figure in this system is a snapshot or a single period. There
-- is no way to ask whether food cost is drifting, whether labour crept up
-- after a rota change, or whether last month was better than the one before
-- — which is most of what somebody opens a reporting screen to find out.
--
-- Aggregating days into weeks and months is the easy half. The half that
-- makes a trend trustworthy is saying how complete each bucket is, and it is
-- the half that gets left out.
--
-- A month that is four days old shows a quarter of a month's revenue. Put
-- that bar beside last month's and the chart says the venue has collapsed.
-- Somebody acts on it. The figure was never wrong — the comparison was — and
-- nothing on the chart admitted that the last bar was still being written.
--
-- So every bucket carries three facts about itself rather than one number:
--
--   `is_open` — the period has not finished yet. Today's week and today's
--   month are open almost every time anybody looks.
--
--   `days_with_data` against `days_in_period` — a month with six days of
--   takings in it is not a month, whether or not the month has ended. A
--   venue that started recording halfway through August has an August that
--   looks like a catastrophe.
--
--   `previous_*` — the same measure one period back, so "up or down" is a
--   column rather than something a screen computes by looking two rows up.
--   A screen that did that arithmetic itself would be a second place for it
--   to be wrong, and this one knows which buckets are comparable.
--
-- The comparison is deliberately not suppressed for an open period. Hiding
-- it would stop somebody checking on the month so far, which is a reasonable
-- thing to want. It is labelled instead, and the screen refuses to draw a
-- change figure against a period it has told you is incomplete.
-- ---------------------------------------------------------------------------

/*
 * Weeks start on Monday, which is `date_trunc`'s own answer and also the
 * rota's. A venue whose week starts on another day gets a bucket boundary
 * that disagrees with its roster, which is worth knowing about rather than
 * configuring away before anybody has asked.
 */
create or replace function public.profit_trend(
  p_from date,
  p_to date,
  p_grain text default 'week',
  p_unit uuid default null
)
returns table (
  period_start date,
  period_end date,
  grain text,
  revenue_net numeric,
  labour_cost numeric,
  goods_cost numeric,
  waste_cost numeric,
  gross_profit numeric,
  gross_profit_percent numeric,
  labour_percent_of_net numeric,
  covers bigint,
  days_in_period integer,
  days_with_data integer,
  is_open boolean,
  previous_revenue_net numeric,
  previous_gross_profit_percent numeric
)
language plpgsql
stable
set search_path = ''
as $$
begin
  /*
   * Whitelisted rather than passed through to `date_trunc`. The grain
   * arrives from a dropdown today and from whatever calls this tomorrow,
   * and `date_trunc` accepts 'microseconds' perfectly happily — a bucket
   * per microsecond over ten weeks is not a report, it is an outage.
   */
  if p_grain not in ('day', 'week', 'month', 'quarter', 'year') then
    raise exception 'a trend cannot be bucketed by %', p_grain
      using hint = 'Use day, week, month, quarter or year.';
  end if;

  return query
  with daily as (
    select
      d.on_date,
      d.revenue_net,
      d.labour_cost,
      d.goods_cost,
      d.waste_cost,
      d.gross_profit,
      d.covers
    from public.unit_profit_daily d
    where d.on_date between p_from and p_to
      and (p_unit is null or d.business_unit_id = p_unit)
  ),
  bucketed as (
    select
      date_trunc(p_grain, x.on_date::timestamp)::date as period_start,
      sum(x.revenue_net)   as revenue_net,
      sum(x.labour_cost)   as labour_cost,
      sum(x.goods_cost)    as goods_cost,
      sum(x.waste_cost)    as waste_cost,
      sum(x.gross_profit)  as gross_profit,
      sum(x.covers)        as covers,
      count(distinct x.on_date) as days_with_data
    from daily x
    group by 1
  ),
  shaped as (
    select
      b.period_start,
      /*
       * The length of a bucket, mapped rather than built from the grain.
       * `('1 ' || p_grain)::interval` reads neatly and raises on 'quarter',
       * which Postgres truncates by and has no interval for — caught by the
       * test that asks for quarters, which is the only reason it was not
       * found by somebody looking at a quarterly report.
       */
      (b.period_start + case p_grain
                          when 'day'     then interval '1 day'
                          when 'week'    then interval '7 days'
                          when 'month'   then interval '1 month'
                          when 'quarter' then interval '3 months'
                          when 'year'    then interval '1 year'
                        end - interval '1 day')::date
        as period_end,
      b.revenue_net, b.labour_cost, b.goods_cost, b.waste_cost,
      b.gross_profit, b.covers, b.days_with_data
    from bucketed b
  )
  select
    s.period_start,
    s.period_end,
    p_grain,
    s.revenue_net::numeric(18,5),
    s.labour_cost::numeric(18,5),
    s.goods_cost::numeric(18,5),
    s.waste_cost::numeric(18,5),
    s.gross_profit::numeric(18,5),
    -- Null rather than zero where there was no revenue: a percentage of
    -- nothing is not nought per cent, it is not a percentage.
    case when s.revenue_net > 0
         then round(s.gross_profit / s.revenue_net * 100, 2) end,
    case when s.revenue_net > 0
         then round(s.labour_cost / s.revenue_net * 100, 2) end,
    s.covers::bigint,
    (s.period_end - s.period_start + 1)::integer as days_in_period,
    s.days_with_data::integer,
    (s.period_end >= current_date) as is_open,
    lag(s.revenue_net) over (order by s.period_start),
    lag(case when s.revenue_net > 0
             then round(s.gross_profit / s.revenue_net * 100, 2) end)
      over (order by s.period_start)
  from shaped s
  order by s.period_start;
end $$;

revoke all on function public.profit_trend(date, date, text, uuid) from public, anon;
grant execute on function public.profit_trend(date, date, text, uuid) to authenticated;

comment on function public.profit_trend(date, date, text, uuid) is
  'Daily profit aggregated into buckets, each carrying how complete it is. A month four days old is a quarter of a month of revenue, and a chart that does not say so reads as a collapse. See 0120.';
