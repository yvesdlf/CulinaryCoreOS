-- ---------------------------------------------------------------------------
-- The venue's own mark, and who may change it (0128)
-- ---------------------------------------------------------------------------
-- A logo is the one piece of venue configuration that reaches people outside
-- the venue: it goes on the PDF sent to an accountant, a landlord or a
-- supplier. Whoever can replace it can make a document look like it came from
-- somebody else, so this is a tenancy control rather than a cosmetic setting.
--
-- Storage is also the one place in this system where a rule has to be written
-- twice — once on the column and once on the bucket — because a column
-- somebody cannot write and a file they can is not a control. Both are
-- checked here.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into organizations (id, name, slug)
values ('d0000000-0000-4000-8000-000000000671', 'T-Other Venue 67', 't-other-67')
on conflict (id) do nothing;

select '── branding: who may put a logo on this venue ──────────────────';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');

select t.expect_rows(format($$
  insert into storage.objects (bucket_id, name)
  values ('branding', %L || '/T-logo-67.png')$$, :'demo'),
  'an owner puts a logo on their own venue', 1);

/*
 * The chef holds WRITE on every section in the fixtures — including
 * Administration — and still cannot do this. That is the point: the rule is
 * `auth_is_admin`, the organisation role, not a section grant, and it is the
 * same rule `organizations_update` already applies to the column.
 */
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_fail(format($$
  insert into storage.objects (bucket_id, name)
  values ('branding', %L || '/sneaked.png')$$, :'demo'),
  'a chef with write on every section still cannot');

/*
 * `storage.protect_delete()` refuses *any* direct SQL delete from
 * `storage.objects`, for every role, unless `storage.allow_delete_query` is
 * set — it is there to stop a DELETE leaving a file on disk with no row.
 *
 * The first version of this check did not set it, so the chef's delete was
 * refused by that guard and the assertion passed without the policy being
 * consulted at all. It would have stayed green with no delete policy on the
 * bucket whatsoever. Switching the escape on is what makes the refusal below
 * the policy's.
 */
set local storage.allow_delete_query = 'true';

/*
 * `expect_rows(…, 0)` and not `expect_fail`. A policy filters a DELETE
 * rather than refusing it, so the statement succeeds and changes nothing —
 * the first false pass named in `_harness.sql`, met here for real. The row
 * count is the assertion, and the read below is the proof it survived.
 */
select t.expect_rows($$
  delete from storage.objects
   where bucket_id = 'branding' and name like '%/T-logo-67.png'$$,
  'nor remove the one that is there', 0);

select t.expect_value($$
  select count(*)::text from storage.objects
   where bucket_id = 'branding' and name like '%/T-logo-67.png'$$,
  'and it is still there afterwards', '1');

select t.expect_rows($$
  update storage.objects set metadata = metadata
   where bucket_id = 'branding' and name like '%/T-logo-67.png'$$,
  'nor replace it', 0);

select '── branding: nor on somebody else''s ───────────────────────────';

select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');

/*
 * An owner is an owner of *their* venue. Without the organisation in the
 * path being checked, the first segment would be a field the caller fills in
 * — 0085's mistake, in a bucket.
 */
select t.expect_fail($$
  insert into storage.objects (bucket_id, name)
  values ('branding', 'd0000000-0000-4000-8000-000000000671/T-logo-67.png')$$,
  'an owner cannot put a logo on another venue');

/*
 * `storage_path_org` returns null for anything not shaped `<uuid>/…`, and
 * `auth_is_admin(null)` is not true. Checked because the alternative —
 * a cast raising inside the policy — reads to whoever sees it as the
 * platform being broken rather than the platform saying no.
 */
select t.expect_fail($$
  insert into storage.objects (bucket_id, name)
  values ('branding', 'T-logo-67.png')$$,
  'nor at the root of the bucket, where it would belong to nobody');

select '── branding: who may see it ────────────────────────────────────';

select t.expect_value(format($$
  select count(*)::text from storage.objects
   where bucket_id = 'branding' and name = %L$$, :'demo' || '/T-logo-67.png'),
  'the owner reads their venue''s logo', '1');

select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_value(format($$
  select count(*)::text from storage.objects
   where bucket_id = 'branding' and name = %L$$, :'demo' || '/T-logo-67.png'),
  'and so does a chef, who prints the sheets it goes on', '1');

select t.act_as('a0000000-0000-0000-0000-0000000000ff', 'outsider@test.local');
select t.expect_value($$
  select count(*)::text from storage.objects where bucket_id = 'branding'$$,
  'somebody in no venue reads none of it', '0');

select '── branding: the column follows the same rule ──────────────────';

select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_rows(format($$
  update organizations set logo_path = 'T-sneaked.png' where id = %L$$, :'demo'),
  'a chef''s write to the logo column matches no row', 0);

select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_rows(format($$
  update organizations set logo_path = %L || '/logo.png' where id = %L$$,
  :'demo', :'demo'),
  'the owner''s does', 1);

/*
 * 0128 adds the column to the registry. Who changed the mark that goes on
 * the venue's invoices is exactly what the edit history is for, and it is
 * the one venue parameter whose change is visible outside the building.
 */
reset role;
select t.expect_value(format($$
  select field_name from field_changes
   where table_name = 'organizations' and record_id = %L
     and field_name = 'logo_path'
   order by changed_at desc limit 1$$, :'demo'),
  'and the change is recorded in the edit history', 'logo_path');

rollback;
