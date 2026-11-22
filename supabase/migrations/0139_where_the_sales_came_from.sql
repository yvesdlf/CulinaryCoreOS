-- ---------------------------------------------------------------------------
-- Where the sales came from — by channel, over a period you choose
-- ---------------------------------------------------------------------------
-- The dashboard and the Trend report answer "how much, and which way is it
-- moving." Neither answers the question a GM asks next: *where did it come
-- from* — the till, takeaway, or a delivery platform that keeps a cut. The
-- figures sit in `revenue_daily` (one row per outlet, channel and day, with
-- gross, the commission a platform took, net, and covers); nothing has ever
-- grouped them by channel across a range so the mix is visible.
--
-- `sales_by_channel` is that grouping. Per channel over the range: gross, the
-- commission taken and what percent of gross that is, net, covers, the average
-- spend a cover left, and the channel's share of the venue's net — so a
-- delivery line that looks healthy at gross but gives up a fifth to commission
-- reads honestly beside the till.
--
-- ── Average spend and the shares ──────────────────────────────────────────
--
-- Average spend is net over covers, weighted — the same rule the rest of the
-- app uses, so a quiet day and a busy one do not count equally. Commission
-- percent is of gross (what the platform charged on what it carried) and share
-- is of net (what the venue kept), each null when its denominator is zero
-- rather than a false zero or a division by nothing.
--
-- ── Access ────────────────────────────────────────────────────────────────
--
-- Invoker rights over `revenue_daily`, which is `security_invoker` over
-- `daily_takings` and so gated on REVENUE per outlet: a reader sees the
-- channels of the outlets whose takings they may read, and the only thing
-- added is the venue scope.
-- ---------------------------------------------------------------------------

create or replace function public.sales_by_channel(
  p_from date,
  p_to date
)
returns table (
  channel_code text,
  channel_name text,
  channel_kind revenue_channel_kind,
  gross numeric,
  commission numeric,
  net numeric,
  covers numeric,
  avg_spend numeric,
  commission_percent numeric,
  share_of_net numeric,
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
    raise exception 'a sales report needs a period'
      using hint = 'Both dates are required.';
  end if;
  if p_to < p_from then
    raise exception 'the period ends before it begins';
  end if;

  return query
  with r as (
    select d.channel_id, d.channel_code, d.channel_name, d.channel_kind,
           d.gross_amount, d.commission_amount, d.net_amount, d.covers, d.on_date
      from public.revenue_daily d
     where d.org_id = org
       and d.on_date between p_from and p_to
  ),
  total as (
    select sum(net_amount) as net_all from r
  )
  select
    r.channel_code,
    r.channel_name,
    r.channel_kind,
    coalesce(sum(r.gross_amount), 0),
    coalesce(sum(r.commission_amount), 0),
    coalesce(sum(r.net_amount), 0),
    coalesce(sum(r.covers), 0)::numeric,
    -- Average spend is net over covers, weighted — not the mean of daily means.
    case when coalesce(sum(r.covers), 0) > 0
         then round(sum(r.net_amount) / sum(r.covers), 2) end,
    -- What the channel charged on what it carried.
    case when coalesce(sum(r.gross_amount), 0) > 0
         then round(coalesce(sum(r.commission_amount), 0) / sum(r.gross_amount) * 100, 1) end,
    -- The channel's share of what the venue kept.
    case when (select net_all from total) > 0
         then round(sum(r.net_amount) / (select net_all from total) * 100, 1) end,
    count(distinct r.on_date)::integer
  from r
  group by r.channel_code, r.channel_name, r.channel_kind
  order by sum(r.net_amount) desc nulls last;
end $$;

comment on function public.sales_by_channel(date, date) is
  'Venue sales grouped by revenue channel over one date range for the '
  'caller''s active venue: gross, commission and its percent of gross, net, '
  'covers, weighted average spend, and the channel''s share of net. Invoker '
  'rights over revenue_daily, so REVENUE-gated per outlet; venue-scoped.';

revoke all on function public.sales_by_channel(date, date) from anon;
grant execute on function public.sales_by_channel(date, date) to authenticated;
