-- ---------------------------------------------------------------------------
-- Photographs and short video (0059)
-- ---------------------------------------------------------------------------
-- The control that matters here is a read refusal, and a read refusal is the
-- one thing the other six files in this directory never had to prove. Two
-- consequences, both of which cost an hour to find:
--
--   The suite connects as `postgres`, which is the owner of every table in
--   `public` and is therefore exempt from row-level security. Every refusal
--   proved elsewhere in this directory comes from a *trigger*, which does fire
--   for the owner. A policy does not. So the second half of this file does
--   `set local role authenticated` and asks the questions again as somebody
--   the policies actually apply to — and that role needs USAGE on schema `t`
--   to be able to call the harness at all.
--
--   An empty result and a refused result are the same result. `_harness.sql`
--   warns about the write version of this; the read version is worse, because
--   "the outsider saw nothing" is exactly what a broken fixture also says. So
--   the insider is asked the identical question first and has to see the row.
--   Without that pair, this whole file passes against a table with nothing in
--   it.
-- ---------------------------------------------------------------------------
begin;

/*
 * A second venue, and somebody who belongs only to it.
 *
 * Inserting the user is enough: `on_auth_user_created` gives every sign-up an
 * organisation of its own, which is precisely the outsider this file needs.
 * Everything here is inside the transaction and goes away with the rollback,
 * so `_fixtures.sql` has nothing to clean up.
 */
select t.fixture($$
  insert into auth.users (id, email, instance_id, aud, role) values
    ('b0000000-0000-0000-0000-000000000001','outsider@test.local',
     '00000000-0000-0000-0000-000000000000','authenticated','authenticated') $$);

-- A work order of the outsider's own, so "they cannot read ours" is a
-- statement about access and not about the outsider having no data at all.
select t.fixture($$
  insert into work_orders (org_id, title, raised_by_email)
  select m.organization_id, 'T-their-job', 'outsider@test.local'
    from organization_members m
   where m.user_id = 'b0000000-0000-0000-0000-000000000001' $$);

/*
 * The object, written straight into storage.objects.
 *
 * No session, so the policies stand down and this is the equivalent of the
 * storage service having finished an upload. `metadata` carries what the
 * service records — the size and the type it saw on disk — because that is
 * what the attachment trigger checks the row against.
 */
select t.fixture($$
  insert into storage.objects (bucket_id, name, metadata)
  select 'media',
         o.id::text || '/WORK_ORDER/' || w.id::text || '/aa11bb22-0000-4000-8000-000000000001.jpg',
         jsonb_build_object('size', 2400000, 'mimetype', 'image/jpeg')
    from organizations o
    join work_orders w on w.org_id = o.id and w.title = 'T-job'
   where o.name = 'Demo Kitchen' $$);

select '── media: the limits are the database''s, not the file picker''s ──';

select t.expect_fail($$
  insert into attachments (parent_type, parent_id, object_path, file_name, mime_type, kind, byte_size)
  select 'WORK_ORDER', w.id,
         w.org_id::text || '/WORK_ORDER/' || w.id::text || '/x.exe',
         'ransom.exe', 'application/x-msdownload', 'IMAGE', 1000
    from work_orders w where w.title='T-job'$$,
  'a type that is not a photograph or a clip is refused');

select t.expect_fail($$
  insert into attachments (parent_type, parent_id, object_path, file_name, mime_type, kind, byte_size)
  select 'WORK_ORDER', w.id,
         w.org_id::text || '/WORK_ORDER/' || w.id::text || '/huge.jpg',
         'huge.jpg', 'image/jpeg', 'IMAGE', 20000000
    from work_orders w where w.title='T-job'$$,
  'a photograph over fifteen megabytes is refused');

select t.expect_fail($$
  insert into attachments (parent_type, parent_id, object_path, file_name, mime_type, kind,
                           byte_size, duration_seconds)
  select 'WORK_ORDER', w.id,
         w.org_id::text || '/WORK_ORDER/' || w.id::text || '/long.mp4',
         'long.mp4', 'video/mp4', 'VIDEO', 2400000, 45
    from work_orders w where w.title='T-job'$$,
  'a clip declaring forty-five seconds is refused');

