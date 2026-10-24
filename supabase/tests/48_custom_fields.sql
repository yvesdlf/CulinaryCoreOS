-- ---------------------------------------------------------------------------
-- A venue adds its own fields (0106)
-- ---------------------------------------------------------------------------
-- The point of defining a field is that the value is then checked. A jsonb
-- column with no rules is a notes field with braces in it.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into products (id, org_id, name, category, pack_unit, status)
values ('b0000000-0000-4000-8000-0000000c0001', :'demo', 'T-CF-Product',
        'Store', 'kg', 'ACTIVE');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select '── defining fields' as "──";

select t.expect_rows($$
  insert into custom_field_definitions (org_id, entity_type, key, label, field_type)
  values ((select id from organizations where name='Demo Kitchen'),
          'products', 'shelf_code', 'Shelf code', 'TEXT')$$,
  'a text field is defined', 1);
select t.expect_rows($$
  insert into custom_field_definitions (org_id, entity_type, key, label, field_type, min_value, max_value)
  values ((select id from organizations where name='Demo Kitchen'),
          'products', 'shelf_life_days', 'Shelf life', 'NUMBER', 1, 400)$$,
  'and a number with a range', 1);
select t.expect_rows($$
  insert into custom_field_definitions (org_id, entity_type, key, label, field_type, options)
  values ((select id from organizations where name='Demo Kitchen'),
          'products', 'certification', 'Certification', 'SELECT',
          array['halal','organic','none'])$$,
  'and a choice', 1);

/*
 * A key ends up in exports, API payloads and whatever somebody builds on
 * top, so it is an identifier rather than a label.
 */
select t.expect_refused($$
  insert into custom_field_definitions (org_id, entity_type, key, label)
  values ((select id from organizations where name='Demo Kitchen'),
          'products', 'Shelf Code ', 'Shelf code')$$,
  'a key with capitals and a trailing space is refused',
  'custom_field_definitions_key');
select t.expect_refused($$
  insert into custom_field_definitions (org_id, entity_type, key, label, field_type)
  values ((select id from organizations where name='Demo Kitchen'),
          'products', 'empty_choice', 'Empty', 'SELECT')$$,
  'and a choice with nothing to choose from',
  'custom_field_definitions_options');
select t.expect_refused($$
  insert into custom_field_definitions (org_id, entity_type, key, label)
  values ((select id from organizations where name='Demo Kitchen'),
          'invoices_maybe', 'x', 'X')$$,
  'nor a field on a table that does not take them',
  'custom_field_definitions_entity');

select '── values are checked against the definition' as "──";

select t.expect_rows($$
  update products set custom_fields =
    '{"shelf_code":"A14","shelf_life_days":90,"certification":"halal"}'::jsonb
   where id = 'b0000000-0000-4000-8000-0000000c0001'$$,
  'valid values are accepted', 1);
select t.expect_value($$select custom_fields ->> 'shelf_code' from products
                         where id = 'b0000000-0000-4000-8000-0000000c0001'$$,
  'and read back', 'A14');

/*
 * Refused rather than ignored. Silently dropping an unknown key means an
 * import that looks successful and loses a column.
 */
select t.expect_refused($$
  update products set custom_fields = '{"invented_key":"x"}'::jsonb
   where id = 'b0000000-0000-4000-8000-0000000c0001'$$,
  'a key nobody defined is refused, not quietly dropped', 'no custom field called');

select t.expect_refused($$
  update products set custom_fields = '{"shelf_life_days":"ninety"}'::jsonb
   where id = 'b0000000-0000-4000-8000-0000000c0001'$$,
  'text in a number field is refused', 'expects a number');
select t.expect_refused($$
  update products set custom_fields = '{"shelf_life_days":4000}'::jsonb
   where id = 'b0000000-0000-4000-8000-0000000c0001'$$,
  'and a number outside its range', 'at most');
select t.expect_refused($$
  update products set custom_fields = '{"certification":"kosher"}'::jsonb
   where id = 'b0000000-0000-4000-8000-0000000c0001'$$,
  'a choice that is not on the list names the list', 'must be one of');

/*
 * Null is "not set" and is always allowed, which is how a field is cleared
 * without deleting the key from every row.
 */
select t.expect_rows($$
  update products set custom_fields = '{"shelf_code":null}'::jsonb
   where id = 'b0000000-0000-4000-8000-0000000c0001'$$,
  'clearing a field is allowed', 1);

select '── a custom field cannot block something that never heard of it' as "──";

/*
 * There is deliberately no "required" flag. A venue making a field required
 * would stop every import, every API caller and every screen that does not
 * know about it, and the failure would arrive as a constraint violation
 * somewhere unrelated.
 */
select t.expect_value($$select count(*)::text from information_schema.columns
                         where table_name = 'custom_field_definitions'
                           and column_name in ('required','mandatory')$$,
  'there is no required flag, on purpose', '0');
select t.expect_rows($$
  insert into products (org_id, name, category, pack_unit, status)
  values ((select id from organizations where name='Demo Kitchen'),
          'T-CF-Ignorant', 'Store', 'kg', 'ACTIVE')$$,
  'so something that has never heard of the fields still writes', 1);

select '── defining one is an administration act' as "──";

reset role;
select t.act_as_nobody();
delete from member_access
 where user_id = 'a0000000-0000-0000-0000-000000000003' and section_code = 'ADMIN';
insert into member_access (org_id, user_id, section_code, level)
values ((select id from organizations where name='Demo Kitchen'),
        'a0000000-0000-0000-0000-000000000003', 'RECIPES', 'WRITE')
on conflict (org_id, user_id, section_code) where business_unit_id is null
  do update set level = 'WRITE';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_value($$select count(*)::text from custom_field_definitions$$,
  'anybody in the venue can read what the fields mean', '3');
select t.expect_refused($$
  insert into custom_field_definitions (org_id, entity_type, key, label)
  values ((select id from organizations where name='Demo Kitchen'),
          'products', 'sneaky', 'Sneaky')$$,
  'but defining one needs Administration', 'row-level security|denied');

reset role;
rollback;
