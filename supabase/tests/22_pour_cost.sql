-- ---------------------------------------------------------------------------
-- A bottle is not an ingredient (0075)
-- ---------------------------------------------------------------------------
-- Gap 23: "the gap between 28 measures and what the till says is the whole of
-- beverage control."
--
-- Two rules are worth more than the arithmetic:
--
--   A product with no pour row is costed exactly as it was. That is every
--   product in every venue today, and a second cost basis that quietly
--   re-costed the catalogue would move every dish price in the platform.
--
--   Nulls stay null. "Nothing was sold" and "nothing was poured" are different
--   statements, and a variance that reads the first as the second accuses a bar
--   of pouring away its entire stock.
-- ---------------------------------------------------------------------------

begin;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select '── pour: nothing is costed differently until somebody says so ───';

select t.expect_value($$select count(*)::text from product_pour$$,
  'no product is poured until a venue says it is', '0');
select t.expect_value($$select count(*)::text from pour_cost$$,
  'and the second cost basis says nothing about anything', '0');

select '── pour: twenty-eight measures out of a bottle ──────────────────';

/*
 * A 700 ml bottle poured in 25 ml measures is the example gap 23 uses, and
 * 700/25 is 28 exactly — so a wrong rounding rule shows up as 27 or 29 rather
 * than hiding in a decimal.
 */
select t.fixture($$
  insert into products (org_id, category, name, pack_qty, pack_unit, units_per_pack,
                        units_per_pack_unit, total_unit, stock_unit,
                        buying_price_per_pack, nett_price_per_unit)
  select id, 'Beverage', 'T-gin', 1, 'bottle', 700, 'ml', 'ml', 'ml', 350000, 500
    from organizations where name='Demo Kitchen' limit 1 $$);

select t.expect_rows($$
  insert into product_pour (product_id, measure_size)
  select id, 25 from products where name='T-gin'$$,
  'the bar says a measure is 25 ml', 1);

select t.expect_value($$
  select measures_per_container::text from pour_cost where product_name='T-gin'$$,
  'and a bottle should pour twenty-eight of them', '28');
select t.expect_value($$
  select cost_per_measure::text from pour_cost where product_name='T-gin'$$,
  'each costing twelve and a half thousand', '12500.00000');

select '── pour: what never reaches the glass is the venue''s figure ─────';

/*
 * Zero by default on purpose. A venue that has not thought about it gets a
 * variance that is too harsh rather than one that is quietly forgiving, because
 * a flattering default is how a control stops being read.
 */
select t.expect_value($$
  select expected_loss_percent::text from product_pour
   where product_id=(select id from products where name='T-gin')$$,
  'nothing is assumed lost until a venue says so', '0.000');

select t.expect_rows($$
  update product_pour set expected_loss_percent = 4
   where product_id=(select id from products where name='T-gin')$$,
  'the bar pours free and loses four per cent', 1);
select t.expect_value($$
  select measures_per_container::text from pour_cost where product_name='T-gin'$$,
  'so the same bottle should pour twenty-six', '26');
select t.expect_value($$
  select (cost_per_measure > 12500)::text from pour_cost where product_name='T-gin'$$,
  'and a measure costs more, because fewer of them carry the bottle', 'true');

select '── pour: the till against the shelf ─────────────────────────────';

select t.fixture($$
  insert into recipes (org_id, name, status)
  select id, 'T-gin and tonic', 'ACTUAL' from organizations where name='Demo Kitchen' limit 1 $$);
select t.fixture($$
  insert into recipe_lines (recipe_id, line_number, product_id, nett_qty, nett_unit,
                            gross_qty, gross_unit)
  select (select id from recipes where name='T-gin and tonic'), 1,
         (select id from products where name='T-gin'), 25, 'ml', 25, 'ml' $$);
select t.fixture($$
  insert into sales_periods (org_id, name, starts_on, ends_on)
  select id, 'T-pour week', current_date - 7, current_date - 1
    from organizations where name='Demo Kitchen' limit 1 $$);
