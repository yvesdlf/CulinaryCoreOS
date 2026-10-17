-- ---------------------------------------------------------------------------
-- A supplier price has a history (0094)
-- ---------------------------------------------------------------------------
-- Append-only, the cache stays current, a backfill does not overwrite today,
-- and a large move tells somebody.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into products (id, org_id, name, category, pack_unit, status,
                      gross_unit, stock_unit)
values ('b0000000-0000-4000-8000-000000010001', :'demo', 'T-Beef-P',
        'Butchery', 'kg', 'ACTIVE', 'g', 'g');
insert into suppliers (id, org_id, name)
values ('b0000000-0000-4000-8000-000000010002', :'demo', 'T-Meat-Co');
insert into product_suppliers (id, org_id, product_id, supplier_id,
                               pack_qty, pack_unit, pack_price, price_per_unit)
values ('b0000000-0000-4000-8000-000000010003', :'demo',
        'b0000000-0000-4000-8000-000000010001',
        'b0000000-0000-4000-8000-000000010002',
        1000, 'g', 100, 0.1);

select '── the default threshold reached every venue' as "──";

select t.expect_value($$select value::text from venue_parameters
                         where org_id = (select id from organizations where name='Demo Kitchen')
                           and code = 'PRICE_MOVE_ALERT'$$,
  'an existing venue got the new parameter, not only new ones', '5.00000');
select t.expect_value($$select count(*)::text from organization_seeders
                         where function_name = 'seed_price_alert_parameter'$$,
  'and it is registered as a seeder rather than edited into another one', '1');

select '── a price appends and the cache follows' as "──";

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_rows($$
  insert into supplier_prices (product_supplier_id, pack_price, valid_from, source)
  values ('b0000000-0000-4000-8000-000000010003', 104, current_date - 10, 'invoice')$$,
  'a price is recorded', 1);
select t.expect_value($$select price_per_unit::text from supplier_prices
                         where pack_price = 104$$,
  'per-unit is derived from the pack on record', '0.10400');
select t.expect_value($$select price_per_unit::text from product_suppliers
                         where id = 'b0000000-0000-4000-8000-000000010003'$$,
  'and the current price follows it', '0.10400');
select t.expect_value($$select recorded_by_email from supplier_prices
                         where pack_price = 104$$,
  'recorded against the caller, from the session', 'chef@test.local');

select t.expect_refused($$
  update supplier_prices set pack_price = 1 where pack_price = 104$$,
  'a price that was charged cannot be edited', 'denied|permission');
select t.expect_refused($$
  delete from supplier_prices where pack_price = 104$$,
  'nor deleted', 'denied|permission');

select '── a backfill does not overwrite today' as "──";

select t.expect_rows($$
  insert into supplier_prices (product_supplier_id, pack_price, valid_from, source)
  values ('b0000000-0000-4000-8000-000000010003', 80, current_date - 300, 'import')$$,
  'last year''s price can be loaded', 1);
select t.expect_value($$select price_per_unit::text from product_suppliers
                         where id = 'b0000000-0000-4000-8000-000000010003'$$,
  'and the current price is untouched by it', '0.10400');

select '── a large move tells somebody' as "──";

-- 104 -> 107 is 2.9%, under the 5% threshold.
select t.expect_rows($$
  insert into supplier_prices (product_supplier_id, pack_price, valid_from, source)
  values ('b0000000-0000-4000-8000-000000010003', 107, current_date - 5, 'invoice')$$,
  'a small rise is recorded', 1);
reset role;
/*
 * Scoped to this test's own supplier product. Counting every PRICE_MOVED in
 * the venue passes only on a database nobody has used — which is how this
 * went red the moment a screen recorded a real price.
 */
select t.expect_value($$select count(*)::text from notifications
                         where kind = 'PRICE_MOVED'
                           and entity_id = 'b0000000-0000-4000-8000-000000010003'$$,
  'and says nothing, because it is inside the threshold', '0');

-- 107 -> 130 is 21.5%.
set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_rows($$
  insert into supplier_prices (product_supplier_id, pack_price, valid_from, source)
  values ('b0000000-0000-4000-8000-000000010003', 130, current_date, 'invoice')$$,
  'a large one is recorded too', 1);
reset role;
select t.expect_value($$select count(*)::text from notifications
                         where kind = 'PRICE_MOVED'
                           and entity_id = 'b0000000-0000-4000-8000-000000010003'$$,
  'and this one is told', '1');
select t.expect_value($$select subject like 'Price up 21.5%%%' from notifications
                         where kind = 'PRICE_MOVED'
                           and entity_id = 'b0000000-0000-4000-8000-000000010003'$$,
  'with the direction and the size in the subject', 'true');

select '── the chart recomputes its own steps' as "──";

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_value($$select moved_percent::text from supplier_price_history
                         where pack_price = 130$$,
  'each row shows the step from the one before it', '21.5');
select t.expect_value($$select previous_per_unit::text from supplier_price_history
                         where pack_price = 104$$,
  'and the backfilled year-old price is what 104 follows, not the cache',
  '0.08000');

select '── and it stays behind Suppliers' as "──";

select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_value($$select count(*)::text from supplier_prices$$,
  'somebody with no Suppliers access sees no prices', '0');
select t.expect_refused($$
  insert into supplier_prices (product_supplier_id, pack_price)
  values ('b0000000-0000-4000-8000-000000010003', 1)$$,
  'nor records one', 'SUPPLIERS');

reset role;
select t.expect_guarded('supplier_prices', 'SUPPLIERS');

rollback;
