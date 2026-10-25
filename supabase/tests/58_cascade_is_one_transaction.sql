-- ---------------------------------------------------------------------------
-- The row that started the cascade goes in with it (0117)
-- ---------------------------------------------------------------------------
-- 0005 made the fan-out atomic and left the row that caused it outside. The
-- product update and the cascade were two independent requests, so either
-- could commit while the other failed.
--
-- The assertion worth having is the self-concealing direction: the cascade
-- landing *without* the product update. Nothing on screen contradicts it —
-- the recipes carry the new cost and the ingredient still shows the old
-- price — so it is found weeks later by somebody checking a dish against its
-- ingredient and finding arithmetic that does not reconcile.
--
-- A refusal anywhere in the call must therefore leave every part of it
-- unwritten, which is what the rollback checks below are for.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into products (id, org_id, name, category, pack_unit, status,
                      total_unit, gross_price_per_unit)
values ('b0000000-0000-4000-8000-000000580001', :'demo', 'T-Cascade-Flour',
        'Dry', 'kg', 'ACTIVE', 'kg', 10000);

insert into sub_recipes (id, org_id, name, category, status,
                         batch_yield_qty, batch_yield_unit, total_cost, version)
values ('b0000000-0000-4000-8000-000000580010', :'demo', 'T-Cascade-Dough',
        'Bakery', 'ACTUAL', 10, 'kg', 50000, 1);

insert into sub_recipe_lines
  (org_id, sub_recipe_id, line_number, product_id, nett_qty, nett_unit,
   gross_qty, gross_unit, cost_per_unit, line_cost)
values (:'demo', 'b0000000-0000-4000-8000-000000580010', 1,
        'b0000000-0000-4000-8000-000000580001', 5, 'kg', 5, 'kg', 10000, 50000);

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select '── one call writes the cause and the effect' as "──";

select t.expect_ok($$
  select public.apply_cascade(
    jsonb_build_array(jsonb_build_object(
      'id', 'b0000000-0000-4000-8000-000000580010',
      'total_cost', 60000,
      'cost_per_unit', 6000,
      'lines', jsonb_build_array(jsonb_build_object(
        'line_number', 1,
        'product_id', 'b0000000-0000-4000-8000-000000580001',
        'nett_qty', 5, 'nett_unit', 'kg',
        'gross_qty', 5, 'gross_unit', 'kg',
        'cost_per_unit', 12000, 'line_cost', 60000)))),
    '[]'::jsonb,
    jsonb_build_object(
      'entity', 'product',
      'id', 'b0000000-0000-4000-8000-000000580001',
      'row', jsonb_build_object('gross_price_per_unit', 12000)))$$,
  'a price rise and the dough it re-costs, in one call');

select t.expect_value($$
  select gross_price_per_unit::text from products
   where id = 'b0000000-0000-4000-8000-000000580001'$$,
  'the ingredient carries the new price', '12000.00000');

select t.expect_value($$
  select total_cost::text from sub_recipes
   where id = 'b0000000-0000-4000-8000-000000580010'$$,
  'and the dough carries the cost derived from it', '60000.00000');

select '── a refusal leaves nothing behind' as "──";

/*
 * The cascade names a sub-recipe that does not exist, which 0005 already
 * refuses. What this proves is that the *product* update in the same call
 * goes back with it — before 0117 that update was a separate request and
 * would have committed regardless.
 */
select t.expect_fail($$
  select public.apply_cascade(
    jsonb_build_array(jsonb_build_object(
      'id', '00000000-0000-4000-8000-00000000dead',
      'total_cost', 1, 'cost_per_unit', 1, 'lines', '[]'::jsonb)),
    '[]'::jsonb,
    jsonb_build_object(
      'entity', 'product',
      'id', 'b0000000-0000-4000-8000-000000580001',
      'row', jsonb_build_object('gross_price_per_unit', 99999)))$$,
  'a cascade naming a row that is not writable is refused');

