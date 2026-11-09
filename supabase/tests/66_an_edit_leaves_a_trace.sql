-- ---------------------------------------------------------------------------
-- An edit leaves a trace (0126)
-- ---------------------------------------------------------------------------
-- The ledger is written by a trigger, from a registry, and read through a
-- policy. Each of those three is a place where it can go quiet without going
-- wrong — and a quiet audit trail is the worst kind of false pass in this
-- repository, because the screen still shows the entries from before it
-- stopped and nobody looks at an empty history and concludes the mechanism is
-- broken.
--
-- So the wiring checks come first and they are not decoration:
--
--   * A column named in `audited_fields` that does not exist on the table
--     records nothing at all. `->>` on a missing key returns null, null is
--     not distinct from null, and the loop simply skips it. No error, ever.
--   * A trigger attached to a table the registry has forgotten, or a registry
--     row with no trigger, is the same silence from the other end.
--   * A `read_section` that drifts from the section guarding writes to the
--     table hands the history to the wrong audience, which is the one failure
--     here that is worse than silence.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset
select id as t5 from employees
 where employee_number = 'T-5' and org_id = :'demo' \gset

select '── audit wiring: the registry and the triggers cannot drift ─────';

/*
 * The silent one. A typo in a column name is invisible at install time and
 * stays invisible forever: nothing raises, the field is simply never
 * recorded. This is the only check that catches it.
 */
select t.expect_value($$
  select coalesce(string_agg(f.table_name || '.' || f.column_name, ', ' order by 1), '')
    from audited_fields f
   where not exists (select 1 from information_schema.columns c
                      where c.table_schema = 'public'
                        and c.table_name = f.table_name
                        and c.column_name = f.column_name)$$,
  'every audited column exists on the table that claims it', '');

select t.expect_value($$
  select coalesce(string_agg(x.what, ', ' order by 1), '')
    from (
      select t.table_name || '.' || t.org_column as what
        from audited_tables t
       where not exists (select 1 from information_schema.columns c
                          where c.table_schema = 'public' and c.table_name = t.table_name
                            and c.column_name = t.org_column)
      union all
      select t.table_name || '.' || t.key_column
        from audited_tables t
       where not exists (select 1 from information_schema.columns c
                          where c.table_schema = 'public' and c.table_name = t.table_name
                            and c.column_name = t.key_column)
      union all
      select t.table_name || '.' || t.unit_column
        from audited_tables t
       where t.unit_column is not null
         and not exists (select 1 from information_schema.columns c
                          where c.table_schema = 'public' and c.table_name = t.table_name
                            and c.column_name = t.unit_column)
    ) x$$,
  'and so does every venue, key and unit column the trigger reads', '');

select t.expect_value($$
  select coalesce(string_agg(t.table_name, ', ' order by 1), '')
    from audited_tables t
   where not exists (
     select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid
      where c.relname = t.table_name
        and g.tgname = t.table_name || '_field_audit')$$,
  'every table in the registry carries the trigger', '');

select t.expect_value($$
  select coalesce(string_agg(c.relname, ', ' order by 1), '')
    from pg_trigger g join pg_class c on c.oid = g.tgrelid
   where g.tgname = c.relname || '_field_audit'
     and not exists (select 1 from audited_tables t where t.table_name = c.relname)$$,
  'and every trigger has a row in the registry', '');

/*
 * Decision 4 of 0126: the history is read under WRITE on the section that
 * already guards writes to the table. Where the table has a `_section_guard`
 * the registry took the section from it rather than restating it, so this
 * asserts they have not since diverged — a guard moved to another section
 * would otherwise leave the history behind on the old one.
 */
select t.expect_value($$
  select coalesce(string_agg(c.relname || ': guard ' || g.sect || ', history ' || t.read_section,
                             ', ' order by c.relname), '')
    from (select tgrelid, split_part(encode(tgargs, 'escape'), '\000', 1) as sect, tgname
            from pg_trigger) g
    join pg_class c on c.oid = g.tgrelid
    join audited_tables t on t.table_name = c.relname
   where g.tgname = c.relname || '_section_guard'
     -- `member_access` carries a guard with no section argument: which
     -- section a grant belongs to is the grant's own `section_code`, decided
     -- row by row. Its history reads under ADMIN, stated by hand in 0126.
     and g.sect <> ''
     and g.sect <> t.read_section$$,
  'and reads under the same section that guards writing it', '');