select t.expect_fail($$
  insert into attachments (parent_type, parent_id, object_path, file_name, mime_type, kind, byte_size)
  select 'WORK_ORDER', w.id,
         w.org_id::text || '/WORK_ORDER/' || w.id::text || '/aa11bb22-0000-4000-8000-000000000001.jpg',
         'small.jpg', 'image/jpeg', 'IMAGE', 2000
    from work_orders w where w.title='T-job'$$,
  'a row claiming a size the file on disk does not have is refused');

select t.expect_fail($$
  insert into attachments (parent_type, parent_id, object_path, file_name, mime_type, kind, byte_size)
  select 'WORK_ORDER', w.id,
         w.org_id::text || '/WORK_ORDER/' || w.id::text || '/aa11bb22-0000-4000-8000-000000000001.jpg',
         'fake.png', 'image/png', 'IMAGE', 2400000
    from work_orders w where w.title='T-job'$$,
  'a row claiming a type the file on disk does not have is refused');

select t.expect_fail($$
  insert into attachments (parent_type, parent_id, object_path, file_name, mime_type, kind, byte_size)
  select 'WORK_ORDER', w.id,
         w.org_id::text || '/WORK_ORDER/' || w.id::text || '/never-uploaded.jpg',
         'never-uploaded.jpg', 'image/jpeg', 'IMAGE', 2400000
    from work_orders w where w.title='T-job'$$,
  'a row pointing at a file that was never uploaded is refused');

-- The path is where the storage policy reads its access from, so a row filed
-- under another record's folder would be readable under that record's rule.
select t.expect_fail($$
  insert into attachments (parent_type, parent_id, object_path, file_name, mime_type, kind, byte_size)
  select 'WORK_ORDER', w.id,
         w.org_id::text || '/WORK_ORDER/' || gen_random_uuid()::text || '/aa11bb22-0000-4000-8000-000000000001.jpg',
         'elsewhere.jpg', 'image/jpeg', 'IMAGE', 2400000
    from work_orders w where w.title='T-job'$$,
  'a file stored under a different record is refused');

select t.expect_fail($$
  insert into attachments (parent_type, parent_id, object_path, file_name, mime_type, kind, byte_size)
  select 'WORK_ORDER', gen_random_uuid(),
         w.org_id::text || '/WORK_ORDER/' || w.id::text || '/aa11bb22-0000-4000-8000-000000000001.jpg',
         'orphan.jpg', 'image/jpeg', 'IMAGE', 2400000
    from work_orders w where w.title='T-job'$$,
  'an attachment to a job that does not exist is refused');

-- Enforced at the object too, so an upload nobody records is also refused.
select t.expect_fail($$
  insert into storage.objects (bucket_id, name, metadata)
  values ('media','whatever/WORK_ORDER/x/big.mp4',
          jsonb_build_object('size', 400000000, 'mimetype','video/mp4'))$$,
  'an oversized object is refused even with no attachment row');
select t.expect_fail($$
  insert into storage.objects (bucket_id, name, metadata)
  values ('media','whatever/WORK_ORDER/x/doc.pdf',
          jsonb_build_object('size', 1000, 'mimetype','application/pdf'))$$,
  'a disallowed object is refused even with no attachment row');

select '── media: the row records the caller, not the claim ─────────────';
select t.act_as('a0000000-0000-0000-0000-000000000002','chef@test.local');

select t.expect_rows($$
  insert into attachments (parent_type, parent_id, object_path, file_name, mime_type, kind,
                           byte_size, caption, uploaded_by_email, org_id)
  select 'WORK_ORDER', w.id,
         w.org_id::text || '/WORK_ORDER/' || w.id::text || '/aa11bb22-0000-4000-8000-000000000001.jpg',
         'tap.jpg', 'image/jpeg', 'VIDEO', 2400000,
         'The washer, before.', 'someone.else@test.local',
         (select m.organization_id from organization_members m
           where m.user_id='b0000000-0000-0000-0000-000000000001')
    from work_orders w where w.title='T-job'$$,
  'the photograph is accepted', 1);

-- 0054: the client sent somebody else's address and it is discarded.
select t.expect_value($$select uploaded_by_email from attachments where file_name='tap.jpg'$$,
  'and is filed under the caller, not the address the client sent', 'chef@test.local');
select t.expect_value($$select uploaded_by::text from attachments where file_name='tap.jpg'$$,
  'with the caller''s user id as well', 'a0000000-0000-0000-0000-000000000002');
