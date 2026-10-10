-- ---------------------------------------------------------------------------
-- The four defects found by audit on 2026-10-08 (0085, 0086, 0087)
-- ---------------------------------------------------------------------------
-- Every one of these was confirmed by execution before it was fixed, and each
-- assertion below was watched going red against the schema as it stood. The
-- fourth defect is in the interface and is not testable here; it has a
-- Playwright test instead.
--
-- Two of the three are instances of the same mistake, which is why they are
-- in one file: a control that reads who the caller is from a column the
-- caller writes. 0054 already named that mistake and fixed it in two places.
-- It did not reach purchasing approvals.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset
select id as t5 from employees where employee_number = 'T-5' and org_id = :'demo' \gset

-- A policy that puts anything over 50,000,000 beyond a CHEF.
insert into approval_policies (org_id, document_type, min_amount, required_role)
values (:'demo', 'REQUISITION', 50000000, 'OWNER');

-- Three requisitions. One the chef raised, two raised by a third person so
-- that borrowing the owner's name is not masked by the segregation-of-duties
-- check firing first — which it did on the first draft of this file, and the
-- assertion passed for the wrong reason.
-- The reference given here is discarded: 0063 has the requisition number
-- itself. Everything below keys on the id, which is why the ids are literal.
insert into requisitions (id, org_id, reference, status, total_amount,
                          requested_by, requested_by_email)
values ('b0000000-0000-4000-8000-00000000f001', :'demo', 'T-REQ-CHEF',
        'SUBMITTED', 99000000,
        'a0000000-0000-0000-0000-000000000002', 'chef@test.local'),
       ('b0000000-0000-4000-8000-00000000f002', :'demo', 'T-REQ-OTHER',
        'SUBMITTED', 99000000,
        'a0000000-0000-0000-0000-000000000003', 'nobody@test.local'),
       ('b0000000-0000-4000-8000-00000000f003', :'demo', 'T-REQ-SMALL',
        'SUBMITTED', 10,
        'a0000000-0000-0000-0000-000000000003', 'nobody@test.local');

-- An HR case about T-5 that only the owner is party to.
insert into hr_cases (id, org_id, employee_id, reference, kind, status,
                      summary, detail, opened_by_email)
values ('b0000000-0000-4000-8000-00000000f010', :'demo', :'t5', 'T-CASE-1',
        'INVESTIGATION', 'OPEN', 'T-case summary',
        'Sensitive detail the chef is not party to.', 'owner@test.local');
insert into hr_case_participants (org_id, case_id, user_id, email, role)
values (:'demo', 'b0000000-0000-4000-8000-00000000f010',
        'a0000000-0000-0000-0000-000000000001', 'owner@test.local', 'OWNER');

-- A sick note: the leave request, the attachment row, and the object itself.
insert into leave_requests (id, org_id, employee_id, leave_type_id,
                            starts_on, ends_on, days, status)
select 'b0000000-0000-4000-8000-00000000f020', :'demo', :'t5', lt.id,
       current_date, current_date, 1, 'REQUESTED'
  from leave_types lt where lt.org_id = :'demo' limit 1;
insert into leave_attachments (id, org_id, leave_request_id, file_path,
                               file_name, content_type, uploaded_by_email)
values ('b0000000-0000-4000-8000-00000000f021', :'demo',
        'b0000000-0000-4000-8000-00000000f020',
        :'demo' || '/' || :'t5' || '/T-sicknote.pdf',
        'T-sicknote.pdf', 'application/pdf', 'staff@test.local');
insert into storage.objects (bucket_id, name)
values ('sick-notes', :'demo' || '/' || :'t5' || '/T-sicknote.pdf');

select '── approvals record the caller, not what the caller typed' as "──";

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

-- The control that already worked.
select t.expect_refused($$
  insert into approval_events (org_id, document_type, document_id, action,
                               actor_id, actor_email)
  values ((select id from organizations where name = 'Demo Kitchen'),
          'REQUISITION', 'b0000000-0000-4000-8000-00000000f001', 'APPROVED',
          'a0000000-0000-0000-0000-000000000002', 'chef@test.local')$$,
  'the chef cannot approve the requisition they raised',
  'cannot approve it');

