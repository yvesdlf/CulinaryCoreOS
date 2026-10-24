-- ---------------------------------------------------------------------------
-- A merge keeps the history and the name (0103)
-- ---------------------------------------------------------------------------
-- The assertion that matters is the one about the ledger. Before this,
-- merging two duplicates cascaded away one of them's stock movements and
-- lot history — the second being what 178/2002 Article 18 traceability
-- rests on. It is written as a before-and-after so it cannot pass by
-- accident on an empty table.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into products (id, org_id, name, category, pack_unit, status, gross_unit, stock_unit)
values ('b0000000-0000-4000-8000-0000000a0001', :'demo', 'T-Tomato (Vine-Ripened)',
        'Produce', 'kg', 'ACTIVE', 'g', 'g'),
       ('b0000000-0000-4000-8000-0000000a0002', :'demo', 'T-Tomatoes vine',
        'Produce', 'kg', 'ACTIVE', 'g', 'g');
insert into suppliers (id, org_id, name)
values ('b0000000-0000-4000-8000-0000000a0003', :'demo', 'T-Merge-Co');

-- The loser carries real history: stock, a lot, a supplier and a conversion.
insert into stock_movements (org_id, product_id, kind, quantity, unit, occurred_at)
values (:'demo', 'b0000000-0000-4000-8000-0000000a0002', 'RECEIPT', 5000, 'g', now() - interval '2 days');
insert into stock_lots (id, org_id, product_id, lot_code, received_on)
values ('b0000000-0000-4000-8000-0000000a0010', :'demo',
        'b0000000-0000-4000-8000-0000000a0002', 'T-LOT-9', current_date - 2);
insert into product_suppliers (org_id, product_id, supplier_id, pack_qty, pack_unit, pack_price)
values (:'demo', 'b0000000-0000-4000-8000-0000000a0002',
        'b0000000-0000-4000-8000-0000000a0003', 1000, 'g', 40000);
insert into product_unit_conversions (org_id, product_id, from_unit, to_unit, factor)
values (:'demo', 'b0000000-0000-4000-8000-0000000a0002', 'crate', 'g', 6000);

select '── before the merge' as "──";

select t.expect_value($$select count(*)::text from stock_movements
                         where product_id = 'b0000000-0000-4000-8000-0000000a0002'$$,
  'the duplicate has a movement', '1');
select t.expect_value($$select count(*)::text from stock_lots
                         where product_id = 'b0000000-0000-4000-8000-0000000a0002'$$,
  'and a lot', '1');

select '── merging keeps all of it' as "──";

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_ok($$select merge_products(
    'b0000000-0000-4000-8000-0000000a0001',
    array['b0000000-0000-4000-8000-0000000a0002']::uuid[])$$,
  'the duplicate is merged away');

reset role;
select t.expect_value($$select count(*)::text from products
                         where id = 'b0000000-0000-4000-8000-0000000a0002'$$,
  'the duplicate row is gone', '0');

/*
 * The heart of it. Before 0103 these were zero, because stock_movements and
 * stock_lots cascade on a product delete — so a merge quietly destroyed a
 * ledger AGENTS.md says has no delete grant, and the lot history the law
 * requires.
 */
select t.expect_value($$select count(*)::text from stock_movements
                         where product_id = 'b0000000-0000-4000-8000-0000000a0001'$$,
  'but its movement moved to the survivor rather than being cascaded away', '1');
select t.expect_value($$select lot_code from stock_lots
                         where product_id = 'b0000000-0000-4000-8000-0000000a0001'$$,
  'and so did its lot, which the traceability law rests on', 'T-LOT-9');
select t.expect_value($$select count(*)::text from product_suppliers
                         where product_id = 'b0000000-0000-4000-8000-0000000a0001'$$,
  'and who sold it', '1');
select t.expect_value($$select factor::text from product_unit_conversions
                         where product_id = 'b0000000-0000-4000-8000-0000000a0001'$$,
  'and what a crate of it weighs', '6000.000000');

select '── and the name it used to have' as "──";

select t.expect_value($$select alias from product_aliases
                         where product_id = 'b0000000-0000-4000-8000-0000000a0001'$$,
  'the losing name is kept, or the duplicate returns on the next import',
  'T-Tomatoes vine');
select t.expect_value($$select source from product_aliases
                         where alias = 'T-Tomatoes vine'$$,
  'marked as having come from a merge', 'merge');

select '── finding a product by something close to its name' as "──";

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_value($$select name from find_products(
    (select id from organizations where name='Demo Kitchen'), 'T-Tomato (Vine-Ripened)', 0.3)
   limit 1$$,
  'an exact name finds itself', 'T-Tomato (Vine-Ripened)');
select t.expect_value($$select count(*)::text from find_products(
    (select id from organizations where name='Demo Kitchen'), 'T-Tomatoes vine', 0.3)
   where product_id = 'b0000000-0000-4000-8000-0000000a0001'$$,
  'and the old name still finds the survivor, through the alias', '1');
select t.expect_value($$select count(*)::text from find_products(
    (select id from organizations where name='Demo Kitchen'), 'zzzz-nothing-like-it', 0.3)$$,
  'something unlike anything finds nothing, rather than the closest row', '0');

select '── what the table refuses' as "──";

select t.expect_refused($$
  insert into product_aliases (product_id, alias)
  values ('b0000000-0000-4000-8000-0000000a0001', '  T-TOMATOES VINE  ')$$,
  'one alias per venue, whatever its casing or spacing',
  'idx_product_aliases_unique');
select t.expect_refused($$
  insert into product_aliases (product_id, alias) values
    ('b0000000-0000-4000-8000-0000000a0001', '   ')$$,
  'and a blank is not a name', 'product_aliases_named');

reset role;
select t.expect_guarded('product_aliases', 'RECIPES');

rollback;