-- The client said VIDEO. A clip would have taken the ninety-day retention.
select t.expect_value($$select kind::text from attachments where file_name='tap.jpg'$$,
  'the kind comes from the file''s type, not from what the client called it', 'IMAGE');
select t.expect_value($$
  select (a.org_id = w.org_id)::text from attachments a
    join work_orders w on w.id = a.parent_id where a.file_name='tap.jpg'$$,
  'the organisation comes from the job, not from the client''s claim', 'true');
select t.expect_value($$
  select (delete_after::date - uploaded_at::date)::text from attachments where file_name='tap.jpg'$$,
  'and retention sets three years on a work-order photograph', '1095');

select '── media: a venue that has said nothing keeps the file ──────────';
select t.expect_rows($$
  delete from attachment_retention r
   where r.parent_type='WORK_ORDER' and r.kind='IMAGE'
     and r.org_id=(select id from organizations where name='Demo Kitchen')$$,
  'remove the retention row for work-order photographs', 1);
select t.fixture($$
  insert into storage.objects (bucket_id, name, metadata)
  select 'media',
         w.org_id::text || '/WORK_ORDER/' || w.id::text || '/aa11bb22-0000-4000-8000-000000000002.jpg',
         jsonb_build_object('size', 900000, 'mimetype', 'image/jpeg')
    from work_orders w where w.title='T-job' $$);
select t.expect_rows($$
  insert into attachments (parent_type, parent_id, object_path, file_name, mime_type, kind, byte_size)
  select 'WORK_ORDER', w.id,
         w.org_id::text || '/WORK_ORDER/' || w.id::text || '/aa11bb22-0000-4000-8000-000000000002.jpg',
         'after.jpg', 'image/jpeg', 'IMAGE', 900000
    from work_orders w where w.title='T-job'$$,
  'a second photograph with no retention row is accepted', 1);
select t.expect_value($$
  select coalesce(delete_after::text,'kept') from attachments where file_name='after.jpg'$$,
  'and is kept rather than read as nought days', 'kept');

select '── media: attachments are evidence and do not move ──────────────';
select t.expect_value($$select has_table_privilege('authenticated','attachments','UPDATE')::text$$,
  'nobody signed in may edit an attachment', 'false');
select t.expect_value($$select has_table_privilege('authenticated','attachments','DELETE')::text$$,
  'nobody signed in may delete one', 'false');
select t.expect_value($$
  select count(*)::text from pg_policies
   where schemaname='storage' and tablename='objects'
     and policyname in ('media_update','media_remove','media_delete')$$,
  'and there is no policy that would let an object be replaced or removed', '0');
select t.expect_value($$
  select count(*)::text from public.expired_attachments(100)$$,
  'nothing has expired yet, and nothing runs the sweep anyway', '0');

select '── media: a section grant is still the gate on writing ──────────';
select t.act_as('a0000000-0000-0000-0000-000000000003','nobody@test.local');
select t.expect_fail($$
  insert into attachments (parent_type, parent_id, object_path, file_name, mime_type, kind, byte_size)
  select 'WORK_ORDER', w.id,
         w.org_id::text || '/WORK_ORDER/' || w.id::text || '/aa11bb22-0000-4000-8000-000000000002.jpg',
         'sneaked.jpg', 'image/jpeg', 'IMAGE', 900000
    from work_orders w where w.title='T-job'$$,
  'somebody with no Maintenance access cannot photograph a job');
select t.expect_value($$select count(*)::text from attachments where file_name='sneaked.jpg'$$,
  'and no row was written', '0');

-- ---------------------------------------------------------------------------
-- The read refusal, as a role the policies apply to
-- ---------------------------------------------------------------------------
-- `postgres` owns these tables and row-level security does not apply to it, so
-- everything above proved triggers. From here the suite is `authenticated`,
-- which is the role PostgREST and the storage service use, and the questions
-- are asked twice: once by somebody in the venue, who must see the file, and
-- once by somebody in another venue, who must not.
-- ---------------------------------------------------------------------------
select '── media: whose file is it ──────────────────────────────────────';
grant usage on schema t to authenticated;

/*
 * The path, worked out while it is still readable.
 *
 * The outsider has to try to write into our folder, and they cannot build the
 * path themselves — the policy hides the job the path is made of, so the
 * subquery would come back null and the insert would fail on a null name
 * rather than on the policy. Same error, wrong reason, and a pass that proves
 * nothing. So the path is computed here, by somebody who can see it.
 */