select '── audit: an edit leaves a trace ───────────────────────────────';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_rows(format($$
  insert into products (id, org_id, category, name, pack_unit, units_per_pack,
                        buying_price_per_pack)
  values ('c0000000-0000-4000-8000-000000000661', %L, 'T-audit', 'T-audited product',
          'kg', 1, 10000)$$, :'demo'),
  'a chef adds a product', 1);

/*
 * One line for the insert, not one per column. "Was nothing, now 10000" said
 * twelve times is the insert restated, and it buries the one edit that
 * matters when it arrives.
 */
select t.expect_value($$
  select count(*)::text from field_changes
   where record_id = 'c0000000-0000-4000-8000-000000000661'$$,
  'and the row''s creation is one line, not one per column', '1');

select t.expect_value($$
  select action || ' by ' || changed_by_email from field_changes
   where record_id = 'c0000000-0000-4000-8000-000000000661'$$,
  'recorded as an insert, by the caller', 'INSERT by chef@test.local');

/*
 * The whole point of the feature. Note `nett_price_per_unit` changing in the
 * same statement: it is derived, it is not in the registry, and it must not
 * appear — one price edit is one line, not six.
 */
select t.expect_rows($$
  update products set buying_price_per_pack = 12500, nett_price_per_unit = 99
   where id = 'c0000000-0000-4000-8000-000000000661'$$,
  'the chef changes the price', 1);

select t.expect_value($$
  select field_name || ': ' || old_value || ' → ' || new_value
    from field_changes
   where record_id = 'c0000000-0000-4000-8000-000000000661' and action = 'UPDATE'$$,
  'the price change is recorded with both values',
  'buying_price_per_pack: 10000.00000 → 12500.00000');

select t.expect_value($$
  select count(*)::text from field_changes
   where record_id = 'c0000000-0000-4000-8000-000000000661' and action = 'UPDATE'$$,
  'and the derived columns rewritten beside it are not', '1');

select t.expect_rows($$
  update products set buying_price_per_pack = 12500
   where id = 'c0000000-0000-4000-8000-000000000661'$$,
  'the chef saves the same price again', 1);

select t.expect_value($$
  select count(*)::text from field_changes
   where record_id = 'c0000000-0000-4000-8000-000000000661' and action = 'UPDATE'$$,
  'a save that changed nothing records nothing', '1');

/*
 * `is not distinct from`, not `<>`. With `<>` a value going to or from null
 * compares null, records nothing, and this is the edit most worth having: a
 * price that was set and is now blank costs every recipe using it nothing.
 */
select t.expect_rows($$
  update products set buying_price_per_pack = null
   where id = 'c0000000-0000-4000-8000-000000000661'$$,
  'the chef clears the price', 1);

select t.expect_value($$
  select coalesce(new_value, '(null)') from field_changes
   where record_id = 'c0000000-0000-4000-8000-000000000661' and action = 'UPDATE'
     and old_value = '12500.00000'$$,
  'a price cleared to nothing is recorded, not skipped', '(null)');

select t.expect_rows($$
  delete from products where id = 'c0000000-0000-4000-8000-000000000661'$$,
  'the chef deletes the product', 1);

select t.expect_value($$
  select action || ' by ' || changed_by_email from field_changes
   where record_id = 'c0000000-0000-4000-8000-000000000661' and action = 'DELETE'$$,
  'the deletion is recorded, which nothing else in this database does',
  'DELETE by chef@test.local');

/*
 * The trail outlives the row. A foreign key on `record_id` would have taken
 * it away again, which is why there is not one.
 */
select t.expect_value($$
  select count(*)::text from field_changes
   where record_id = 'c0000000-0000-4000-8000-000000000661'$$,
  'and the history survives the row it describes', '4');

select '── audit: the fields whose values are not copied ───────────────';

/*
 * As the owner, not the chef. `employee_private` is not gated by the PEOPLE
 * section at all on the way in — writing it needs OWNER or ADMIN (0078) —
 * and a test that used the chef here would have been asserting the audit
 * trail of a write that never happened.
 */
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');

select t.expect_rows(format($$
  insert into employee_private (employee_id, org_id, bank_account, national_id)
  values (%L, %L, 'T-ACCT-1', 'T-NID-1')$$, :'t5', :'demo'),
  'a bank account is recorded for somebody', 1);

