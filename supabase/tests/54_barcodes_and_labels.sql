-- ---------------------------------------------------------------------------
-- Something to scan, and something to print (0113)
-- ---------------------------------------------------------------------------
-- Two controls carry this file.
--
-- The check digit, because a mistyped barcode does not fail. It attaches to
-- the wrong product, or to none, silently and permanently, and is found by
-- somebody counting a walk-in at six in the morning. The fixture transposes
-- a pair of digits in a real EAN-13, which is the mistake people actually
-- make.
--
-- And the allergen caveat, because a printed label is the most confident
-- surface in a building. AGENTS.md §8: the dangerous failure is not a
-- missing allergen, it is a confident one. So the label carries whether its
-- allergens are still a guess, and the test asserts the caveat survives all
-- the way from a product two preparations down.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into products (id, org_id, name, category, pack_unit, status, total_unit,
                      allergens, allergens_need_review)
values ('b0000000-0000-4000-8000-000000540001', :'demo', 'T-Butter',
        'Dairy', 'kg', 'ACTIVE', 'kg', array['MILK'], false),
       ('b0000000-0000-4000-8000-000000540002', :'demo', 'T-Mystery-Stock',
        'Dry', 'kg', 'ACTIVE', 'kg', array['CELERY'], true),
       ('b0000000-0000-4000-8000-000000540003', :'demo', 'T-Water',
        'Dry', 'l', 'ACTIVE', 'l', array[]::text[], false);

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select '── a barcode that does not add up' as "──";

select t.expect_rows($$
  insert into product_barcodes (org_id, product_id, barcode, kind, describes)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000540001', '5000159484695', 'EAN13',
          'a 250 g block')$$,
  'a real EAN-13 is accepted', 1);

/*
 * The same barcode with two digits transposed. It is thirteen digits, it
 * looks exactly like a barcode, and the check digit is the only thing in the
 * world that knows it is wrong.
 */
select t.expect_refused($$
  insert into product_barcodes (org_id, product_id, barcode, kind)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000540002', '5000159484965', 'EAN13')$$,
  'a transposed pair is refused rather than attached to the wrong product',
  'check digit');

select t.expect_value($$
  select count(*)::text from product_barcodes
   where product_id = 'b0000000-0000-4000-8000-000000540002'$$,
  'and nothing is recorded for it', '0');

/*
 * CODE128 and internal numbers carry no check digit, so they are taken as
 * given. Pretending to validate one would be worse than not validating it:
 * it reads as a guarantee.
 */
select t.expect_rows($$
  insert into product_barcodes (org_id, product_id, barcode, kind, describes)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000540002', 'KITCHEN-STOCK-01',
          'INTERNAL', 'the tub we decant it into')$$,
  'an internal number is taken as given, because it has nothing to check', 1);

select t.expect_refused($$
  insert into product_barcodes (org_id, product_id, barcode, kind)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000540003', '12345', 'EAN13')$$,
  'but a thirteen-digit code that is five digits long is not an EAN-13',
  'product_barcodes_length');

select '── one scan, one answer' as "──";

select t.expect_refused($$
  insert into product_barcodes (org_id, product_id, barcode, kind)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000540003', '5000159484695', 'EAN13')$$,
  'the same barcode cannot mean two products in one venue',
  'idx_product_barcodes_unique|duplicate key');

select t.expect_value($$
  select product_name from public.product_for_barcode(
    (select id from organizations where name='Demo Kitchen'), '5000159484695')$$,
  'scanning it finds the product', 'T-Butter');

/*
 * Nothing, rather than a row of nulls. A careless caller renders a null row
 * as a product called "undefined" and books stock against it.
 */
select t.expect_value($$
  select count(*)::text from public.product_for_barcode(
    (select id from organizations where name='Demo Kitchen'), '0000000000000')$$,
  'scanning something unknown finds nothing, not an empty product', '0');

select '── which number a label prints' as "──";

select t.expect_value($$
  select is_primary::text from product_barcodes
   where barcode = '5000159484695'$$,
  'the first barcode on a product becomes its primary one', 'true');

select t.expect_rows($$
  insert into product_barcodes (org_id, product_id, barcode, kind, describes)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000540001', '96385074', 'EAN8',
          'the catering case')$$,
  'a second barcode for the case it comes in', 1);

select t.expect_value($$
  select count(*)::text from product_barcodes
   where product_id = 'b0000000-0000-4000-8000-000000540001' and is_primary$$,
  'and a product still has exactly one primary', '1');

select '── what goes on the tub' as "──";

insert into sub_recipes (id, org_id, name, category, status,
                         batch_yield_qty, batch_yield_unit)
values ('b0000000-0000-4000-8000-000000540010', :'demo', 'T-Label-Base',
        'Stocks', 'ACTUAL', 10, 'l'),
       ('b0000000-0000-4000-8000-000000540011', :'demo', 'T-Label-Sauce',
        'Sauces', 'ACTUAL', 2, 'l');

insert into sub_recipe_lines
  (org_id, sub_recipe_id, line_number, product_id, child_sub_recipe_id,
   nett_qty, nett_unit, gross_qty, gross_unit)
