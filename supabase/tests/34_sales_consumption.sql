-- ---------------------------------------------------------------------------
-- Selling a dish consumes stock (0092)
-- ---------------------------------------------------------------------------
-- The part worth testing hardest is the recursion: a dish built on a sauce
-- built on a stock must expand all three levels and scale at each one. The
-- existing production view does one level and drops the rest, which is
-- exactly the mistake this must not repeat.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

-- Three products, all priced per gram or millilitre so the arithmetic is
-- readable: bones, wine, beef.
insert into products (id, org_id, name, category, pack_unit, status,
                      gross_unit, stock_unit, gross_price_per_unit)
values ('b0000000-0000-4000-8000-00000000e001', :'demo', 'T-Bones',
        'Butchery', 'kg', 'ACTIVE', 'g', 'g', 0.01),
       ('b0000000-0000-4000-8000-00000000e002', :'demo', 'T-Wine',
        'Cellar', 'l', 'ACTIVE', 'ml', 'ml', 0.02),
       ('b0000000-0000-4000-8000-00000000e003', :'demo', 'T-Beef',
        'Butchery', 'kg', 'ACTIVE', 'g', 'g', 0.15);

/*
 * Three levels.
 *
 *   T-Stock     yields 1000 ml, from 2000 g of bones
 *   T-Sauce     yields  500 ml, from  250 ml of T-Stock + 100 ml of wine
 *   T-Steak     one portion    , from  200 g of beef   + 50 ml of T-Sauce
 *
 * So one steak should need:
 *   beef  200 g
 *   wine  50/500 of a sauce batch = 0.1 batch -> 10 ml
 *   bones 0.1 batch of sauce -> 25 ml of stock -> 25/1000 of a stock batch
 *         = 0.025 -> 50 g
 */
insert into sub_recipes (id, org_id, name, category, status, batch_yield_qty, batch_yield_unit)
values ('b0000000-0000-4000-8000-00000000e010', :'demo', 'T-Stock', 'Base', 'ACTUAL', 1000, 'ml'),
       ('b0000000-0000-4000-8000-00000000e011', :'demo', 'T-Sauce', 'Base', 'ACTUAL', 500, 'ml');

-- nett and gross are the same here: no trim, so no ref_percent. The
-- explosion reads gross, which is the as-purchased quantity.
insert into sub_recipe_lines (org_id, sub_recipe_id, line_number, product_id,
                              nett_qty, nett_unit, gross_qty, gross_unit)
values (:'demo', 'b0000000-0000-4000-8000-00000000e010', 1,
        'b0000000-0000-4000-8000-00000000e001', 2000, 'g', 2000, 'g'),
       (:'demo', 'b0000000-0000-4000-8000-00000000e011', 2,
        'b0000000-0000-4000-8000-00000000e002', 100, 'ml', 100, 'ml');
insert into sub_recipe_lines (org_id, sub_recipe_id, line_number, child_sub_recipe_id,
                              nett_qty, nett_unit, gross_qty, gross_unit)
values (:'demo', 'b0000000-0000-4000-8000-00000000e011', 1,
        'b0000000-0000-4000-8000-00000000e010', 250, 'ml', 250, 'ml');

insert into recipes (id, org_id, name, category, status, yield_qty, yield_unit)
values ('b0000000-0000-4000-8000-00000000e020', :'demo', 'T-Steak', 'Mains', 'ACTUAL', 1, 'portion');
insert into recipe_lines (org_id, recipe_id, line_number, product_id,
                          nett_qty, nett_unit, gross_qty, gross_unit)
values (:'demo', 'b0000000-0000-4000-8000-00000000e020', 1,
        'b0000000-0000-4000-8000-00000000e003', 200, 'g', 200, 'g');
insert into recipe_lines (org_id, recipe_id, line_number, sub_recipe_id,
                          nett_qty, nett_unit, gross_qty, gross_unit)
values (:'demo', 'b0000000-0000-4000-8000-00000000e020', 2,
        'b0000000-0000-4000-8000-00000000e011', 50, 'ml', 50, 'ml');

-- Stock on hand, and twelve steaks sold.
insert into stock_movements (org_id, product_id, kind, quantity, unit, occurred_at)
values (:'demo', 'b0000000-0000-4000-8000-00000000e001', 'RECEIPT', 10000, 'g', now() - interval '3 days'),
       (:'demo', 'b0000000-0000-4000-8000-00000000e002', 'RECEIPT', 3000, 'ml', now() - interval '3 days'),
       (:'demo', 'b0000000-0000-4000-8000-00000000e003', 'RECEIPT', 8000, 'g', now() - interval '3 days');

insert into sales_periods (id, org_id, name, starts_on, ends_on, source)
values ('b0000000-0000-4000-8000-00000000e030', :'demo', 'T-PERIOD',
        current_date - 1, current_date - 1, 'CSV');
insert into sales_lines (id, org_id, period_id, recipe_id, units_sold, net_sales,
                         business_date, pos_item_code, covers, gross_amount)
values ('b0000000-0000-4000-8000-00000000e031', :'demo',
        'b0000000-0000-4000-8000-00000000e030',
        'b0000000-0000-4000-8000-00000000e020', 12, 480,
        current_date - 1, 'TILL-STEAK', 9, 528);

