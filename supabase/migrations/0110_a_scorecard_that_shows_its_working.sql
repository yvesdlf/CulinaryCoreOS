-- ---------------------------------------------------------------------------
-- A supplier scorecard that shows its working
-- ---------------------------------------------------------------------------
-- Every input has existed for months and nothing has ever put them together:
-- whether deliveries arrive when they were promised, how much comes back as
-- rejected, whether the price keeps creeping, and how often the invoice is an
-- argument rather than a payment.
--
-- The design question is whether to blend them into one number, and the
-- answer here is no. A single score is what everybody asks for and it is the
-- thing that makes a scorecard useless: the weights are arbitrary, nobody
-- remembers them a month later, and a supplier who is late but cheap scores
-- identically to one who is punctual and dear. The conversation a buyer
-- actually has is "you were late four times out of eleven" — which needs the
-- four and the eleven, not a 7.2.
--
-- So the components stay apart, and the only judgement the database makes is
-- a per-component flag against a threshold a venue can change. The thresholds
-- live in `venue_parameters` for the reason the cooling limits do: they
-- differ by trade. A fishmonger rejecting 2% is a problem; a greengrocer
-- rejecting 2% is Tuesday.
--
-- The part that took the most care is evidence. Two deliveries are not a
-- delivery record, and a supplier who was late once out of one scores 0% on
-- time — which is true, and reads as damning, and is nothing of the sort. So
-- every component carries the count it was computed from, a component with
-- nothing behind it is null rather than zero, and `thin_evidence` says
-- outright when there is not enough to judge on. The alternative is a league
-- table whose bottom is whoever delivered least.
--
-- The window is deliberate too. "Ever" is not a useful answer about a
-- supplier who fixed their delivery problem in March.
-- ---------------------------------------------------------------------------