select t.fixture($$
  insert into sales_lines (period_id, recipe_id, units_sold)
  select (select id from sales_periods where name='T-pour week'),
         (select id from recipes where name='T-gin and tonic'), 100 $$);

select t.expect_value($$
  select measures_sold::text from pour_variance(current_date - 7, current_date - 1)
   where product_name='T-gin'$$,
  'the till says a hundred measures went out', '100.00');

select t.expect_rows($$
  insert into stock_movements (org_id, product_id, kind, quantity, unit, unit_cost,
                               reason, occurred_at)
  select o.id, (select id from products where name='T-gin'), 'USAGE', -2800, 'ml', 500,
         'T-bar usage', current_date - 3
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'and the shelf says a whole bottle came off', 1);

/*
 * The number the whole module exists for. A hundred 25 ml measures is 2.500 ml
 * sold and 2.800 ml gone — three hundred millilitres, which is twelve measures,
 * which at this price is a hundred and fifty thousand nobody took money for.
 */
select t.expect_value($$
  select variance_quantity::text from pour_variance(current_date - 7, current_date - 1)
   where product_name='T-gin'$$,
  'three hundred millilitres more went than was sold', '300.00000');
select t.expect_value($$
  select variance_measures::text from pour_variance(current_date - 7, current_date - 1)
   where product_name='T-gin'$$,
  'which is twelve measures', '12.00');
select t.expect_value($$
  select variance_cost::text from pour_variance(current_date - 7, current_date - 1)
   where product_name='T-gin'$$,
  'and a hundred and fifty thousand nobody took money for', '150000.00000');
select t.expect_value($$
  select comparable::text from pour_variance(current_date - 7, current_date - 1)
   where product_name='T-gin'$$,
  'and the figure is comparable, so it can be acted on', 'true');

select '── pour: a difference that cannot be computed says why ──────────';

/*
 * The same discipline as `production_variance`. A report that reads "nothing
 * sold" as "nothing poured" accuses a bar of pouring away its entire stock.
 */
select t.fixture($$
  insert into products (org_id, category, name, pack_qty, pack_unit, units_per_pack,
                        units_per_pack_unit, total_unit, stock_unit,
                        buying_price_per_pack, nett_price_per_unit)
  select id, 'Beverage', 'T-vermouth', 1, 'bottle', 750, 'ml', 'ml', 'ml', 150000, 200
    from organizations where name='Demo Kitchen' limit 1 $$);
select t.fixture($$
  insert into product_pour (product_id, measure_size)
  select id, 50 from products where name='T-vermouth' $$);
select t.expect_rows($$
  insert into stock_movements (org_id, product_id, kind, quantity, unit, unit_cost,
                               reason, occurred_at)
  select o.id, (select id from products where name='T-vermouth'), 'USAGE', -500, 'ml', 200,
         'T-vermouth poured', current_date - 3
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'half a bottle of vermouth comes off the shelf', 1);

select t.expect_value($$
  select comparable::text from pour_variance(current_date - 7, current_date - 1)
   where product_name='T-vermouth'$$,
  'with no sales against it, the difference is not comparable', 'false');
select t.expect_value($$
  select why_not from pour_variance(current_date - 7, current_date - 1)
   where product_name='T-vermouth'$$,
  'and it says which half is missing rather than reporting a loss',
  'stock went out and no sales were recorded against it');
select t.expect_value($$
  select coalesce(variance_cost::text, 'none')
    from pour_variance(current_date - 7, current_date - 1)
   where product_name='T-vermouth'$$,
  'with no figure attached to it', 'none');

select '── pour: who may set it ─────────────────────────────────────────';

select t.expect_guarded('product_pour', 'RECIPES');
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_fail($$
  update product_pour set measure_size = 1
   where product_id=(select id from products where name='T-gin')$$,
  'somebody with no Recipes access cannot change what a measure is');
select t.expect_value($$
  select measure_size::text from product_pour
   where product_id=(select id from products where name='T-gin')$$,
  'and a measure is still a measure', '25.00000');

rollback;
