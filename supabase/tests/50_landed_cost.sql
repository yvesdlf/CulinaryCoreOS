-- ---------------------------------------------------------------------------
-- What the goods actually cost to get here (0109)
-- ---------------------------------------------------------------------------
-- The assertion this file is built around is the rounding one. Three lines
-- sharing a charge by thirds round to a hundred-thousandth short of the
-- whole, and an allocation that does not sum to the charge is both wrong and
-- invisible: every line looks plausible, the report balances to within a
-- rounding error, and somebody spends an afternoon on it at month end.
--
-- The two refusals matter for the opposite reason. Spreading freight evenly
-- over lines that cannot carry the chosen basis is not a cautious fallback —
-- it produces a figure indistinguishable from a real allocation, and nothing
-- downstream can ever tell that it was invented.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into products (id, org_id, name, category, pack_unit, status, stock_unit, total_unit)
values ('b0000000-0000-4000-8000-000000500001', :'demo', 'T-Saffron', 'Dry', 'g', 'ACTIVE', 'g', 'g'),
       ('b0000000-0000-4000-8000-000000500002', :'demo', 'T-Potato',  'Veg', 'kg', 'ACTIVE', 'kg', 'kg'),
       ('b0000000-0000-4000-8000-000000500003', :'demo', 'T-Onion',   'Veg', 'kg', 'ACTIVE', 'kg', 'kg');

insert into suppliers (id, org_id, name)
values ('b0000000-0000-4000-8000-000000500010', :'demo', 'T-Landed-Co');

insert into goods_receipts (id, org_id, supplier_id, received_on,
                            reference, reference_stem)
values ('b0000000-0000-4000-8000-000000500020', :'demo',
        'b0000000-0000-4000-8000-000000500010', current_date,
        'GRN-KIT-260101-900', 'KIT-260101-900');

/*
 * Three lines of equal value, which is what makes the thirds happen. Each is
 * worth 1.000.000: that is deliberate, because a charge of 100.00000 over
 * three equal shares is the case where naive rounding loses a fraction.
 */
insert into goods_receipt_lines
  (id, org_id, goods_receipt_id, product_id, quantity_received, unit,
   unit_price, line_weight_kg, line_number)
values
  ('b0000000-0000-4000-8000-000000500031', :'demo', 'b0000000-0000-4000-8000-000000500020',
   'b0000000-0000-4000-8000-000000500001', 100, 'g',  10000, 0.1, 1),
  ('b0000000-0000-4000-8000-000000500032', :'demo', 'b0000000-0000-4000-8000-000000500020',
   'b0000000-0000-4000-8000-000000500002', 200, 'kg', 5000,  200, 2),
  ('b0000000-0000-4000-8000-000000500033', :'demo', 'b0000000-0000-4000-8000-000000500020',
   'b0000000-0000-4000-8000-000000500003', 400, 'kg', 2500,  400, 3);

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select '── the parts add up to the whole' as "──";

select t.expect_rows($$
  insert into receipt_charges (org_id, goods_receipt_id, kind, basis, amount)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000500020', 'FREIGHT', 'VALUE', 100)$$,
  'a freight charge is recorded', 1);

-- Allocated by the trigger, without anybody calling anything.
select t.expect_value($$
  select count(*)::text from receipt_line_charges lc
    join receipt_charges c on c.id = lc.receipt_charge_id
   where c.goods_receipt_id = 'b0000000-0000-4000-8000-000000500020'$$,
  'and is spread over all three lines without being asked', '3');

select t.expect_value($$
  select sum(lc.amount)::text from receipt_line_charges lc
    join receipt_charges c on c.id = lc.receipt_charge_id
   where c.goods_receipt_id = 'b0000000-0000-4000-8000-000000500020'$$,
  'the parts sum to exactly the charge, not to a rounding error short of it',
  '100.00000');

/*
 * Each line is worth a million, so each carries a third. Two of them get
 * 33.33333 and the largest carries the remainder — which is where it is both
 * conventional and proportionally smallest.
 */
select t.expect_value($$
  select string_agg(lc.amount::text, ',' order by lc.amount) from receipt_line_charges lc
    join receipt_charges c on c.id = lc.receipt_charge_id
   where c.goods_receipt_id = 'b0000000-0000-4000-8000-000000500020'$$,
  'two thirds rounded down and the remainder on the largest share',
  '33.33333,33.33333,33.33334');