create or replace function public.seed_scorecard_parameters(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.venue_parameters
    (org_id, code, name, description, value, unit, min_value, max_value)
  values
    (p_org, 'SCORECARD_DAYS', 'Scorecard window',
     'How far back the supplier scorecard looks. "Ever" is not a useful answer about a supplier who fixed their delivery problem in March.',
     180, 'days', 30, 730),
    (p_org, 'SCORECARD_MIN_ORDERS', 'Enough to judge on',
     'Below this many scored deliveries a supplier is marked as thin evidence rather than ranked. One late delivery out of one is 0% on time, which is true and means nothing.',
     5, 'deliveries', 1, 50),
    (p_org, 'SCORECARD_LATE_PERCENT', 'Late deliveries worth noticing',
     'Above this share of deliveries arriving after the date promised, lateness is flagged.',
     15, '%', 0, 100),
    (p_org, 'SCORECARD_REJECT_PERCENT', 'Rejections worth noticing',
     'Above this share of quantity refused on arrival, quality is flagged. A fishmonger rejecting 2% is a problem; a greengrocer rejecting 2% is Tuesday.',
     3, '%', 0, 100),
    (p_org, 'SCORECARD_DISPUTE_PERCENT', 'Invoices in argument',
     'Above this share of invoices sitting in exception or dispute, paperwork is flagged.',
     10, '%', 0, 100)
  on conflict (org_id, code) do nothing;
end $$;

revoke all on function public.seed_scorecard_parameters(uuid)
  from public, anon, authenticated;

insert into public.organization_seeders (ordinal, function_name, note)
select coalesce(max(ordinal), 0) + 1, 'seed_scorecard_parameters',
       'Thresholds and window for the supplier scorecard (0110)'
  from public.organization_seeders
on conflict (function_name) do nothing;

do $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.seed_scorecard_parameters(o.id);
  end loop;
end $$;

/*
 * One row per supplier per component, kept separate from the roll-up.
 *
 * Its own view because each component has a different denominator and a
 * different reason to be missing, and flattening them into one select makes
 * every null ambiguous. Here, a null count and a null percentage mean the
 * same thing and say it plainly: this was not measured, because there was
 * nothing to measure it on.
 */
create or replace view supplier_delivery_record
with (security_invoker = true) as
  with window_days as (
    select org_id,
           coalesce(max(value) filter (where code = 'SCORECARD_DAYS'), 180)::int as days
      from public.venue_parameters
     group by org_id
  ),
  /*
   * On time is judged against the date the order promised, and only orders
   * that carried one are scored at all. Counting an order nobody gave a date
   * to as on time would flatter every supplier equally, which is the same as
   * not measuring.
   */
  delivered as (
    select
      o.org_id,
      o.supplier_id,
      o.id as order_id,
      o.expected_on,
      min(r.received_on) as first_received_on
    from public.purchase_orders o
    join public.goods_receipts r on r.purchase_order_id = o.id
    join window_days w on w.org_id = o.org_id
   where o.expected_on is not null
     and r.received_on >= current_date - w.days
   group by o.org_id, o.supplier_id, o.id, o.expected_on
  )
  select
    d.org_id,
    d.supplier_id,
    count(*)                                              as deliveries_scored,
    count(*) filter (where d.first_received_on <= d.expected_on) as on_time,
    count(*) filter (where d.first_received_on > d.expected_on)  as late,
    round(count(*) filter (where d.first_received_on > d.expected_on)
          * 100.0 / count(*), 1)                          as late_percent,
    max(d.first_received_on - d.expected_on)              as worst_days_late
  from delivered d
  group by d.org_id, d.supplier_id;

grant select on supplier_delivery_record to authenticated;

create or replace view supplier_quality_record
with (security_invoker = true) as
  with window_days as (
    select org_id,
           coalesce(max(value) filter (where code = 'SCORECARD_DAYS'), 180)::int as days
      from public.venue_parameters
     group by org_id
  )
  select
    r.org_id,
    r.supplier_id,
    count(distinct r.id)                                  as deliveries,
    count(l.id)                                           as lines,
    sum(l.quantity_received)::numeric(18,5)               as quantity_received,
    sum(l.quantity_rejected)::numeric(18,5)               as quantity_rejected,
    /*
     * Null rather than zero where nothing was received at all. A rejection
     * rate of none and a rejection rate nobody could compute look identical
     * in a league table and mean the opposite.
     */
    case when sum(l.quantity_received) > 0
         then round(sum(l.quantity_rejected) * 100.0 / sum(l.quantity_received), 2)
    end                                                   as rejected_percent,
    count(l.id) filter (where l.quantity_rejected > 0)    as lines_with_a_rejection
  from public.goods_receipts r
  join public.goods_receipt_lines l on l.goods_receipt_id = r.id
  join window_days w on w.org_id = r.org_id
 where r.supplier_id is not null
   and r.received_on >= current_date - w.days
 group by r.org_id, r.supplier_id;

grant select on supplier_quality_record to authenticated;

create or replace view supplier_paperwork_record
with (security_invoker = true) as
  with window_days as (
    select org_id,
           coalesce(max(value) filter (where code = 'SCORECARD_DAYS'), 180)::int as days
      from public.venue_parameters
     group by org_id
  )
  select
    i.org_id,
    i.supplier_id,
    count(*)                                              as invoices,
    count(*) filter (where i.status in ('EXCEPTION', 'DISPUTED')) as in_argument,
    round(count(*) filter (where i.status in ('EXCEPTION', 'DISPUTED'))
          * 100.0 / count(*), 1)                          as argued_percent,
    (select count(*) from public.supplier_credit_notes cn
      where cn.supplier_id = i.supplier_id
        and cn.issued_on >= current_date - w.days)        as credit_notes
  from public.supplier_invoices i
  join window_days w on w.org_id = i.org_id
 where i.invoice_date >= current_date - w.days
 group by i.org_id, i.supplier_id, w.days;

grant select on supplier_paperwork_record to authenticated;

/*
 * The scorecard.
 *
 * Deliberately not a single number. The weights behind a blended score are
 * arbitrary, nobody remembers them a month later, and a supplier who is late
 * but cheap comes out level with one who is punctual and dear — so the
 * figure settles an argument by hiding it. What a buyer actually says on the
 * phone is "you were late four times out of eleven", which needs the four
 * and the eleven.
 *
 * Each component carries its own count and its own flag against a threshold
 * the venue sets. `concerns` is a count of flags raised, not a score: it
 * sorts the list without pretending to rank it.
 */
create or replace view supplier_scorecard
with (security_invoker = true) as
  with thresholds as (
    select
      org_id,
      coalesce(max(value) filter (where code = 'SCORECARD_DAYS'), 180)::int as days,
      coalesce(max(value) filter (where code = 'SCORECARD_MIN_ORDERS'), 5)::int as min_orders,
      coalesce(max(value) filter (where code = 'SCORECARD_LATE_PERCENT'), 15) as late_limit,
      coalesce(max(value) filter (where code = 'SCORECARD_REJECT_PERCENT'), 3) as reject_limit,
      coalesce(max(value) filter (where code = 'SCORECARD_DISPUTE_PERCENT'), 10) as dispute_limit
    from public.venue_parameters
    group by org_id
  ),
  /*
   * Price movement, over the same window. `supplier_price_history` already
   * computes each move against the one before it with `lag`, so this counts
   * rises rather than recomputing them — and recomputing them here would be
   * the second implementation that disagrees with the first.
   */
  prices as (
    select
      h.org_id,
      h.supplier_id,
      count(*) filter (where h.moved_percent is not null)  as price_changes,
      count(*) filter (where h.moved_percent > 0)          as price_rises,
      round(avg(h.moved_percent) filter (where h.moved_percent is not null), 1)
                                                           as average_move_percent
    from public.supplier_price_history h
    join thresholds t on t.org_id = h.org_id
   where h.valid_from >= current_date - t.days
   group by h.org_id, h.supplier_id
  )
  select
    s.org_id,
    s.id                      as supplier_id,
    s.name                    as supplier_name,
    t.days                    as window_days,

    d.deliveries_scored,
    d.late,
    d.late_percent,
    d.worst_days_late,
    (d.late_percent > t.late_limit)        as lateness_flagged,

    q.quantity_received,
    q.quantity_rejected,
    q.rejected_percent,
    (q.rejected_percent > t.reject_limit)  as quality_flagged,

    p.price_changes,
    p.price_rises,
    p.average_move_percent,

    w.invoices,
    w.in_argument,
    w.argued_percent,
    w.credit_notes,
    (w.argued_percent > t.dispute_limit)   as paperwork_flagged,

    /*
     * A count of flags raised, not a score. It sorts the list without
     * claiming the three concerns are commensurable.
     */
    (coalesce((d.late_percent > t.late_limit)::int, 0)
     + coalesce((q.rejected_percent > t.reject_limit)::int, 0)
     + coalesce((w.argued_percent > t.dispute_limit)::int, 0)) as concerns,

    /*
     * Said outright, because the alternative is a league table whose bottom
     * is whoever delivered least. A supplier late once out of one delivery
     * is 100% late, which is true and means nothing.
     */
    (coalesce(d.deliveries_scored, 0) < t.min_orders)      as thin_evidence,
    /* How much of the card could be filled in at all. */
    ((d.deliveries_scored is not null)::int
     + (q.rejected_percent is not null)::int
     + (w.invoices is not null)::int)                      as components_measured
  from public.suppliers s
  join thresholds t on t.org_id = s.org_id
  left join public.supplier_delivery_record d
    on d.supplier_id = s.id and d.org_id = s.org_id
  left join public.supplier_quality_record q
    on q.supplier_id = s.id and q.org_id = s.org_id
  left join public.supplier_paperwork_record w
    on w.supplier_id = s.id and w.org_id = s.org_id
  left join prices p
    on p.supplier_id = s.id and p.org_id = s.org_id;

grant select on supplier_scorecard to authenticated;

comment on view supplier_scorecard is
  'Components, not a blended score: the weights behind one number are arbitrary and it settles an argument by hiding it. Thresholds are per venue. See 0110.';
comment on view supplier_delivery_record is
  'On time against the date the order promised, counting only orders that carried one. See 0110.';
