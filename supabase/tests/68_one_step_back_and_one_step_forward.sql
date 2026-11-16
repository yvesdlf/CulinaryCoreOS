-- ---------------------------------------------------------------------------
-- One step back and one step forward (0129)
-- ---------------------------------------------------------------------------
-- Article 18 asks a food business who the food came from and where it went.
-- `traceability_report` answers both for a period, and the answers are only
-- worth having if the sheet is honest about the ones it cannot give.
--
-- Three failures this file exists to prevent, in order of how expensive they
-- would be on the day somebody actually needs the report:
--
--   A lot with no supplier is the line somebody has to telephone about. If it
--   reads like any other line, nobody telephones.
--
--   A date with no kind cannot be judged — 0061 established that a use-by and
--   a best-before mean different things and guessing either way is wrong.
--
--   A forward trace that is empty because the *reader* has no Inventory
--   access looks exactly like a venue that never used the stock. On a
--   document filed for two years those must not be the same blank column.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset
select id as flour from products where name = 'T-flour' and org_id = :'demo' \gset

insert into suppliers (id, org_id, name)
values ('e0000000-0000-4000-8000-000000000681', :'demo', 'T-Supplier 68')
on conflict (id) do nothing;

/* Four lots, each carrying one of the things the report has to notice. */
insert into stock_lots (id, org_id, product_id, lot_code, supplier_id,
                        delivery_reference, received_on, expires_on, expiry_kind)
values
  ('e0000000-0000-4000-8000-000000000682', :'demo', :'flour', 'T-68-GOOD',
   'e0000000-0000-4000-8000-000000000681', 'T-DN-1', current_date - 2,
   current_date + 30, 'USE_BY'),
  ('e0000000-0000-4000-8000-000000000683', :'demo', :'flour', 'T-68-NOSUP',
   null, null, current_date - 2, current_date + 30, 'USE_BY'),
  ('e0000000-0000-4000-8000-000000000684', :'demo', :'flour', 'T-68-NOKIND',
   'e0000000-0000-4000-8000-000000000681', 'T-DN-2', current_date - 2,
   current_date + 30, null),
  ('e0000000-0000-4000-8000-000000000685', :'demo', :'flour', '',
   'e0000000-0000-4000-8000-000000000681', 'T-DN-3', current_date - 2,
   null, null);

select '── traceability: the period is the document''s own ───────────────';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_refused($$
  select * from public.traceability_report(null, current_date)$$,
  'a report with no period is refused rather than guessed at',
  'needs a period');

select t.expect_refused($$
  select * from public.traceability_report(current_date, current_date - 7)$$,
  'and so is one that ends before it begins', 'ends before it begins');

/*
 * `received_on`, not `created_at`. A delivery entered on Monday for goods
 * that arrived on Saturday belongs in Saturday's report — an inspector asking
 * about a date means the date the food was in the building.
 */
select t.expect_value($$
  select count(*)::text from public.traceability_report(
    current_date - 1, current_date)
   where lot_code like 'T-68-%'$$,
  'a lot received before the period is not in it', '0');

select t.expect_value($$
  select count(*)::text from public.traceability_report(
    current_date - 7, current_date)
   where lot_code like 'T-68-%'$$,
  'and is, once the period reaches back far enough', '3');

select '── traceability: one step back ──────────────────────────────────';

select t.expect_value($$
  select supplier_name || ' / ' || delivery_reference
    from public.traceability_report(current_date - 7, current_date)
   where lot_code = 'T-68-GOOD'$$,
  'the sheet names who the food came from', 'T-Supplier 68 / T-DN-1');

select t.expect_value($$
  select (concerns @> array['no supplier recorded: one step back is not answerable for this lot'])::text
    from public.traceability_report(current_date - 7, current_date)
   where lot_code = 'T-68-NOSUP'$$,
  'a lot with no supplier says one step back is not answerable', 'true');

/*
 * 0061's distinction, carried onto the document. A date with no kind is not
 * a date that can be judged, and the sheet says so rather than implying the
 * food was fine.
 */
select t.expect_value($$
  select (concerns @> array['date given with no kind, so it cannot be judged safe or merely stale'])::text
    from public.traceability_report(current_date - 7, current_date)
   where lot_code = 'T-68-NOKIND'$$,
  'a date with no kind is reported as unjudgeable', 'true');

