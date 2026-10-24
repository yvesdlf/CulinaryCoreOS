-- ---------------------------------------------------------------------------
-- A preparation made of preparations (0111)
-- ---------------------------------------------------------------------------
-- The defect this fixes was invisible in the worst way. `production_variance`
-- reads the gap between theoretical and actual as waste, and the theoretical
-- side dropped every nested preparation — so a kitchen making a demi-glace
-- from a veal stock appeared to throw away the whole stock, every batch. The
-- figure was plausible, nobody could explain it, and the usual conclusion
-- about an unexplainable variance is that the report is broken.
--
-- So the assertion that matters is not "the explosion works". It is that the
-- variance it feeds comes out at zero when the kitchen did exactly what the
-- recipe says — which is the number somebody actually reads.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into products (id, org_id, name, category, pack_unit, status, total_unit)
values ('b0000000-0000-4000-8000-000000520001', :'demo', 'T-Veal-Bones',
        'Butchery', 'kg', 'ACTIVE', 'kg'),
       ('b0000000-0000-4000-8000-000000520002', :'demo', 'T-Mirepoix-Veg',
        'Veg', 'kg', 'ACTIVE', 'kg'),
       ('b0000000-0000-4000-8000-000000520003', :'demo', 'T-Madeira',
        'Cellar', 'l', 'ACTIVE', 'l');

/*
 * Three levels, because two would not catch a fix that only went one deeper.
 *
 *   T-Veal-Stock   yields 10 l from 5 kg bones and 2 kg veg
 *   T-Demi-Glace   yields  2 l from 8 l of the stock
 *   T-Sauce-Period yields  1 l from 0.5 l of demi-glace and 0.1 l Madeira
 */
insert into sub_recipes (id, org_id, name, category, status,
                         batch_yield_qty, batch_yield_unit)
values ('b0000000-0000-4000-8000-000000520010', :'demo', 'T-Veal-Stock',
        'Stocks', 'ACTUAL', 10, 'l'),
       ('b0000000-0000-4000-8000-000000520011', :'demo', 'T-Demi-Glace',
        'Sauces', 'ACTUAL', 2, 'l'),
       ('b0000000-0000-4000-8000-000000520012', :'demo', 'T-Sauce-Period',
        'Sauces', 'ACTUAL', 1, 'l');

insert into sub_recipe_lines
  (org_id, sub_recipe_id, line_number, product_id, child_sub_recipe_id,
   nett_qty, nett_unit, gross_qty, gross_unit)
values
  (:'demo', 'b0000000-0000-4000-8000-000000520010', 1,
   'b0000000-0000-4000-8000-000000520001', null, 5, 'kg', 5, 'kg'),
  (:'demo', 'b0000000-0000-4000-8000-000000520010', 2,
   'b0000000-0000-4000-8000-000000520002', null, 2, 'kg', 2, 'kg'),
  (:'demo', 'b0000000-0000-4000-8000-000000520011', 1,
   null, 'b0000000-0000-4000-8000-000000520010', 8, 'l', 8, 'l'),
  (:'demo', 'b0000000-0000-4000-8000-000000520012', 1,
   null, 'b0000000-0000-4000-8000-000000520011', 0.5, 'l', 0.5, 'l'),
  (:'demo', 'b0000000-0000-4000-8000-000000520012', 2,
   'b0000000-0000-4000-8000-000000520003', null, 0.1, 'l', 0.1, 'l');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select '── one level down' as "──";

select t.expect_rows($$
  insert into production_records
    (org_id, sub_recipe_id, batches, batch_yield_qty, sub_recipe_version,
     unit, occurred_at, produced_by_email)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000520011', 1, 2, 1, 'l',
          now() - interval '1 hour', 'chef@test.local')$$,
  'one batch of demi-glace is made', 1);

/*
 * One batch of demi-glace takes 8 l of a stock that yields 10, so four
 * fifths of a stock batch: four fifths of 5 kg of bones is 4 kg.
 *
 * Before 0111 this row did not exist at all — the line pointed at a
 * sub-recipe rather than a product and was dropped.
 */
select t.expect_value($$
  select qty::text from production_usage_theoretical
   where sub_recipe_id = 'b0000000-0000-4000-8000-000000520011'
     and product_id = 'b0000000-0000-4000-8000-000000520001'$$,
  'the bones underneath the stock are counted, four fifths of a batch of them',
  '4.00000');

select t.expect_value($$
  select qty::text from production_usage_theoretical
   where sub_recipe_id = 'b0000000-0000-4000-8000-000000520011'
     and product_id = 'b0000000-0000-4000-8000-000000520002'$$,
  'and the vegetables with them', '1.60000');

select '── two levels down' as "──";

select t.expect_rows($$
  insert into production_records
    (org_id, sub_recipe_id, batches, batch_yield_qty, sub_recipe_version,
     unit, occurred_at, produced_by_email)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000520012', 4, 1, 1, 'l',
          now() - interval '1 hour', 'chef@test.local')$$,
  'four batches of the finished sauce', 1);

