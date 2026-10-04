-- ---------------------------------------------------------------------------
-- One front door (0066, 0067)
-- ---------------------------------------------------------------------------
-- Part C's last structural claim: every department can raise a request to any
-- other and receive theirs, without a sixth table being built for the sixth
-- department.
--
-- The rules worth proving are the ones that stop a front door becoming a
-- suggestion box:
--
--   Anybody may knock. Gating who can raise one rebuilds the bottleneck the
--   whole thing exists to remove.
--
--   Only the receiving department may answer. Otherwise a request is closed by
--   whoever finds it irritating.
--
--   Nothing disappears. No delete, no silent reassignment, no rejection
--   without a reason — because the failure mode here is social, not technical:
--   somebody reports a problem and is never told what happened.
-- ---------------------------------------------------------------------------

begin;

select '── requests: a venue starts with somewhere to send one ──────────';

select t.expect_value($$
  select count(*)::text from organizations o
   where not exists (select 1 from request_types r where r.org_id = o.id)$$,
  'every venue has request types (seed_request_types, through the registry)', '0');

select t.expect_value($$
  select count(*)::text from request_types
   where org_id = (select id from organizations where name='Demo Kitchen')$$,
  'five of them — the five shapes Part C named', '5');

select '── requests: anybody may knock on any department''s door ─────────';

/*
 * `nobody@test.local` is the fixture user granted nothing anywhere. That is
 * precisely who has to be able to report a broken tap.
 */
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');

select t.expect_rows($$
  insert into requests (request_type_id, title, detail)
  select id, 'T-tap dripping in the prep sink', 'Second one this month'
    from request_types
   where code='FAULT'
     and org_id=(select id from organizations where name='Demo Kitchen')$$,
  'somebody with no grant at all raises a fault report', 1);

select t.expect_value($$
  select left(reference, 3) from requests where title='T-tap dripping in the prep sink'$$,
  'and it is numbered', 'RQ-');

select '── requests: it goes where the type says, not where the client does ─';

/*
 * Taken off the type at the moment it is raised. A request addressed to a
 * department by whoever raised it is a request that can be addressed to the
 * wrong one, and the raiser would never know.
 */
select t.expect_value($$
  select b.code from requests r join business_units b on b.id = r.business_unit_id
   where r.title='T-tap dripping in the prep sink'$$,
  'the fault went to the department the type names', 'ADMIN');

select t.expect_rows($$
  insert into requests (request_type_id, title, business_unit_id)
  select id, 'T-misdirected',
         (select b.id from business_units b
           where b.code='KITCHEN' and b.org_id=request_types.org_id)
    from request_types
   where code='GUEST'
     and org_id=(select id from organizations where name='Demo Kitchen')$$,
  'a request naming its own destination is accepted', 1);
select t.expect_value($$
  select b.code from requests r join business_units b on b.id = r.business_unit_id
   where r.title='T-misdirected'$$,
  'and goes to the type''s department anyway, not the one it asked for', 'FOH');

select '── requests: the raiser can watch it ────────────────────────────';

/*
 * Readable by the venue, not by the receiving department alone. "I reported it
 * and nobody told me" is the complaint this is built to answer, and a front
 * door whose contents only the recipient can see does not answer it.
 */
select t.expect_value($$
  select status::text from requests where title='T-tap dripping in the prep sink'$$,
  'the person who raised it can still see it', 'NEW');

select '── requests: only the receiving department answers ──────────────';

select t.expect_fail($$
  update requests set status='CLOSED'
   where title='T-tap dripping in the prep sink'$$,
  'somebody with no grant cannot close what they raised');
select t.expect_value($$
  select status::text from requests where title='T-tap dripping in the prep sink'$$,
  'and it is still open afterwards', 'NEW');

select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_rows($$
  update requests set status='ACKNOWLEDGED'
   where title='T-tap dripping in the prep sink'$$,
  'somebody with Requests does', 1);
select t.expect_value($$
  select (acknowledged_at is not null)::text from requests
   where title='T-tap dripping in the prep sink'$$,
  'and the clock on it is set by the database, not by the client', 'true');

select '── requests: nothing disappears ─────────────────────────────────';

select t.expect_fail($$
  update requests set business_unit_id=(select id from business_units where code='KITCHEN'
    and org_id=(select id from organizations where name='Demo Kitchen'))
   where title='T-tap dripping in the prep sink'$$,
  'a request cannot be quietly moved to another department');

select t.expect_fail($$
  update requests set status='REJECTED'
   where title='T-tap dripping in the prep sink'$$,
  'and cannot be rejected without saying why');
select t.expect_rows($$
  update requests set status='REJECTED', resolution='T-not ours, it is the landlord''s'
   where title='T-misdirected'$$,
  'rejecting with a reason is allowed', 1);

