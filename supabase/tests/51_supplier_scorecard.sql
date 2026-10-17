-- ---------------------------------------------------------------------------
-- A supplier scorecard that shows its working (0110)
-- ---------------------------------------------------------------------------
-- The assertions worth having here are the ones about evidence, not the ones
-- about arithmetic. A supplier late once out of one delivery is 100% late:
-- true, damning to read, and meaningless. A scorecard that ranks on that
-- produces a league table whose bottom is whoever delivered least, and the
-- buyer who acts on it moves business to the supplier they have not tried.
--
-- So: the counts are asserted beside the percentages, a component with
-- nothing behind it is asserted to be null rather than zero, and the thin
-- evidence flag is asserted in both directions — raised below the venue's
-- threshold and cleared above it.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into products (id, org_id, name, category, pack_unit, status, total_unit)
values ('b0000000-0000-4000-8000-000000510001', :'demo', 'T-Score-Fish',
        'Fish', 'kg', 'ACTIVE', 'kg');

insert into suppliers (id, org_id, name) values
  ('b0000000-0000-4000-8000-000000510010', :'demo', 'T-Punctual-Co'),
  ('b0000000-0000-4000-8000-000000510011', :'demo', 'T-Late-Co'),
  ('b0000000-0000-4000-8000-000000510012', :'demo', 'T-Untried-Co');

/*
 * Six orders for the punctual supplier and six for the late one, so both sit
 * above the venue's "enough to judge on" threshold of five. The counts are
 * the point of the fixture: five of six late is a different statement from
 * one of one.
 */
do $$
declare
  org uuid;
  s record;
  po uuid;
  grn uuid;
  i integer;
  late boolean;
begin
  select id into org from public.organizations where name = 'Demo Kitchen' limit 1;

  for s in select * from (values
      ('b0000000-0000-4000-8000-000000510010'::uuid, 0),
      ('b0000000-0000-4000-8000-000000510011'::uuid, 5)
    ) as v(supplier_id, late_count)
  loop
    for i in 1 .. 6 loop
      late := i <= s.late_count;

      /*
       * Spread across five months, one order every twenty-five days. They
       * used to sit inside a single month, which made the window assertion
       * below pass for the wrong reason — narrowing the window to thirty
       * days excluded nothing, and the check that was meant to prove the
       * window worked proved only that six is six.
       */
      insert into public.purchase_orders
        (org_id, supplier_id, status, ordered_on, expected_on, notes)
      values (org, s.supplier_id, 'ORDERED',
              current_date - (i * 25) - 10, current_date - (i * 25),
              'T-scorecard')
      returning id into po;

      insert into public.goods_receipts
        (org_id, supplier_id, purchase_order_id, received_on,
         received_by_email, notes)
      values (org, s.supplier_id, po,
              current_date - (i * 25) + (case when late then 3 else 0 end),
              'seed@test.local', 'T-scorecard')
      returning id into grn;

      insert into public.goods_receipt_lines
        (org_id, goods_receipt_id, product_id, quantity_received,
         quantity_rejected, rejection_reason, unit, unit_price, line_number)
      values (org, grn, 'b0000000-0000-4000-8000-000000510001',
              100,
              -- The late supplier also sends back-of-the-van fish: 10 of
              -- every 100 kilos refused, against a 3% venue threshold.
              case when s.supplier_id = 'b0000000-0000-4000-8000-000000510011'
                   then 10 else 0 end,
              case when s.supplier_id = 'b0000000-0000-4000-8000-000000510011'
                   then 'soft' end,
              'kg', 50000, 1);
    end loop;
  end loop;
end $$;

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select '── the counts, beside the percentages' as "──";

select t.expect_value($$
  select deliveries_scored::text || ' scored, ' || late::text || ' late'
    from supplier_scorecard
   where supplier_id = 'b0000000-0000-4000-8000-000000510011'$$,
  'five of six deliveries arrived after the date promised', '6 scored, 5 late');