select '── the basis is a choice, and it changes the answer' as "──";

/*
 * By weight, the potatoes and onions carry almost all of it and the saffron
 * carries a tenth of a kilo's worth. By value they carried a third each.
 * Spreading freight by value makes the saffron pay to move the potatoes,
 * which is the whole reason the basis is per charge.
 */
select t.expect_rows($$
  update receipt_charges set basis = 'WEIGHT'
   where goods_receipt_id = 'b0000000-0000-4000-8000-000000500020'$$,
  'the same charge, spread by weight instead', 1);

select t.expect_value($$
  select lc.amount::text from receipt_line_charges lc
   where lc.goods_receipt_line_id = 'b0000000-0000-4000-8000-000000500031'$$,
  'a hundred grams of saffron carries almost none of the freight', '0.01666');

select t.expect_value($$
  select sum(lc.amount)::text from receipt_line_charges lc
    join receipt_charges c on c.id = lc.receipt_charge_id
   where c.goods_receipt_id = 'b0000000-0000-4000-8000-000000500020'$$,
  'and it still adds up', '100.00000');

select '── it refuses to guess' as "──";

select t.fixture($$
  insert into goods_receipt_lines
    (id, org_id, goods_receipt_id, product_id, quantity_received, unit,
     unit_price, line_number)
  values ('b0000000-0000-4000-8000-000000500034',
          (select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000500020',
          'b0000000-0000-4000-8000-000000500003', 50, 'kg', 1000, 4)$$);

-- That new line has no weight, so a weight basis has nothing to spread over.
select t.expect_refused($$
  update receipt_charges set amount = 120
   where goods_receipt_id = 'b0000000-0000-4000-8000-000000500020'$$,
  'a line with no weight refuses a weight basis rather than guessing one',
  'no weight to spread it over');

select t.expect_value($$
  select sum(lc.amount)::text from receipt_line_charges lc
    join receipt_charges c on c.id = lc.receipt_charge_id
   where c.goods_receipt_id = 'b0000000-0000-4000-8000-000000500020'$$,
  'and the allocation that was there is untouched', '100.00000');

select t.expect_rows($$
  update receipt_charges set basis = 'QUANTITY'
   where goods_receipt_id = 'b0000000-0000-4000-8000-000000500020'$$,
  'quantity, which every line has', 1);
select t.expect_value($$
  select count(*)::text from receipt_line_charges lc
    join receipt_charges c on c.id = lc.receipt_charge_id
   where c.goods_receipt_id = 'b0000000-0000-4000-8000-000000500020'$$,
  'spreads over all four lines', '4');

select '── a receipt nobody priced' as "──";

select t.fixture($$
  insert into goods_receipts (id, org_id, supplier_id, received_on,
                              reference, reference_stem)
  values ('b0000000-0000-4000-8000-000000500040',
          (select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000500010', current_date,
          'GRN-KIT-260101-901', 'KIT-260101-901')$$);
select t.fixture($$
  insert into goods_receipt_lines
    (org_id, goods_receipt_id, product_id, quantity_received, unit,
     unit_price, line_number)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000500040',
          'b0000000-0000-4000-8000-000000500002', 10, 'kg', 0, 1)$$);

select t.expect_refused($$
  insert into receipt_charges (org_id, goods_receipt_id, kind, basis, amount)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000500040', 'DUTY', 'VALUE', 50)$$,
  'a charge cannot be spread by value over lines worth nothing',
  'lines total zero');

select t.expect_value($$
  select count(*)::text from receipt_charges
   where goods_receipt_id = 'b0000000-0000-4000-8000-000000500040'$$,
  'and the charge is not left recorded but unallocated', '0');

select '── what it landed at' as "──";

/*
 * The charge is now spread by quantity over 750 units, so the potatoes' 200
 * carry 26.66667 of it — a third of a rupiah on a line worth a million,
 * which lands at five thousand and a seventh of a cent. The figure is
 * deliberately an awkward one: a landed cost that comes out round is a
 * landed cost somebody has rounded.
 */
select t.expect_value($$
  select landed_unit_cost::text from receipt_line_landed_cost
   where goods_receipt_line_id = 'b0000000-0000-4000-8000-000000500032'$$,
  'two hundred kilos at five thousand, plus its share of the freight',
  '5000.13333');

/*
 * The negative question, which is the useful one. A landed cost report that
 * silently omits what it could not compute reads as though everything is
 * accounted for.
 */
select t.fixture($$
  insert into goods_receipt_lines
    (org_id, goods_receipt_id, product_id, quantity_received, unit, line_number)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000500040',
          'b0000000-0000-4000-8000-000000500001', 5, 'g', 2)$$);