-- A line the till sent that nobody has mapped to a recipe yet.
insert into sales_lines (org_id, period_id, recipe_id, units_sold, net_sales,
                         business_date, pos_item_code)
values (:'demo', 'b0000000-0000-4000-8000-00000000e030', null, 5, 25,
        current_date - 1, 'TILL-COFFEE');

select '── a dish is exploded through every level' as "──";

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_value($$select qty_per_portion::text from recipe_product_requirements
                         where recipe_id = 'b0000000-0000-4000-8000-00000000e020'
                           and product_id = 'b0000000-0000-4000-8000-00000000e003'$$,
  'the beef is on the recipe itself', '200.00000');

/*
 * One level down, scaled. 50 ml of a sauce that yields 500 ml is a tenth of
 * a batch, and the batch takes 100 ml of wine.
 */
select t.expect_value($$select qty_per_portion::text from recipe_product_requirements
                         where recipe_id = 'b0000000-0000-4000-8000-00000000e020'
                           and product_id = 'b0000000-0000-4000-8000-00000000e002'$$,
  'the wine comes through the sauce, scaled to a tenth of its batch', '10.00000');

/*
 * Two levels down. This is the assertion that matters: the existing
 * production view would return nothing here, because it joins one level of
 * sub-recipe lines and never follows a child.
 */
select t.expect_value($$select qty_per_portion::text from recipe_product_requirements
                         where recipe_id = 'b0000000-0000-4000-8000-00000000e020'
                           and product_id = 'b0000000-0000-4000-8000-00000000e001'$$,
  'and the bones come through the stock inside the sauce', '50.00000');

select t.expect_value($$select deepest_level::text from recipe_product_requirements
                         where recipe_id = 'b0000000-0000-4000-8000-00000000e020'
                           and product_id = 'b0000000-0000-4000-8000-00000000e001'$$,
  'three levels deep, and the view says so', '3');

select '── what a period should have used' as "──";

select t.expect_value($$select qty::text from sales_usage_theoretical
                         where sales_line_id = 'b0000000-0000-4000-8000-00000000e031'
                           and product_name = 'T-Beef'$$,
  'twelve steaks need twelve times the beef', '2400.00000');
select t.expect_value($$select qty::text from sales_usage_theoretical
                         where sales_line_id = 'b0000000-0000-4000-8000-00000000e031'
                           and product_name = 'T-Bones'$$,
  'and twelve times the bones, two levels down', '600.00000');

/*
 * The unmapped till line is still listed.
 *
 * Every line is unmapped until somebody maps the codes, and a report that
 * quietly dropped them would make the mapping look finished.
 */
select t.expect_value($$select count(*)::text from sales_usage_theoretical
                         where period_id = 'b0000000-0000-4000-8000-00000000e030'
                           and recipe_id is null$$,
  'a till line with no recipe is shown, not dropped', '1');

select '── posting it to the ledger' as "──";

select t.expect_value($$select post_sales_consumption('b0000000-0000-4000-8000-00000000e030')::text$$,
  'one movement per product, not per sales line', '3');

reset role;
select t.expect_value($$select quantity::text from stock_movements
                         where product_id = 'b0000000-0000-4000-8000-00000000e003'
                           and kind = 'USAGE' and reason = 'sales'$$,
  'consumption is negative, because on hand is the sum of the ledger',
  '-2400.00000');
select t.expect_value($$select on_hand::text from product_stock
                         where product_id = 'b0000000-0000-4000-8000-00000000e003'$$,
  'so the beef on hand comes down', '5600.00000');
select t.expect_value($$select on_hand::text from product_stock
                         where product_id = 'b0000000-0000-4000-8000-00000000e001'$$,
  'and so do the bones nobody ordered directly', '9400.00000');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_refused($$select post_sales_consumption('b0000000-0000-4000-8000-00000000e030')$$,
  'and a period posts once', 'already been posted');

select '── theoretical against actual' as "──";

/*
 * A count says 5000 g of beef when the books, after the sale, say 5600.
 * The six hundred that went missing is the number the whole chain exists to
 * surface, and it can only exist because the two sides are computed from
 * different evidence.
 */
reset role;
insert into stock_movements (org_id, product_id, kind, quantity, unit, reason, occurred_at)
values (:'demo', 'b0000000-0000-4000-8000-00000000e003', 'COUNT', -600, 'g', 'stocktake', now());

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_value($$select theoretical_used::text from food_cost_variance
                         where product_name = 'T-Beef'$$,
  'the recipes say this much went out', '2400.00000');
select t.expect_value($$select count_adjustment::text from food_cost_variance
                         where product_name = 'T-Beef'$$,
  'the count says this much more is gone', '-600.00000');
select t.expect_value($$select adjustment_value::text from food_cost_variance
                         where product_name = 'T-Beef'$$,
  'which is what it cost', '-90.00000');
select t.expect_value($$select counts_behind_it::text from food_cost_variance
                         where product_name = 'T-Beef'$$,
  'standing on one count, and the report says so', '1');

select '── and it stays behind Inventory' as "──";

select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_value($$select count(*)::text from food_cost_variance$$,
  'somebody with no Inventory access sees no variance', '0');
select t.expect_refused($$select post_sales_consumption('b0000000-0000-4000-8000-00000000e030')$$,
  'nor posts a period', 'INVENTORY');

reset role;
rollback;