select t.expect_value($$
  select late_percent::text from supplier_scorecard
   where supplier_id = 'b0000000-0000-4000-8000-000000510011'$$,
  'which is eighty-three per cent, and the six is shown beside it', '83.3');

select t.expect_value($$
  select late_percent::text from supplier_scorecard
   where supplier_id = 'b0000000-0000-4000-8000-000000510010'$$,
  'and the punctual supplier was never late', '0.0');

select t.expect_value($$
  select worst_days_late::text from supplier_scorecard
   where supplier_id = 'b0000000-0000-4000-8000-000000510011'$$,
  'the worst of them by three days', '3');

select '── a component with nothing behind it' as "──";

/*
 * Null, not zero, and the distinction is what stops a league table being
 * sorted by who has not been tried yet. A supplier nobody has ordered from
 * has no delivery record — which is a different sentence from "delivers
 * badly" and must not read like it.
 */
select t.expect_value($$
  select deliveries_scored::text from supplier_scorecard
   where supplier_id = 'b0000000-0000-4000-8000-000000510012'$$,
  'a supplier nobody has ordered from has no delivery record at all', null);
select t.expect_value($$
  select late_percent::text from supplier_scorecard
   where supplier_id = 'b0000000-0000-4000-8000-000000510012'$$,
  'rather than a lateness of none', null);
select t.expect_value($$
  select components_measured::text from supplier_scorecard
   where supplier_id = 'b0000000-0000-4000-8000-000000510012'$$,
  'and the card says how little of it could be filled in', '0');

select t.expect_value($$
  select concerns::text from supplier_scorecard
   where supplier_id = 'b0000000-0000-4000-8000-000000510012'$$,
  'an unmeasured supplier raises no concerns, which is not the same as being good', '0');

select '── an order nobody dated is not scored' as "──";

select t.fixture($$
  insert into purchase_orders (org_id, supplier_id, status, ordered_on, notes)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000510010', 'ORDERED',
          current_date - 20, 'T-scorecard-undated')$$);
select t.fixture($$
  insert into goods_receipts (org_id, supplier_id, purchase_order_id,
                              received_on, received_by_email, notes)
  select (select id from organizations where name='Demo Kitchen'),
         'b0000000-0000-4000-8000-000000510010', id,
         current_date - 1, 'seed@test.local', 'T-scorecard-undated'
    from purchase_orders where notes = 'T-scorecard-undated'$$);

/*
 * Counting an order nobody promised a date for as "on time" flatters every
 * supplier by the same amount, which is the same as not measuring at all —
 * except that it produces a number.
 */
select t.expect_value($$
  select deliveries_scored::text from supplier_scorecard
   where supplier_id = 'b0000000-0000-4000-8000-000000510010'$$,
  'an order with no promised date is left out rather than counted as on time', '6');

select '── quality, against a threshold the venue sets' as "──";

select t.expect_value($$
  select rejected_percent::text from supplier_scorecard
   where supplier_id = 'b0000000-0000-4000-8000-000000510011'$$,
  'ten kilos refused in every hundred', '10.00');
select t.expect_value($$
  select quality_flagged::text from supplier_scorecard
   where supplier_id = 'b0000000-0000-4000-8000-000000510011'$$,
  'which is over the venue''s three per cent and is flagged', 'true');
select t.expect_value($$
  select quality_flagged::text from supplier_scorecard
   where supplier_id = 'b0000000-0000-4000-8000-000000510010'$$,
  'and the other supplier''s nothing is not', 'false');

/*
 * The threshold is a venue's own, and the flag has to follow it. A fishmonger
 * rejecting 2% is a problem and a greengrocer rejecting 2% is Tuesday, which
 * is why this is a parameter and not a constant in a view.
 */
select t.expect_rows($$
  update venue_parameters set value = 25
   where code = 'SCORECARD_REJECT_PERCENT'
     and org_id = (select id from organizations where name='Demo Kitchen')$$,
  'the venue decides a quarter of everything coming back is acceptable', 1);