select t.expect_value($$
  select lines_without_a_price::text || '/' || can_be_landed::text
    from landed_cost_ready
   where goods_receipt_id = 'b0000000-0000-4000-8000-000000500040'$$,
  'a receipt with an unpriced line says so rather than reporting a cost',
  '1/false');

select t.expect_value($$
  select price_missing::text from receipt_line_landed_cost
   where goods_receipt_line_id in (
     select id from goods_receipt_lines
      where goods_receipt_id = 'b0000000-0000-4000-8000-000000500040'
        and line_number = 2)$$,
  'and the line itself carries the reason', 'true');

select '── the price falls back to what was ordered' as "──";

select t.fixture($$
  insert into purchase_orders (id, org_id, supplier_id, status,
                               reference, reference_stem)
  values ('b0000000-0000-4000-8000-000000500050',
          (select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000500010', 'DRAFT',
          'PO-KIT-260101-900', 'KIT-260101-900')$$);
select t.fixture($$
  insert into purchase_order_lines
    (id, org_id, purchase_order_id, product_id, quantity, unit, unit_price)
  values ('b0000000-0000-4000-8000-000000500051',
          (select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000500050',
          'b0000000-0000-4000-8000-000000500002', 10, 'kg', 7777)$$);

select t.expect_rows($$
  insert into goods_receipt_lines
    (id, org_id, goods_receipt_id, purchase_order_line_id, product_id,
     quantity_received, unit, line_number)
  values ('b0000000-0000-4000-8000-000000500035',
          (select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000500020',
          'b0000000-0000-4000-8000-000000500051',
          'b0000000-0000-4000-8000-000000500002', 10, 'kg', 5)$$,
  'a line received against an order', 1);

select t.expect_value($$
  select unit_price::text from goods_receipt_lines
   where id = 'b0000000-0000-4000-8000-000000500035'$$,
  'takes the ordered price rather than leaving the cost unknown', '7777.00000');

select t.expect_rows($$
  insert into goods_receipt_lines
    (id, org_id, goods_receipt_id, purchase_order_line_id, product_id,
     quantity_received, unit, unit_price, line_number)
  values ('b0000000-0000-4000-8000-000000500036',
          (select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000500020',
          'b0000000-0000-4000-8000-000000500051',
          'b0000000-0000-4000-8000-000000500002', 10, 'kg', 8100, 6)$$,
  'and a delivery that came in dearer says so', 1);
select t.expect_value($$
  select unit_price::text from goods_receipt_lines
   where id = 'b0000000-0000-4000-8000-000000500036'$$,
  'which is kept, not overwritten by the order', '8100.00000');

select '── rejected goods carry nothing' as "──";

select t.fixture($$
  delete from receipt_charges
   where goods_receipt_id = 'b0000000-0000-4000-8000-000000500020'$$);
select t.fixture($$
  insert into goods_receipts (id, org_id, supplier_id, received_on,
                              reference, reference_stem)
  values ('b0000000-0000-4000-8000-000000500060',
          (select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000500010', current_date,
          'GRN-KIT-260101-902', 'KIT-260101-902')$$);
select t.fixture($$
  insert into goods_receipt_lines
    (id, org_id, goods_receipt_id, product_id, quantity_received,
     quantity_rejected, rejection_reason, unit, unit_price, line_number)
  values ('b0000000-0000-4000-8000-000000500061',
          (select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000500060',
          'b0000000-0000-4000-8000-000000500002', 10, 10, 'frozen solid',
          'kg', 1000, 1),
         ('b0000000-0000-4000-8000-000000500062',
          (select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000500060',
          'b0000000-0000-4000-8000-000000500003', 10, 0, null,
          'kg', 1000, 2)$$);

select t.expect_rows($$
  insert into receipt_charges (org_id, goods_receipt_id, kind, basis, amount)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000500060', 'HANDLING', 'VALUE', 60)$$,
  'a handling charge on a delivery half of which went back', 1);

/*
 * The whole charge lands on the line the venue kept. Carrying freight on a
 * crate that went back on the van would put the cost of stock nobody has onto
 * the margin of stock somebody does.
 */
select t.expect_value($$
  select count(*)::text || ':' || sum(lc.amount)::text from receipt_line_charges lc
    join receipt_charges c on c.id = lc.receipt_charge_id
   where c.goods_receipt_id = 'b0000000-0000-4000-8000-000000500060'$$,
  'falls entirely on the line that became stock', '1:60.00000');

/*
 * And here the uplift is worth reading, which it was not on the receipt
 * above: sixty on a line worth ten thousand is six tenths of a per cent, and
 * "this supplier is 0.6% dearer by the time it is in the store" is the
 * sentence somebody acts on. A blended landed figure hides it completely.
 */
select t.expect_value($$
  select uplift_percent::text from receipt_line_landed_cost
   where goods_receipt_line_id = 'b0000000-0000-4000-8000-000000500062'$$,
  'and the uplift is stated as a percentage, which is the number people act on',
  '0.60');

/*
 * Null rather than zero, and the distinction is the one METRICS.md §4 is
 * about. The whole line went back, so there is nothing for a charge to be a
 * percentage *of* — "no uplift" and "an uplift of none" are different
 * statements, and a report averaging a column of them would be wrong by
 * however many rejected lines it swallowed.
 */
select t.expect_value($$
  select uplift_percent::text from receipt_line_landed_cost
   where goods_receipt_line_id = 'b0000000-0000-4000-8000-000000500061'$$,
  'the line that went back has no uplift, rather than an uplift of none', null);

select '── removing the charge removes the allocation' as "──";

select t.expect_rows($$
  delete from receipt_charges
   where goods_receipt_id = 'b0000000-0000-4000-8000-000000500060'$$,
  'the freight invoice turned out to be somebody else''s', 1);
select t.expect_value($$
  select count(*)::text from receipt_line_charges lc
   where lc.goods_receipt_line_id = 'b0000000-0000-4000-8000-000000500062'$$,
  'and its allocation goes with it rather than lingering as an uplift', '0');

select '── a delivery with freight on it can still be removed' as "──";

/*
 * Deleting a receipt cascades to its charges, and the reallocation trigger
 * then fires for a receipt that no longer exists. The first draft raised
 * "there is no such goods receipt" and refused the delete — so a delivery
 * with freight on it could never be removed at all.
 *
 * Found by running the seed a second time, which is the only way it could
 * have been: the first run has nothing to clean up. Worth an assertion
 * because nothing else in this file deletes a parent row.
 */
select t.fixture($$
  insert into goods_receipts (id, org_id, supplier_id, received_on,
                              reference, reference_stem)
  values ('b0000000-0000-4000-8000-000000500070',
          (select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000500010', current_date,
          'GRN-KIT-260101-903', 'KIT-260101-903')$$);
select t.fixture($$
  insert into goods_receipt_lines
    (id, org_id, goods_receipt_id, product_id, quantity_received, unit,
     unit_price, line_number)
  values ('b0000000-0000-4000-8000-000000500071',
          (select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000500070',
          'b0000000-0000-4000-8000-000000500002', 10, 'kg', 1000, 1)$$);
select t.fixture($$
  insert into receipt_charges (org_id, goods_receipt_id, kind, basis, amount)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000500070', 'FREIGHT', 'VALUE', 500)$$);

select t.expect_rows($$
  delete from goods_receipts
   where id = 'b0000000-0000-4000-8000-000000500070'$$,
  'the delivery is removed rather than held hostage by its own freight', 1);

select t.expect_value($$
  select count(*)::text from receipt_charges
   where goods_receipt_id = 'b0000000-0000-4000-8000-000000500070'$$,
  'and the charge goes with it', '0');

select '── who may record one' as "──";

select t.expect_guarded('receipt_charges', 'PURCHASING');
select t.expect_value($$
  select count(*)::text from section_read_rules
   where table_name in ('receipt_charges', 'receipt_line_charges')$$,
  'both tables are registered in the read-rules registry', '2');

select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_fail($$
  insert into receipt_charges (org_id, goods_receipt_id, kind, basis, amount)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000500020', 'DUTY', 'QUANTITY', 10)$$,
  'somebody with no Purchasing access records none');

select t.expect_refused(
  'select public.allocate_receipt_charges(''b0000000-0000-4000-8000-000000500020''::uuid)',
  'nor re-spreads one that is already there',
  'edit access to Purchasing');

reset role;
rollback;