/*
 * The defect. Same approval, the owner's id and address in the actor columns.
 *
 * Before 0085 this was allowed: the trigger took the submitter from the
 * document and the approver from the row being written, compared the two,
 * found them different, looked up the *claimed* actor's role, found OWNER,
 * and cleared ninety-nine million with the owner's name against it.
 */
select t.expect_refused($$
  insert into approval_events (org_id, document_type, document_id, action,
                               actor_id, actor_email)
  values ((select id from organizations where name = 'Demo Kitchen'),
          'REQUISITION', 'b0000000-0000-4000-8000-00000000f001', 'APPROVED',
          'a0000000-0000-0000-0000-000000000001', 'owner@test.local')$$,
  'nor by putting the owner in the actor column',
  'cannot approve it');

-- Somebody else's requisition, still over the threshold, still signed as the
-- owner. Nothing to do with segregation of duties: this one is about whether
-- the role that authorises the amount is the caller's or the typist's.
select t.expect_refused($$
  insert into approval_events (org_id, document_type, document_id, action,
                               actor_id, actor_email)
  values ((select id from organizations where name = 'Demo Kitchen'),
          'REQUISITION', 'b0000000-0000-4000-8000-00000000f002', 'APPROVED',
          'a0000000-0000-0000-0000-000000000001', 'owner@test.local')$$,
  'and a chef cannot borrow the owner''s authority for the amount',
  'requires the OWNER role');

/*
 * Allowed — and then read back.
 *
 * This is the harness's second false-pass mode: "the write was allowed" is
 * not "the write recorded the truth". A fix that refused the two above but
 * still wrote whatever name it was handed would pass every assertion so far.
 */
select t.expect_rows($$
  insert into approval_events (org_id, document_type, document_id, action,
                               actor_id, actor_email)
  values ((select id from organizations where name = 'Demo Kitchen'),
          'REQUISITION', 'b0000000-0000-4000-8000-00000000f003', 'APPROVED',
          'a0000000-0000-0000-0000-000000000001', 'owner@test.local')$$,
  'a chef may approve a small one raised by somebody else', 1);

reset role;
select t.expect_value($$
  select actor_email from approval_events
   where document_id = 'b0000000-0000-4000-8000-00000000f003'
     and action = 'APPROVED'$$,
  'and it is recorded against the chef who pressed it, not the owner they typed',
  'chef@test.local');
select t.expect_value($$
  select actor_role::text from approval_events
   where document_id = 'b0000000-0000-4000-8000-00000000f003'
     and action = 'APPROVED'$$,
  'with the role they actually hold', 'CHEF');

-- The legitimate path still works.
set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_rows($$
  insert into approval_events (org_id, document_type, document_id, action,
                               actor_id, actor_email)
  values ((select id from organizations where name = 'Demo Kitchen'),
          'REQUISITION', 'b0000000-0000-4000-8000-00000000f001', 'APPROVED',
          null, null)$$,
  'the owner approves the big one and is not asked to name themselves', 1);
reset role;
select t.expect_value($$
  select actor_email from approval_events
   where document_id = 'b0000000-0000-4000-8000-00000000f001'
     and action = 'APPROVED'$$,
  'and the row knows who it was', 'owner@test.local');

select '── a case is not joinable by the person who wants to read it' as "──";

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_value($$select count(*)::text from hr_cases
                         where reference = 'T-CASE-1'$$,
  'the chef cannot see a case they are not party to', '0');

/*
 * The defect. hr_case_participants_insert checked only auth_can_write(org_id),
 * and can_see_case grants visibility to anyone listed — so the table that
 * decides who may read a case could be written by anyone who wanted to.
 */