/*
 * 4 batches × 0.5 l of demi-glace = 2 l, against a demi-glace batch of 2 l,
 * so one whole demi-glace batch — which is 8 l of stock, which is four
 * fifths of a stock batch, which is 4 kg of bones.
 *
 * A fix that walked one extra level would give 2 l of demi-glace and stop.
 */
select t.expect_value($$
  select qty::text from production_usage_theoretical
   where sub_recipe_id = 'b0000000-0000-4000-8000-000000520012'
     and product_id = 'b0000000-0000-4000-8000-000000520001'$$,
  'the bones two preparations below the sauce are still counted', '4.00000');

select t.expect_value($$
  select qty::text from production_usage_theoretical
   where sub_recipe_id = 'b0000000-0000-4000-8000-000000520012'
     and product_id = 'b0000000-0000-4000-8000-000000520003'$$,
  'beside the Madeira the sauce uses directly', '0.40000');

select t.expect_value($$
  select deepest_level::text from production_usage_theoretical
   where sub_recipe_id = 'b0000000-0000-4000-8000-000000520012'
     and product_id = 'b0000000-0000-4000-8000-000000520001'$$,
  'and it says how far down it had to go to find them', '3');

select '── the variance the figure feeds' as "──";

/*
 * The assertion the whole file exists for. The kitchen takes out exactly
 * what the recipe says, so the variance must be nothing. Before 0111 the
 * theoretical side was zero for the bones and every kilo of them read as
 * waste.
 *
 * Eight kilos, not four: both production runs above are inside the window
 * and each one calls for four. The first draft posted four and read -4,
 * which is the same wrong answer the defect produced and would have been an
 * easy thing to call a pass.
 */
select t.fixture($$
  insert into stock_movements
    (org_id, product_id, kind, quantity, unit, reason, occurred_at,
     production_record_id)
  select (select id from organizations where name='Demo Kitchen'),
         'b0000000-0000-4000-8000-000000520001', 'USAGE', -8, 'kg',
         'production', now() - interval '1 hour', r.id
    from production_records r
   where r.sub_recipe_id = 'b0000000-0000-4000-8000-000000520012'$$);

select t.expect_value($$
  select coalesce(round(variance_qty, 3)::text, 'no row')
    from production_variance(current_date - 1, current_date)
   where product_id = 'b0000000-0000-4000-8000-000000520001'$$,
  'taking out exactly what the recipe says leaves no variance at all',
  '0.000');

select '── where the walk has to stop' as "──";

/*
 * A preparation with no batch yield cannot be scaled: two fifths of an
 * unknown quantity is not a number. The walk stops, the ingredients below it
 * are still missing, and the only honest thing is to say so rather than
 * guess — so the record is named, with the preparation that needs a yield.
 */
select t.fixture($$
  update sub_recipes set batch_yield_qty = null
   where id = 'b0000000-0000-4000-8000-000000520010'$$);

select t.expect_value($$
  select unscalable_name from production_expansion_gaps
   where sub_recipe_id = 'b0000000-0000-4000-8000-000000520011'$$,
  'the preparation missing its yield is named, not silently skipped',
  'T-Veal-Stock');

select t.expect_value($$
  select count(*)::text from production_usage_theoretical
   where sub_recipe_id = 'b0000000-0000-4000-8000-000000520011'
     and product_id = 'b0000000-0000-4000-8000-000000520001'$$,
  'and its ingredients are absent rather than invented', '0');

select t.fixture($$
  update sub_recipes set batch_yield_qty = 10
   where id = 'b0000000-0000-4000-8000-000000520010'$$);

select '── a preparation that mentions an ingredient twice' as "──";

/*
 * The grain changed with the fix: one row per record per product, where it
 * was one row per line. That matters because `production_variance` sums
 * `batches` across the rows, so a preparation listing an ingredient twice
 * used to count its batches twice.
 */
select t.fixture($$
  insert into sub_recipe_lines
    (org_id, sub_recipe_id, line_number, product_id, nett_qty, nett_unit,
     gross_qty, gross_unit)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000520010', 3,
          'b0000000-0000-4000-8000-000000520002', 1, 'kg', 1, 'kg')$$);

select t.expect_value($$
  select count(*)::text from production_usage_theoretical
   where sub_recipe_id = 'b0000000-0000-4000-8000-000000520011'
     and product_id = 'b0000000-0000-4000-8000-000000520002'$$,
  'an ingredient named twice is one row, not two', '1');

select t.expect_value($$
  select qty::text from production_usage_theoretical
   where sub_recipe_id = 'b0000000-0000-4000-8000-000000520011'
     and product_id = 'b0000000-0000-4000-8000-000000520002'$$,
  'carrying the sum of both lines', '2.40000');

reset role;
rollback;
