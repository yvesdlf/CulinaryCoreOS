-- ---------------------------------------------------------------------------
-- Per-product unit conversions (0090)
-- ---------------------------------------------------------------------------
-- The table a venue records "1 bunch = 80 g" in, and the view that lists the
-- recipe lines nothing can cost. The resolution order itself is pure and is
-- tested in apps/web/src/engine/unit-conversion.test.ts; what is asserted
-- here is the part only the database can enforce — who may write it, which
-- rows it refuses, and that the report agrees with the resolver about which
-- lines are broken.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

-- A product priced per gram, and a recipe that asks for it by the bunch.
insert into products (id, org_id, name, category, pack_unit, status,
                      gross_unit, stock_unit, gross_price_per_unit)
values ('b0000000-0000-4000-8000-00000000c001', :'demo', 'T-Coriander',
        'Produce', 'bunch', 'ACTIVE', 'g', 'g', 0.04);
insert into recipes (id, org_id, name, category, status, yield_qty, yield_unit)
values ('b0000000-0000-4000-8000-00000000c010', :'demo', 'T-Salsa',
        'Sauce', 'ACTUAL', 1, 'kg');
insert into recipe_lines (id, org_id, recipe_id, line_number, product_id,
                          nett_qty, nett_unit)
values ('b0000000-0000-4000-8000-00000000c011', :'demo',
        'b0000000-0000-4000-8000-00000000c010', 1,
        'b0000000-0000-4000-8000-00000000c001', 1, 'bunch');

-- A second line in kilograms against the same per-gram product. Physics
-- covers it, so it must NOT appear in the report.
insert into recipe_lines (id, org_id, recipe_id, line_number, product_id,
                          nett_qty, nett_unit)
values ('b0000000-0000-4000-8000-00000000c012', :'demo',
        'b0000000-0000-4000-8000-00000000c010', 2,
        'b0000000-0000-4000-8000-00000000c001', 0.2, 'kg');

select '── what the table refuses' as "──";

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_rows($$
  insert into product_unit_conversions (org_id, product_id, from_unit, to_unit, factor, note)
  values ((select id from organizations where name = 'Demo Kitchen'),
          'b0000000-0000-4000-8000-00000000c001', 'bunch', 'g', 80,
          'weighed five bunches and averaged')$$,
  'somebody with Recipes writes what a bunch weighs', 1);

/*
 * Zero would cost every line using it at nothing, which is the failure this
 * whole file exists to stop — a wrong number arriving quietly.
 */
select t.expect_refused($$
  insert into product_unit_conversions (org_id, product_id, from_unit, to_unit, factor)
  values ((select id from organizations where name = 'Demo Kitchen'),
          'b0000000-0000-4000-8000-00000000c001', 'punnet', 'g', 0)$$,
  'a factor of zero is not a conversion', 'factor');
select t.expect_refused($$
  insert into product_unit_conversions (org_id, product_id, from_unit, to_unit, factor)
  values ((select id from organizations where name = 'Demo Kitchen'),
          'b0000000-0000-4000-8000-00000000c001', 'punnet', 'g', -5)$$,
  'nor is a negative one', 'factor');
select t.expect_refused($$
  insert into product_unit_conversions (org_id, product_id, from_unit, to_unit, factor)
  values ((select id from organizations where name = 'Demo Kitchen'),
          'b0000000-0000-4000-8000-00000000c001', 'g', ' G ', 2)$$,
  'a unit does not convert to itself for anything but one',
  'product_unit_conversions_distinct');
select t.expect_refused($$
  insert into product_unit_conversions (org_id, product_id, from_unit, to_unit, factor)
  values ((select id from organizations where name = 'Demo Kitchen'),
          'b0000000-0000-4000-8000-00000000c001', 'bunch', 'g', 90)$$,
  'and one product cannot hold two answers for the same pair',
  'product_unit_conversions_unique');

select t.expect_refused($$
  update products set density_g_per_ml = 0
   where id = 'b0000000-0000-4000-8000-00000000c001'$$,
  'a density of zero is refused too', 'products_density_positive');