select t.expect_value($$
  select quality_flagged::text from supplier_scorecard
   where supplier_id = 'b0000000-0000-4000-8000-000000510011'$$,
  'and the flag follows the threshold rather than a number in a view', 'false');
select t.fixture($$
  update venue_parameters set value = 3
   where code = 'SCORECARD_REJECT_PERCENT'
     and org_id = (select id from organizations where name='Demo Kitchen')$$);

select '── enough to judge on' as "──";

select t.expect_value($$
  select thin_evidence::text from supplier_scorecard
   where supplier_id = 'b0000000-0000-4000-8000-000000510011'$$,
  'six deliveries is enough to say something about', 'false');

select t.expect_rows($$
  update venue_parameters set value = 10
   where code = 'SCORECARD_MIN_ORDERS'
     and org_id = (select id from organizations where name='Demo Kitchen')$$,
  'a venue that wants ten before it judges anybody', 1);
select t.expect_value($$
  select thin_evidence::text from supplier_scorecard
   where supplier_id = 'b0000000-0000-4000-8000-000000510011'$$,
  'and six is then said to be too little to rank on', 'true');
select t.expect_value($$
  select late_percent::text from supplier_scorecard
   where supplier_id = 'b0000000-0000-4000-8000-000000510011'$$,
  'the figure is still shown — hidden evidence is not thin evidence', '83.3');
select t.fixture($$
  update venue_parameters set value = 5
   where code = 'SCORECARD_MIN_ORDERS'
     and org_id = (select id from organizations where name='Demo Kitchen')$$);

select '── the window' as "──";

select t.expect_rows($$
  update venue_parameters set value = 30
   where code = 'SCORECARD_DAYS'
     and org_id = (select id from organizations where name='Demo Kitchen')$$,
  'the venue looks back a month instead of six', 1);

/*
 * "Ever" is not a useful answer about a supplier who fixed their delivery
 * problem in March. The oldest of the six deliveries falls outside a
 * thirty-day window, so the count drops — which is the window working and
 * not data going missing.
 */
select t.expect_value($$
  select deliveries_scored::text from supplier_scorecard
   where supplier_id = 'b0000000-0000-4000-8000-000000510011'$$,
  'and only the delivery inside that month is still counted', '1');
select t.fixture($$
  update venue_parameters set value = 180
   where code = 'SCORECARD_DAYS'
     and org_id = (select id from organizations where name='Demo Kitchen')$$);

select '── it is not one number' as "──";

select t.expect_value($$
  select concerns::text from supplier_scorecard
   where supplier_id = 'b0000000-0000-4000-8000-000000510011'$$,
  'two flags raised: late, and sending back-of-the-van fish', '2');
select t.expect_value($$
  select concerns::text from supplier_scorecard
   where supplier_id = 'b0000000-0000-4000-8000-000000510010'$$,
  'and none against the supplier who did neither', '0');

select '── the parameters and the registry' as "──";

reset role;
select t.expect_value($$
  select count(*)::text from organization_seeders
   where function_name = 'seed_scorecard_parameters'$$,
  'the thresholds are seeded through the registry, not a migration body', '1');
select t.expect_value($$
  select count(*)::text from venue_parameters
   where code like 'SCORECARD_%'
     and org_id = (select id from organizations where name='Demo Kitchen')$$,
  'and every existing venue already has all five', '5');

select '── who may read it' as "──";

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');

/*
 * The views are `security_invoker`, so they inherit the policies on what
 * they read rather than carrying one of their own — which means somebody
 * with no Purchasing access sees a supplier's name and nothing about their
 * performance. That is the right answer and it is worth an assertion,
 * because `security_invoker` is a property that can be dropped by a later
 * migration recreating a view and nothing else would say so.
 */
select t.expect_value($$
  select coalesce(max(deliveries_scored)::text, 'nothing')
    from supplier_scorecard$$,
  'somebody with no Purchasing access reads no supplier performance at all',
  'nothing');

reset role;
rollback;
