-- ---------------------------------------------------------------------------
-- The variance carries its own caveats (0097)
-- ---------------------------------------------------------------------------
-- A product nobody counted reads 0 in the adjustment column, and so does a
-- product counted perfectly. Those are opposite facts and the view has to
-- tell them apart, or the most incomplete rows look like the best ones.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into products (id, org_id, name, category, pack_unit, status,
                      gross_unit, stock_unit, gross_price_per_unit)
values ('b0000000-0000-4000-8000-000000040001', :'demo', 'T-Truffle',
        'Store', 'g', 'ACTIVE', 'g', 'g', 500),
       ('b0000000-0000-4000-8000-000000040002', :'demo', 'T-Sticks',
        'Store', 'box', 'ACTIVE', 'ea', 'ea', 0.01);

-- Both were used by sales. Only the sticks were ever counted.
insert into stock_movements (org_id, product_id, kind, quantity, unit, reason, occurred_at)
values (:'demo','b0000000-0000-4000-8000-000000040001','USAGE', -20, 'g','sales', now()),
       (:'demo','b0000000-0000-4000-8000-000000040002','USAGE', -400,'ea','sales', now()),
       (:'demo','b0000000-0000-4000-8000-000000040002','COUNT', -400,'ea','stocktake', now());

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select '── a value on both sides, so money can be compared' as "──";

select t.expect_value($$select theoretical_value::text from food_cost_variance
                         where product_name = 'T-Truffle'$$,
  'the theoretical side is priced now, not only the count side', '10000.00000');

/*
 * By quantity the sticks are twenty times the truffle. By money they are
 * nothing. This is the whole reason the column was added.
 */
select t.expect_value($$select product_name from food_cost_variance
                         where product_name like 'T-%'
                         order by abs(theoretical_value) desc limit 1$$,
  'and ranking by money puts the truffle above four hundred cocktail sticks',
  'T-Truffle');

select '── never counted is not the same as counted perfectly' as "──";

select t.expect_value($$select never_counted::text from food_cost_variance
                         where product_name = 'T-Truffle'$$,
  'a product nobody counted says so', 'true');
select t.expect_value($$select count_adjustment::text from food_cost_variance
                         where product_name = 'T-Truffle'$$,
  'even though its adjustment reads zero, like a perfect count', '0.00000');
select t.expect_value($$select never_counted::text from food_cost_variance
                         where product_name = 'T-Sticks'$$,
  'and a product that was counted does not', 'false');
select t.expect_value($$select (last_counted_at is not null)::text from food_cost_variance
                         where product_name = 'T-Sticks'$$,
  'carrying when it was counted', 'true');

select '── an unmapped till code understates the theoretical side' as "──";

reset role;
insert into sales_periods (id, org_id, name, starts_on, ends_on, source)
values ('b0000000-0000-4000-8000-000000040010', :'demo', 'T-VP',
        current_date - 1, current_date - 1, 'CSV');

/*
 * The flag is deliberately venue-wide — one unmapped code caveats every
 * figure on the page — so testing the clean state means there has to be
 * one. Anything already unmapped in this venue is cleared inside the
 * transaction, which rolls back. Without this the test passes only on a
 * database nobody has used.
 */
delete from sales_lines
 where recipe_id is null and pos_item_code is not null
   and org_id = (select id from organizations where name = 'Demo Kitchen');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_value($$select sales_partly_unmapped::text from food_cost_variance
                         where product_name = 'T-Truffle'$$,
  'with every code mapped, nothing is flagged', 'false');

reset role;
insert into sales_lines (org_id, period_id, recipe_id, units_sold, net_sales,
                         business_date, pos_item_code)
values (:'demo','b0000000-0000-4000-8000-000000040010', null, 9, 90000,
        current_date - 1, 'T-TILL-UNKNOWN');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_value($$select sales_partly_unmapped::text from food_cost_variance
                         where product_name = 'T-Truffle'$$,
  'one unmapped code and every figure on the page is caveated', 'true');

/*
 * Mapping it clears the flag, which is what makes the caveat actionable
 * rather than permanent decoration.
 */
reset role;
insert into recipes (id, org_id, name, category, status, yield_qty, yield_unit)
values ('b0000000-0000-4000-8000-000000040020', :'demo','T-Unknown-Dish','Mains','ACTUAL',1,'portion');
insert into menus (id, org_id, name) values
  ('b0000000-0000-4000-8000-000000040030', :'demo', 'T-Var-Menu');
insert into menu_items (menu_id, recipe_id, pos_item_code)
values ('b0000000-0000-4000-8000-000000040030',
        'b0000000-0000-4000-8000-000000040020', 'T-TILL-UNKNOWN');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_value($$select sales_partly_unmapped::text from food_cost_variance
                         where product_name = 'T-Truffle'$$,
  'and mapping it clears the caveat', 'false');

select '── and it stays behind Inventory' as "──";

select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_value($$select count(*)::text from food_cost_variance$$,
  'somebody with no catalogue or Inventory access sees nothing', '0');

reset role;
rollback;