select '── who may write it' as "──";

-- nobody@ is a member with NONE on every section.
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_refused($$
  insert into product_unit_conversions (org_id, product_id, from_unit, to_unit, factor)
  values ((select id from organizations where name = 'Demo Kitchen'),
          'b0000000-0000-4000-8000-00000000c001', 'crate', 'g', 5000)$$,
  'somebody with no catalogue access records nothing', 'RECIPES');
reset role;
select t.expect_value($$select count(*)::text from product_unit_conversions
                         where from_unit = 'crate'$$,
  'and no row was written', '0');

select t.expect_guarded('product_unit_conversions', 'RECIPES');

select '── the report names the lines nothing can cost' as "──";

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

/*
 * The bunch line is answered by the row written above, so the report should
 * be empty — and the kilogram line should never have been in it, because
 * physics covers kg against g without anybody recording anything.
 */
select t.expect_value($$select count(*)::text from recipe_lines_needing_conversion
                         where recipe_name = 'T-Salsa'$$,
  'nothing outstanding once the bunch is recorded', '0');

reset role;
delete from product_unit_conversions
 where product_id = 'b0000000-0000-4000-8000-00000000c001' and from_unit = 'bunch';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_value($$select line_unit || ' -> ' || product_unit
                          from recipe_lines_needing_conversion
                         where recipe_name = 'T-Salsa'$$,
  'take it away and the bunch line is reported, naming both units',
  'bunch -> g');
select t.expect_value($$select count(*)::text from recipe_lines_needing_conversion
                         where recipe_name = 'T-Salsa'$$,
  'and only that line — the kilogram one is physics, not a gap', '1');

select '── a density answers mass against volume' as "──";

reset role;
insert into products (id, org_id, name, category, pack_unit, status,
                      gross_unit, stock_unit, gross_price_per_unit)
values ('b0000000-0000-4000-8000-00000000c002', :'demo', 'T-Honey',
        'Store', 'jar', 'ACTIVE', 'g', 'g', 0.02);
insert into recipe_lines (id, org_id, recipe_id, line_number, product_id,
                          nett_qty, nett_unit)
values ('b0000000-0000-4000-8000-00000000c013', :'demo',
        'b0000000-0000-4000-8000-00000000c010', 3,
        'b0000000-0000-4000-8000-00000000c002', 50, 'ml');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_value($$select count(*)::text from recipe_lines_needing_conversion
                         where product_name = 'T-Honey'$$,
  'millilitres of a product priced by the gram is a gap', '1');

reset role;
update products set density_g_per_ml = 1.42
 where id = 'b0000000-0000-4000-8000-00000000c002';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_value($$select count(*)::text from recipe_lines_needing_conversion
                         where product_name = 'T-Honey'$$,
  'until the product says what a millilitre of it weighs', '0');

select '── and it stays inside the venue' as "──";

/*
 * The view is security_invoker, so it carries the policies of the three
 * tables it reads rather than its owner's. An owner's-rights view here would
 * have handed every venue's catalogue to every caller, which is what 0077
 * went through the whole schema to prevent.
 *
 * A member with NONE on every section still sees these rows, and that is
 * deliberate, not a hole: the catalogue is registered in section_read_rules
 * as shared, because purchasing, inventory and production are all built on
 * it. Asserted rather than left implied, so that a later change making it
 * private shows up here as a decision instead of a surprise.
 */
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_value($$select count(*)::text from recipe_lines_needing_conversion
                         where recipe_name = 'T-Salsa'$$,
  'a member of the venue reads it even with no section access, as the catalogue is shared', '1');

-- The boundary that does hold: no membership, nothing.
select t.act_as_nobody();
select t.expect_value($$select count(*)::text from recipe_lines_needing_conversion$$,
  'somebody who is in no venue sees no lines at all', '0');
select t.expect_value($$select count(*)::text from product_unit_conversions$$,
  'nor any conversions', '0');

reset role;
rollback;