select t.expect_fail($$
  update requests set reference='RQ-FAKE-000000-001'
   where title='T-tap dripping in the prep sink'$$,
  'and the number it was given does not change');

select '── requests: every move is on the record ────────────────────────';

select t.expect_value($$
  select count(*)::text from request_events e
   join requests r on r.id = e.request_id
  where r.title='T-tap dripping in the prep sink'$$,
  'raised and acknowledged are two entries', '2');
/*
 * Selected by what the row *is*, not by `order by at desc limit 1`.
 *
 * That is how this was written first and it passed for the wrong reason:
 * `now()` is the transaction's start time, so every event written in one
 * transaction carries the same timestamp and ordering by it is arbitrary. The
 * assertion read the raise event and reported the acknowledge actor as
 * `nobody@`. The same is true of all six ledgers in this schema — within one
 * transaction they order by nothing — which is worth knowing before writing a
 * report that leans on it.
 */
select t.expect_value($$
  select e.actor_email from request_events e
   join requests r on r.id = e.request_id
  where r.title='T-tap dripping in the prep sink'
    and e.to_status='ACKNOWLEDGED'$$,
  'and the acknowledgement names who acknowledged it, not who raised it',
  'chef@test.local');
select t.expect_value($$
  select e.actor_email from request_events e
   join requests r on r.id = e.request_id
  where r.title='T-tap dripping in the prep sink'
    and e.from_status is null$$,
  'while the raise still names the porter', 'nobody@test.local');

select '── requests: turning one into a job keeps both ──────────────────';

/*
 * Part C is explicit that this does not replace what exists: "Maintenance
 * still turns a fault report into a proper job with equipment and a schedule."
 * So the request stops being the live record and says where the live one is.
 */
select t.expect_rows($$
  select convert_request_to_work_order(
    (select id from requests where title='T-tap dripping in the prep sink'),
    'T-washer needed')$$,
  'the fault report becomes a maintenance job', 1);

select t.expect_value($$
  select converted_type from requests where title='T-tap dripping in the prep sink'$$,
  'the request says what it became', 'WORK_ORDER');
select t.expect_value($$
  select w.title from work_orders w
   join requests r on r.converted_id = w.id
  where r.title='T-tap dripping in the prep sink'$$,
  'and the job carries the same title', 'T-tap dripping in the prep sink');
select t.expect_value($$
  select (w.detail like '%' || r.reference || '%')::text
    from work_orders w join requests r on r.converted_id = w.id
   where r.title='T-tap dripping in the prep sink'$$,
  'and names the request it came from, so the job can be traced back', 'true');

select t.expect_fail($$
  select convert_request_to_work_order(
    (select id from requests where title='T-tap dripping in the prep sink'))$$,
  'converting it twice is refused rather than raising a second job');

select '── requests: a photograph attaches to the report ────────────────';

/*
 * 0059 chose a polymorphic attachment over a foreign key per parent, and
 * justified the lost foreign key by saying the list would grow as departments
 * arrived. This is the first growth, and this check is what makes that claim
 * falsifiable rather than a paragraph.
 */
select t.expect_value($$
  select attachment_parent_section('REQUEST')$$,
  'a request''s photographs are governed by Requests, not by the recipient', 'REQUESTS');
select t.expect_value($$
  select count(*)::text from attachment_retention
   where parent_type='REQUEST'
     and org_id=(select id from organizations where name='Demo Kitchen')$$,
  'and a venue has a retention figure for both kinds of it', '2');

select '── requests: what every department is sitting on ────────────────';

select t.expect_value($$
  select open_count::text from request_load where unit_code='ADMIN'
    and org_id=(select id from organizations where name='Demo Kitchen')$$,
  'the converted fault is still open on Administration', '1');
select t.expect_value($$
  select coalesce(sum(open_count), 0)::text from request_load
   where unit_code='FOH' and org_id=(select id from organizations where name='Demo Kitchen')$$,
  'and the rejected one is not open on Front of house', '0');

-- A promise nobody made is not a promise kept. Reporting an unchased request
-- as on time is the system agreeing with itself.
select t.expect_rows($$
  update request_types set respond_within_hours = null where code='CLEAN'
    and org_id=(select id from organizations where name='Demo Kitchen')$$,
  'a kind of request nobody promised to answer', 1);
select t.expect_rows($$
  insert into requests (request_type_id, title)
  select id, 'T-spill by the back door' from request_types
   where code='CLEAN' and org_id=(select id from organizations where name='Demo Kitchen')$$,
  'and one raised under it', 1);
select t.expect_value($$
  select count(*)::text from request_board
   where title='T-spill by the back door' and answered_late is not null$$,
  'is neither late nor on time — there was nothing to be on time against', '0');

rollback;
