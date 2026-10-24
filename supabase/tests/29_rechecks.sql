-- ---------------------------------------------------------------------------
-- What the re-checks found (0083)
-- ---------------------------------------------------------------------------
-- Each refusal here uses t.expect_refused, which requires the reason as well
-- as the refusal: the reality check of these fixes pointed out that
-- expect_fail passes on any error at all.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset
select id as t5 from employees where employee_number = 'T-5' and org_id = :'demo' \gset

-- A notification of each section, a payslip in storage, a private record for
-- T-5, a course set to T-5 with one question, and a second venue.
insert into notifications (org_id, kind, subject, body)
values (:'demo', 'LEAVE_REQUESTED', 'T-leave', 'T-1 asked for 3 days'),
       (:'demo', 'ORDER_SENT', 'T-order', 'PO sent');
insert into storage.objects (bucket_id, name)
values ('staff-documents', :'demo' || '/b0000000-0000-4000-8000-0000000000f1/T-payslip.pdf');
insert into employee_private (employee_id, org_id, national_id)
values (:'t5', :'demo', 'T-ID-5');
insert into training_courses (id, org_id, code, title)
values ('b0000000-0000-4000-8000-0000000000c5', :'demo', 'T-QUIZ', 'T-quiz');
insert into quiz_questions (org_id, course_id, prompt, options, correct_index)
values (:'demo', 'b0000000-0000-4000-8000-0000000000c5', 'T-2+2?', array['3','4'], 1);
select id as q1 from quiz_questions where prompt = 'T-2+2?' \gset
insert into training_assignments (org_id, course_id, employee_id)
values (:'demo', 'b0000000-0000-4000-8000-0000000000c5', :'t5');
insert into organizations (id, name, slug)
values ('b0000000-0000-4000-8000-0000000000ee', 'T-Other Venue', 't-other-venue');

/*
 * A contract price in the other venue, on a contract long expired but still
 * marked ACTIVE. 0077 scoped contract_price_for and refresh_contract_statuses
 * to the caller's venues and nothing tested it: with no contract prices in
 * any fixture, "contract prices stay behind RLS" passed on an empty table.
 */
insert into suppliers (id, org_id, name)
values ('b0000000-0000-4000-8000-0000000000aa', 'b0000000-0000-4000-8000-0000000000ee', 'T-Other Supplier');
-- A copy of a demo product, moved to the other venue: products have many
-- required columns and none of them matter here.
insert into products
select (jsonb_populate_record(null::products, to_jsonb(p) || jsonb_build_object(
          'id', 'b0000000-0000-4000-8000-0000000000a9',
          'org_id', 'b0000000-0000-4000-8000-0000000000ee',
          'name', 'T-Other Product'))).*
  from products p where p.org_id = :'demo' limit 1;
insert into contracts (id, org_id, supplier_id, reference, title, status, starts_on, ends_on)
values ('b0000000-0000-4000-8000-0000000000cc', 'b0000000-0000-4000-8000-0000000000ee',
        'b0000000-0000-4000-8000-0000000000aa', 'T-C1', 'T-contract', 'ACTIVE',
        current_date - 400, current_date - 30);
insert into contract_prices (org_id, contract_id, product_id, unit, unit_price, effective_from)
values ('b0000000-0000-4000-8000-0000000000ee', 'b0000000-0000-4000-8000-0000000000cc',
        'b0000000-0000-4000-8000-0000000000a9', 'KG', 12345, current_date - 400);

set local role authenticated;

select '── re-checks: a work email is an administrator''s ────────────────';

select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_refused($$update employees set work_email = 'x@test.local' where employee_number = 'T-1'$$,
  'a chef cannot change somebody''s work email', 'owner or administrator');
select t.expect_ok($$insert into employees (org_id, employee_number, first_name, last_name, work_email)
    select org_id, 'T-NEW', 'New', 'Starter', 'newstarter@test.local'
      from employees where employee_number = 'T-1'$$,
  'but can still add a new starter with their address');

select '── re-checks: NONE reads no notifications, approvals or grid ────';

select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_value($$select count(*)::text from notifications$$,
  'somebody with no access reads no notifications', '0');
select t.expect_value($$select count(*)::text from member_access_grid$$,
  'nor the access grid', '0');
select t.expect_value($$select count(*)::text from storage.objects
                         where bucket_id = 'staff-documents' and name like '%T-payslip.pdf'$$,
  'nor a payslip that is not theirs', '0');
select t.expect_refused($$insert into recipe_status_events (org_id, recipe_id, to_status)
    select org_id, id, 'DRAFT' from recipes limit 1$$,
  'nor writes a recipe status event', 'edit access');