values
  -- The unverified allergen is two levels down, which is the case that
  -- matters: a caveat that only survives one level is no caveat.
  (:'demo', 'b0000000-0000-4000-8000-000000540010', 1,
   'b0000000-0000-4000-8000-000000540002', null, 1, 'kg', 1, 'kg'),
  (:'demo', 'b0000000-0000-4000-8000-000000540010', 2,
   'b0000000-0000-4000-8000-000000540003', null, 9, 'l', 9, 'l'),
  (:'demo', 'b0000000-0000-4000-8000-000000540011', 1,
   null, 'b0000000-0000-4000-8000-000000540010', 8, 'l', 8, 'l'),
  (:'demo', 'b0000000-0000-4000-8000-000000540011', 2,
   'b0000000-0000-4000-8000-000000540001', null, 0.2, 'kg', 0.2, 'kg');

select t.expect_rows($$
  insert into production_records
    (org_id, sub_recipe_id, batches, batch_yield_qty, sub_recipe_version,
     unit, occurred_at, produced_by_email)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000540011', 1, 2, 1, 'l',
          now() - interval '1 hour', 'chef@test.local')$$,
  'a batch of sauce is made', 1);

select t.expect_value($$
  select item_name || ', made by ' || made_by from prep_label
   where sub_recipe_id = 'b0000000-0000-4000-8000-000000540011'$$,
  'the label describes the batch that exists, not the recipe',
  'T-Label-Sauce, made by chef@test.local');

select t.expect_value($$
  select (use_by - made_on)::text from prep_label
   where sub_recipe_id = 'b0000000-0000-4000-8000-000000540011'$$,
  'with a use-by from the venue''s own policy, not a constant', '3');

select t.expect_value($$
  select expiry_kind::text from prep_label
   where sub_recipe_id = 'b0000000-0000-4000-8000-000000540011'$$,
  'and it is a use-by, because a preparation becomes unsafe rather than worse',
  'USE_BY');

select t.fixture($$
  update venue_parameters set value = 5
   where code = 'PREP_USE_BY_DAYS'
     and org_id = (select id from organizations where name='Demo Kitchen')$$);
select t.expect_value($$
  select (use_by - made_on)::text from prep_label
   where sub_recipe_id = 'b0000000-0000-4000-8000-000000540011'$$,
  'which the venue can change', '5');

select '── the caveat travels with the allergen' as "──";

select t.expect_value($$
  select array_to_string(allergens, ',') from prep_label
   where sub_recipe_id = 'b0000000-0000-4000-8000-000000540011'$$,
  'allergens come from what was consumed, two preparations down included',
  'CELERY,MILK');

/*
 * The assertion this file exists for. The celery came from a product whose
 * allergens were inferred from its name and never checked against a packet.
 * A label that printed it without saying so is the confident failure
 * AGENTS.md §8 describes, and it is the one that hurts somebody.
 */
select t.expect_value($$
  select allergens_need_review::text from prep_label
   where sub_recipe_id = 'b0000000-0000-4000-8000-000000540011'$$,
  'and the label says they still need a person to read a packet', 'true');

select t.expect_value($$
  select array_to_string(unverified_products, ',') from prep_label
   where sub_recipe_id = 'b0000000-0000-4000-8000-000000540011'$$,
  'naming which ingredient nobody has verified', 'T-Mystery-Stock');

select t.fixture($$
  update products set allergens_need_review = false
   where id = 'b0000000-0000-4000-8000-000000540002'$$);
select t.expect_value($$
  select allergens_need_review::text from prep_label
   where sub_recipe_id = 'b0000000-0000-4000-8000-000000540011'$$,
  'and stops saying it once somebody has', 'false');

select '── that a label was printed' as "──";

select t.expect_rows($$
  insert into label_prints
    (org_id, production_record_id, copies, printed_by_email, use_by,
     allergens_shown, allergens_were_unverified)
  select (select id from organizations where name='Demo Kitchen'),
         r.id, 4, 'chef@test.local', current_date + 5,
         array['CELERY','MILK'], false
    from production_records r
   where r.sub_recipe_id = 'b0000000-0000-4000-8000-000000540011'$$,
  'four copies, and the record says what was on them', 1);

/*
 * The allergens are copied onto the print row rather than looked up later.
 * The policy can change and the label cannot — a tub in a walk-in carries
 * whatever was printed on the day, and that is what a recall needs to know.
 */
select t.fixture($$
  update products set allergens = array['CELERY','SULPHITES']
   where id = 'b0000000-0000-4000-8000-000000540002'$$);
select t.expect_value($$
  select array_to_string(allergens_shown, ',') from label_prints
   where printed_by_email = 'chef@test.local'$$,
  'what the tub says does not change when the catalogue does', 'CELERY,MILK');

select '── who may do either' as "──";

select t.expect_guarded('product_barcodes', 'RECIPES');
select t.expect_guarded('label_prints', 'PRODUCTION');
select t.expect_value($$
  select count(*)::text from section_read_rules
   where table_name in ('product_barcodes', 'label_prints')$$,
  'both are registered in the read-rules registry', '2');

reset role;
select t.expect_value($$
  select count(*)::text from organization_seeders
   where function_name = 'seed_prep_label_parameter'$$,
  'the use-by policy is seeded through the registry, not a migration body', '1');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_fail($$
  insert into product_barcodes (org_id, product_id, barcode, kind)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000540003', '0012000001086', 'UPCA')$$,
  'somebody with no Recipes access records no barcode');

reset role;
rollback;