select t.expect_refused($$
  insert into hr_case_participants (org_id, case_id, user_id, email, role)
  values ((select id from organizations where name = 'Demo Kitchen'),
          'b0000000-0000-4000-8000-00000000f010',
          'a0000000-0000-0000-0000-000000000002', 'chef@test.local', 'HR')$$,
  'and cannot add themselves to it', 'not party to this case');

select t.expect_value($$select count(*)::text from hr_cases
                         where reference = 'T-CASE-1'$$,
  'so the detail stays out of reach', '0');

-- Somebody already party to it may still bring a colleague in, which is the
-- whole point of the table.
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_rows($$
  insert into hr_case_participants (org_id, case_id, user_id, email, role)
  values ((select id from organizations where name = 'Demo Kitchen'),
          'b0000000-0000-4000-8000-00000000f010',
          'a0000000-0000-0000-0000-000000000003', 'nobody@test.local', 'HR')$$,
  'a participant may bring somebody in', 1);

/*
 * And participation alone is what grants the read — nobody@ holds NONE on
 * every section, so this also proves the case is not reachable by section
 * access, which is the thing that would make the whole table pointless.
 */
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_value($$select count(*)::text from hr_cases
                         where reference = 'T-CASE-1'$$,
  'and then they can see it, on participation alone', '1');

reset role;

select '── a deleted sick note is actually gone' as "──";

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_value($$select count(*)::text from storage.objects
                         where bucket_id = 'sick-notes' and name like '%T-sicknote.pdf'$$,
  'People reads a sick note while it is a live attachment', '1');
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_ok($$
  select delete_sick_note('b0000000-0000-4000-8000-00000000f021', 'T-DSAR-1')$$,
  'the owner deletes it against a request reference');
reset role;
select t.expect_value($$select count(*)::text from leave_attachments
                         where id = 'b0000000-0000-4000-8000-00000000f021'$$,
  'the attachment row is gone', '0');

/*
 * The defect, in two halves.
 *
 * sick_notes_read keyed on the path and a section grant and never on
 * leave_attachments, so deleting the row left the object readable. And
 * storage_deletions recorded the intent to remove the file while nothing
 * drained it — two cron jobs existed and neither was this one. So the privacy
 * ledger said the note was deleted, and the note was still there, still
 * readable. GDPR Art 9 data.
 */
set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_value($$select count(*)::text from storage.objects
                         where bucket_id = 'sick-notes' and name like '%T-sicknote.pdf'$$,
  'and stops reading it the moment the attachment is gone', '0');
reset role;

select t.expect_value($$select count(*)::text from storage_deletions
                         where path like '%T-sicknote.pdf' and deleted_at is null$$,
  'a deletion is queued', '1');

/*
 * Unconfigured, the drain must do nothing and say so.
 *
 * This is the assertion that matters most in this group. A drain that marks
 * rows done when it cannot reach the storage service would empty the queue
 * and leave every file in place — the same false record this migration is
 * fixing, one layer further down, and invisible because the queue looks
 * clear. A laptop and a venue with no provider are the same case.
 */
select t.expect_value($$select drain_storage_deletions()$$,
  'with nowhere to send it, the drain refuses to pretend',
  'waiting: no storage endpoint configured');
select t.expect_value($$select count(*)::text from storage_deletions
                         where path like '%T-sicknote.pdf' and deleted_at is null$$,
  'and the row stays on the queue', '1');

-- Pointed at the discard port, so the request goes nowhere and pg_net's
-- asynchrony does not make this test wait on a reply it does not need.
update storage_api set base_url = 'http://127.0.0.1:9/storage/v1',
                       auth_header = 'Bearer t-not-a-real-key' where id;
select t.expect_value($$select drain_storage_deletions()$$,
  'configured, it sends the deletion', '1 sent to the storage API');
select t.expect_value($$select count(*)::text from storage_deletions
                         where path like '%T-sicknote.pdf' and deleted_at is not null$$,
  'and the queue row says when', '1');
select t.expect_value($$select count(*)::text from cron.job
                         where command like '%drain_storage_deletions%'$$,
  'on a timer, not only when somebody remembers', '1');

rollback;