select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_value($$select public.contract_price_for('b0000000-0000-4000-8000-0000000000a9',
    'b0000000-0000-4000-8000-0000000000aa', current_date - 60)::text$$,
  'another venue''s contract price is not answered', null);
select t.expect_ok($$select public.refresh_contract_statuses()$$,
  'refreshing contract statuses runs');
reset role;
select t.expect_value($$select status::text from contracts where id = 'b0000000-0000-4000-8000-0000000000cc'$$,
  'and leaves another venue''s contracts alone', 'ACTIVE');
update contracts set status = 'ACTIVE' where id = 'b0000000-0000-4000-8000-0000000000cc';
select t.expect_value($$select trim_scale(unit_price)::text from contract_prices
                         where contract_id = 'b0000000-0000-4000-8000-0000000000cc'$$,
  'while the price itself exists, so the null above is the venue rule, not an empty table', '12345');
set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_value($$select count(*)::text from notifications where subject like 'T-%'$$,
  'somebody with People and Purchasing reads both notifications', '2');
select t.expect_value($$select (count(*) > 0)::text from member_access_grid$$,
  'and somebody with Administration reads the grid', 'true');
select t.expect_value($$select count(*)::text from storage.objects
                         where bucket_id = 'staff-documents' and name like '%T-payslip.pdf'$$,
  'and People reads the payslip', '1');

select t.expect_value($$
  select (has_table_privilege('authenticated', 'public.parameter_changes', 'insert')
       or has_table_privilege('authenticated', 'public.work_order_events', 'insert')
       or has_table_privilege('authenticated', 'public.room_state_events', 'insert'))::text$$,
  'logs written by triggers cannot be written by a client', 'false');

select '── re-checks: functions that trusted the caller ──────────────────';

select t.expect_refused($$select public.next_document_reference('PO', 'KIT',
    'b0000000-0000-4000-8000-0000000000ee')$$,
  'a member cannot draw another venue''s document numbers', 'not a member');
select t.expect_ok($$select public.next_document_reference('PO', 'KIT')$$,
  'but still draws their own');

/*
 * staff@ is T-5 and has no section access at all: their own paper, wrong
 * answer, and a pass mark of zero sent by the caller. Before 0083 that passed.
 */
select t.act_as('a0000000-0000-0000-0000-000000000004', 'staff@test.local');
select t.expect_value(format($$
  select (public.mark_quiz_attempt('b0000000-0000-4000-8000-0000000000c5',
            public.auth_employee_id(),
            jsonb_build_object(%L, 0),
            0) ->> 'passed')$$, :'q1'),
  'an employee cannot pass their own course by sending a pass mark of 0', 'false');

select t.expect_value($$select count(*)::text from employee_private$$,
  'and reads their own private record, with no section access', '1');

select '── re-checks: tax needs Parameters as well as the role ───────────';

/*
 * 0081's guard has two halves: the role (owner or administrator) and
 * Parameters write. Only the first had a test. An administrator whose
 * Parameters access is READ passes the policy and must be stopped by the
 * guard.
 */
reset role;
select t.act_as_nobody();
insert into auth.users (id, email, instance_id, aud, role, email_confirmed_at)
values ('a0000000-0000-0000-0000-0000000000ad', 'admin-readonly@test.local',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now());
insert into organization_members (organization_id, user_id, role)
values (:'demo', 'a0000000-0000-0000-0000-0000000000ad', 'ADMIN');
update member_access set level = 'READ'
 where user_id = 'a0000000-0000-0000-0000-0000000000ad' and section_code = 'PARAMETERS';
set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-0000000000ad', 'admin-readonly@test.local');
select t.expect_refused($$update organizations set standard_vat_percent = 5 where name = 'Demo Kitchen'$$,
  'an administrator with read-only Parameters cannot change the VAT rate', 'Parameters access');
select t.expect_rows($$update organizations set about = 'T-about' where name = 'Demo Kitchen'$$,
  'but can still change what is not a protected parameter', 1);

select '── re-checks: supplier invitations need a proved address ─────────';

reset role;
insert into auth.users (id, email, instance_id, aud, role)
values ('a0000000-0000-0000-0000-0000000000a3', 'unproved-supplier@test.local',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-0000000000a3', 'unproved-supplier@test.local');
select t.expect_refused($$select public.accept_supplier_invitation(gen_random_uuid())$$,
  'an unconfirmed address cannot accept a supplier invitation', 'confirm your email');

rollback;