select t.expect_value($$
  select (concerns @> array['no lot code: this delivery cannot be told apart from another of the same product'])::text
    from public.traceability_report(current_date - 7, current_date)
   where delivery_reference = 'T-DN-3'$$,
  'a blank lot code is a concern, not an empty cell', 'true');

/*
 * A lot with both halves of its life recorded: received, then drawn from.
 * The fixture's `T-LOT` carries a receipt and nothing else, so it is the
 * example of a lot that was *not* used — which is a different assertion.
 */
reset role;
insert into stock_lots (id, org_id, product_id, lot_code, supplier_id,
                        delivery_reference, received_on, expires_on, expiry_kind)
values ('e0000000-0000-4000-8000-000000000686', :'demo', :'flour', 'T-68-USED',
        'e0000000-0000-4000-8000-000000000681', 'T-DN-4', current_date - 2,
        current_date + 30, 'USE_BY');
insert into stock_movements (org_id, product_id, kind, quantity, unit, unit_cost, reason, lot_id)
values (:'demo', :'flour', 'RECEIPT',  1000, 'g', 10, 'T-68 in',
        'e0000000-0000-4000-8000-000000000686'),
       (:'demo', :'flour', 'USAGE',    -400, 'g', 10, 'T-68 out',
        'e0000000-0000-4000-8000-000000000686');
set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select '── traceability: one step forward, and who may see it ───────────';

/*
 * chef@ holds every section in the fixtures, so the forward trace is readable
 * and the flags say so. The fixture lot `T-LOT` has a usage movement against
 * it, which is what makes this a trace rather than a list.
 */
select t.expect_value($$
  select (reader_sees_movements and reader_sees_production)::text
    from public.traceability_report(current_date - 7, current_date)
   where lot_code = 'T-LOT'$$,
  'a reader with Inventory and Production is told the trace is complete', 'true');

select t.expect_value($$
  select movements::text || ' out of ' || quantity_received::text
    from public.traceability_report(current_date - 7, current_date)
   where lot_code = 'T-68-USED'$$,
  'a lot that was drawn from shows the movement and what arrived', '1 out of 1000.00000');

/*
 * The bug this caught. `lot_forward_trace` joins `m.quantity < 0`, so it
 * carries only what left the lot; reading receipts from it returned nothing
 * for every lot, silently, and the column simply looked empty.
 */
select t.expect_value($$
  select (quantity_received is not null)::text
    from public.traceability_report(current_date - 7, current_date)
   where lot_code = 'T-68-USED'$$,
  'and what arrived is read from the movements, not from the forward trace', 'true');

select t.expect_value($$
  select (concerns @> array['nothing was ever drawn from this lot'])::text
    from public.traceability_report(current_date - 7, current_date)
   where lot_code = 'T-68-GOOD'$$,
  'a lot nothing came out of is said to be untouched', 'true');

/*
 * The one that matters most, and the only one that needs a second reader.
 * nobody@ is granted nothing by the fixtures: every lot is still visible —
 * `stock_lots` is shared, a lot code is on a label — and the forward trace is
 * not. Without the flag, that reads as a venue that never used its stock.
 */
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');

select t.expect_value($$
  select (count(*) > 0)::text from public.traceability_report(
    current_date - 7, current_date)$$,
  'a member without Inventory still sees the lots', 'true');

select t.expect_value($$
  select (bool_or(reader_sees_movements) or bool_or(reader_sees_production))::text
    from public.traceability_report(current_date - 7, current_date)$$,
  'but every row says the forward trace is not theirs to read', 'false');

select t.expect_value($$
  select coalesce(sum(movements), 0)::text
    from public.traceability_report(current_date - 7, current_date)$$,
  'and the trace is empty, which is why the row has to say why', '0');

/*
 * `concerns` must not accuse the venue of something that is really the
 * reader's own access. "Nothing was ever drawn from this lot" is only true if
 * the reader could have seen a movement.
 */
select t.expect_value($$
  select (bool_or(concerns @> array['nothing was ever drawn from this lot']))::text
    from public.traceability_report(current_date - 7, current_date)$$,
  'and no lot is accused of being untouched on a trace nobody can read', 'false');

rollback;