select t.expect_rows(format($$
  update employee_private set bank_account = 'T-ACCT-2' where employee_id = %L$$, :'t5'),
  'and then changed', 1);

select t.expect_value(format($$
  select field_name || ' withheld=' || values_withheld
    from field_changes
   where table_name = 'employee_private' and record_id = %L and action = 'UPDATE'$$, :'t5'),
  'that the bank account changed is recorded', 'bank_account withheld=true');

/*
 * The values are not here. An audit trail over `employee_private` that copied
 * them would be a second copy of the most sensitive column in the database,
 * under a different read gate, which 0080's erasure would then have to find.
 */
select t.expect_value(format($$
  select coalesce(old_value, '(absent)') || '/' || coalesce(new_value, '(absent)')
    from field_changes
   where table_name = 'employee_private' and record_id = %L and action = 'UPDATE'$$, :'t5'),
  'and neither the old account number nor the new one is copied here',
  '(absent)/(absent)');

select '── audit: nobody can write it, including the owner ─────────────';

select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');

/*
 * A forged entry is worse than no entry: it is a trail that looks real. The
 * grant is the control, so this asks for the privilege rather than the
 * behaviour — a policy would be irrelevant with INSERT in hand.
 */
select t.expect_value($$
  select (has_table_privilege('authenticated', 'public.field_changes', 'insert')
       or has_table_privilege('authenticated', 'public.field_changes', 'update')
       or has_table_privilege('authenticated', 'public.field_changes', 'delete'))::text$$,
  'a signed-in user cannot insert, change or remove an entry', 'false');

select t.expect_value($$
  select (has_table_privilege('anon', 'public.field_changes', 'select')
       or has_table_privilege('anon', 'public.audited_tables', 'select')
       or has_table_privilege('anon', 'public.audited_fields', 'select'))::text$$,
  'and the public key reaches none of it', 'false');

select t.expect_refused($$
  insert into audited_fields (table_name, column_name) values ('products', 'brand')$$,
  'nor decide for themselves what is audited', 'permission denied');

reset role;

/*
 * Append-only against the owner of the table, which is the half the grants do
 * not cover: a migration, a seeder, or a well-meaning function written next
 * year all run as this role.
 */
select t.expect_refused($$
  update field_changes set new_value = 'T-tampered'
   where table_name = 'products' and action = 'UPDATE'$$,
  'the ledger cannot be rewritten even by the role that owns it',
  'cannot be rewritten');

select t.expect_refused($$
  delete from field_changes where table_name = 'products'$$,
  'nor can an entry be removed', 'cannot be deleted');

/*
 * The one delete the trigger has to allow, and why it has to: `org_id`
 * cascades, and a cascade is a DELETE. Refusing it made the key impossible to
 * honour — `supabase db reset` stopped on `seed.sql`, which deletes the venues
 * it then rebuilds. Creating the venue is itself an audited event, so the row
 * to delete exists without any further setup.
 */
insert into organizations (id, name, slug)
values ('c0000000-0000-4000-8000-0000000006aa', 'T-Audit Venue', 't-audit-venue');

select t.expect_value($$
  select (count(*) > 0)::text from field_changes
   where org_id = 'c0000000-0000-4000-8000-0000000006aa'$$,
  'a new venue records its own creation', 'true');

select t.expect_rows($$
  delete from organizations where id = 'c0000000-0000-4000-8000-0000000006aa'$$,
  'the venue can still be deleted', 1);

select t.expect_value($$
  select count(*)::text from field_changes
   where org_id = 'c0000000-0000-4000-8000-0000000006aa'$$,
  'and its history goes with it, which is what the cascade is for', '0');

select '── audit: a trigger the registry has forgotten stops the write ──';

/*
 * The drastic branch, and deliberately drastic. The alternative is a table
 * that quietly stops being audited while its history tab still shows last
 * month's entries — silence that reads as "nothing has changed".
 */
savepoint before_the_registry_was_edited;
delete from audited_fields where table_name = 'products';
delete from audited_tables where table_name = 'products';

select t.expect_refused(format($$
  insert into products (org_id, category, name, pack_unit, units_per_pack)
  values (%L, 'T-audit', 'T-orphan', 'kg', 1)$$, :'demo'),
  'a write to an audited table the registry has forgotten is refused',
  'audited_tables has no row');