select t.expect_value($$
  select gross_price_per_unit::text from products
   where id = 'b0000000-0000-4000-8000-000000580001'$$,
  'and the ingredient price did not move with it', '12000.00000');

select '── the version check still holds' as "──";

select t.expect_refused($$
  select public.apply_cascade('[]'::jsonb, '[]'::jsonb,
    jsonb_build_object(
      'entity', 'sub_recipe',
      'id', 'b0000000-0000-4000-8000-000000580010',
      'expected_version', 99,
      'row', jsonb_build_object('total_cost', 1)))$$,
  'saving against a version somebody else has moved past is refused',
  'changed by somebody else');

select t.expect_value($$
  select total_cost::text from sub_recipes
   where id = 'b0000000-0000-4000-8000-000000580010'$$,
  'and the figure is untouched', '60000.00000');

select t.expect_ok($$
  select public.apply_cascade('[]'::jsonb, '[]'::jsonb,
    jsonb_build_object(
      'entity', 'sub_recipe',
      'id', 'b0000000-0000-4000-8000-000000580010',
      'expected_version', (select version from sub_recipes
                            where id = 'b0000000-0000-4000-8000-000000580010'),
      'row', jsonb_build_object('total_cost', 61000)))$$,
  'and the same save against the version it actually has is accepted');

select '── a sub-recipe brings its own lines' as "──";

/*
 * A sub-recipe is not downstream of itself, so its lines are never in the
 * cascade array. Without the primary carrying them, the one set of lines the
 * person actually edited is the set left outside the transaction.
 */
select t.expect_ok($$
  select public.apply_cascade('[]'::jsonb, '[]'::jsonb,
    jsonb_build_object(
      'entity', 'sub_recipe',
      'id', 'b0000000-0000-4000-8000-000000580010',
      'row', jsonb_build_object('total_cost', 70000),
      'lines', jsonb_build_array(
        jsonb_build_object(
          'line_number', 1,
          'product_id', 'b0000000-0000-4000-8000-000000580001',
          'nett_qty', 7, 'nett_unit', 'kg',
          'gross_qty', 7, 'gross_unit', 'kg',
          'cost_per_unit', 10000, 'line_cost', 70000))))$$,
  'the edited sub-recipe sends its own lines');

select t.expect_value($$
  select gross_qty::text from sub_recipe_lines
   where sub_recipe_id = 'b0000000-0000-4000-8000-000000580010'$$,
  'which are written', '7');

select t.expect_value($$
  select count(*)::text from sub_recipe_lines
   where sub_recipe_id = 'b0000000-0000-4000-8000-000000580010'$$,
  'replacing the old ones rather than adding to them', '1');

select '── what it refuses to write' as "──";

/*
 * The partial update is built from jsonb at run time, so the thing to prove
 * is that it cannot be pointed at a table nobody intended.
 */
select t.expect_refused($$
  select public.apply_cascade('[]'::jsonb, '[]'::jsonb,
    jsonb_build_object('entity', 'employees', 'id',
      'b0000000-0000-4000-8000-000000580001', 'row', '{}'::jsonb))$$,
  'a cascade cannot be told to start from an arbitrary table',
  'cannot be started by');

/*
 * A key that is not a column is ignored rather than refused, which is what
 * PostgREST did: making this stricter would break saves that work today.
 * Worth asserting so the choice is visible rather than incidental.
 */
select t.expect_ok($$
  select public.apply_cascade('[]'::jsonb, '[]'::jsonb,
    jsonb_build_object(
      'entity', 'product',
      'id', 'b0000000-0000-4000-8000-000000580001',
      'row', jsonb_build_object('not_a_column', 1, 'gross_price_per_unit', 13000)))$$,
  'an unknown key is ignored, as it was before');
select t.expect_value($$
  select gross_price_per_unit::text from products
   where id = 'b0000000-0000-4000-8000-000000580001'$$,
  'and the keys that are columns still land', '13000.00000');

reset role;
rollback;