create temp table t_media_target as
  select w.id as wo_id,
         w.org_id::text || '/WORK_ORDER/' || w.id::text || '/planted.jpg' as path
    from work_orders w where w.title='T-job';
grant select on t_media_target to authenticated;

set local role authenticated;

select t.act_as('a0000000-0000-0000-0000-000000000002','chef@test.local');
select t.expect_value($$select count(*)::text from attachments where file_name='tap.jpg'$$,
  'the venue''s own chef reads the attachment row', '1');
select t.expect_value($$
  select count(*)::text from storage.objects
   where bucket_id='media' and name like '%aa11bb22-0000-4000-8000-000000000001.jpg'$$,
  'and the object behind it', '1');
/*
 * Joined to the temp table above, and not to `work_orders`.
 *
 * The first version read `where parent_id = (select id from work_orders where
 * title='T-job')`, which passed for the outsider too — not because the view
 * refused them but because the subquery's own policy hid the job, so the
 * filter matched nothing. Found by loosening the attachment policy to
 * `using (true)` and watching this one line stay green while the three beside
 * it went red. A read test whose WHERE clause depends on a row the caller
 * cannot see is testing the WHERE clause.
 *
 * Summing the whole view instead was the next attempt and was worse in the
 * other direction: it counts anything else in the venue and goes red because
 * somebody used the app. The identifier has to come from somewhere both roles
 * can read and neither role's policy governs, which is what the temp table is.
 */
select t.expect_value($$
  select coalesce(sum(c.files),0)::text from attachment_counts c
    join t_media_target g on g.wo_id = c.parent_id$$,
  'and the paperclip count on that job says two', '2');

select t.act_as('b0000000-0000-0000-0000-000000000001','outsider@test.local');
select t.expect_value($$select count(*)::text from work_orders where title='T-their-job'$$,
  'the outsider is a real user with a job of their own', '1');
select t.expect_value($$select count(*)::text from attachments where file_name='tap.jpg'$$,
  'and cannot read another venue''s attachment row', '0');
select t.expect_value($$
  select count(*)::text from storage.objects
   where bucket_id='media' and name like '%aa11bb22-0000-4000-8000-000000000001.jpg'$$,
  'and cannot read the stored object either', '0');
select t.expect_value($$
  select coalesce(sum(c.files),0)::text from attachment_counts c
    join t_media_target g on g.wo_id = c.parent_id$$,
  'and cannot even count them', '0');
-- Reading is refused by the policy; writing has to be refused as well, or the
-- outsider can put a file inside our folder for us to open.
select t.expect_value($$select count(*)::text from t_media_target$$,
  'the path to try is there, so the next line is testing the policy', '1');
select t.expect_fail($$
  insert into storage.objects (bucket_id, name, metadata)
  select 'media', g.path, jsonb_build_object('size', 1000, 'mimetype','image/jpeg')
    from t_media_target g$$,
  'and cannot upload into another venue''s folder');

select '── media: who may change how long files are kept ────────────────';
/*
 * Retention is an administrator's setting, and the refusal has to be read
 * back rather than merely not raising.
 *
 * An UPDATE the policy filters out matches no rows and raises nothing, which
 * is the first of the three false passes `_harness.sql` names. So the count is
 * asserted at nought and the number is read afterwards to show it did not
 * move.
 */
select t.act_as('a0000000-0000-0000-0000-000000000003','nobody@test.local');
select t.expect_rows($$
  update attachment_retention set keep_days = 1
   where parent_type='HACCP_RECORD' and kind='IMAGE'$$,
  'somebody with no Administration access changes no retention row', 0);
select t.expect_value($$
  select keep_days::text from attachment_retention
   where parent_type='HACCP_RECORD' and kind='IMAGE'
     and org_id=(select m.organization_id from organization_members m
                  where m.user_id='a0000000-0000-0000-0000-000000000003')$$,
  'and food-safety photographs are still kept five years', '1825');

select t.act_as('b0000000-0000-0000-0000-000000000001','outsider@test.local');
select t.expect_value($$select count(*)::text from attachment_retention$$,
  'the outsider sees only their own venue''s retention, which is six rows', '6');

-- Back to the owner, so the rollback is not the only thing undoing this.
set local role postgres;
rollback;