rollback to savepoint before_the_registry_was_edited;

select t.expect_value($$select count(*)::text from audited_tables
                         where table_name = 'products'$$,
  'and the registry is back', '1');

select '── audit: who may read the history ─────────────────────────────';

/*
 * nobody@ is granted nothing by the fixtures, so these grants are the
 * experiment: WRITE on the catalogue's section and nothing else. Decision 4
 * says that is exactly enough for the catalogue's history and not a line of
 * anybody else's.
 */
update member_access set level = 'WRITE'
 where org_id = :'demo' and user_id = 'a0000000-0000-0000-0000-000000000003'
   and section_code = 'RECIPES' and business_unit_id is null;

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');

select t.expect_value($$
  select (count(*) > 0)::text from field_changes where table_name = 'products'$$,
  'RECIPES write reads the catalogue''s history', 'true');

select t.expect_value($$
  select count(*)::text from field_changes where table_name = 'member_access'$$,
  'and not one line of who was granted access to what', '0');

select t.expect_value($$
  select count(*)::text from field_changes where table_name = 'employee_private'$$,
  'nor that somebody''s bank details were changed', '0');

/*
 * WRITE, not READ. The current price is on half the screens in the app by
 * design; the trail of who changed it is a supervisory question, and this is
 * the assertion that keeps it one. `max()` over the enum means the unscoped
 * READ grant below replaces nothing — it is simply the only one left.
 */
reset role;
/*
 * As the owner, because the grid's own guard reads the caller from the token
 * and nobody@ has just been given RECIPES and nothing else. Resetting the
 * role does not reset who the token says you are, which is the point of
 * 0085: the guard asks the session, not the row.
 */
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
update member_access set level = 'READ'
 where org_id = :'demo' and user_id = 'a0000000-0000-0000-0000-000000000003'
   and section_code = 'RECIPES' and business_unit_id is null;
set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');

select t.expect_value($$
  select count(*)::text from field_changes where table_name = 'products'$$,
  'READ on the catalogue reads the prices and none of the history', '0');

select t.act_as('a0000000-0000-0000-0000-0000000000ff', 'outsider@test.local');
select t.expect_value($$select count(*)::text from field_changes$$,
  'a signed-in stranger reads nothing at all', '0');

select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_value($$
  select (count(*) > 0)::text from field_changes$$,
  'the owner of the venue reads all of it', 'true');

select '── audit: erasure reaches the trail it is in ───────────────────';

/*
 * 0080 sweeps every `%_email` column in a table that names its venue, so a
 * ledger written afterwards is covered the day it exists — but only if it has
 * both, and only if the append-only trigger does not refuse the rewrite. Both
 * are assumptions this file is the right place to hold.
 *
 * The edit is made as staff@, who is T-5, so the address in the trail is the
 * address the erasure is asked to remove.
 */
reset role;
update member_access set level = 'WRITE'
 where org_id = :'demo' and user_id = 'a0000000-0000-0000-0000-000000000004'
   and section_code = 'RECIPES' and business_unit_id is null;

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000004', 'staff@test.local');
select t.expect_rows(format($$
  insert into products (id, org_id, category, name, pack_unit, units_per_pack,
                        buying_price_per_pack)
  values ('c0000000-0000-4000-8000-000000000662', %L, 'T-audit', 'T-erasure product',
          'kg', 1, 500)$$, :'demo'),
  'staff@ adds a product', 1);
select t.expect_rows($$
  update products set buying_price_per_pack = 750
   where id = 'c0000000-0000-4000-8000-000000000662'$$,
  'and changes its price', 1);

select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_ok(format($$select public.anonymise_person(%L, 'T-DSR-66')$$, :'t5'),
  'the owner anonymises them on request');

select t.expect_value($$
  select (changed_by_email ~ '^former-employee-[0-9]+@redacted\.invalid$')::text
    from field_changes
   where record_id = 'c0000000-0000-4000-8000-000000000662' and action = 'UPDATE'$$,
  'their address in the audit trail is the pseudonym, not emptied', 'true');

select t.expect_value($$
  select field_name || ': ' || old_value || ' → ' || new_value from field_changes
   where record_id = 'c0000000-0000-4000-8000-000000000662' and action = 'UPDATE'$$,
  'and the edit itself survives the erasure',
  'buying_price_per_pack: 500.00000 → 750.00000');

rollback;
