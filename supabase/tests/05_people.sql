-- ---------------------------------------------------------------------------
-- People: the rota, leave, and self-service (0023, 0026, 0041, 0053, 0054, 0057)
-- ---------------------------------------------------------------------------
-- The rota rules are the ones two other modules depend on. Maintenance will not
-- assign an uncertified technician and housekeeping will not overload an
-- attendant, and both read what is proved here.
-- ---------------------------------------------------------------------------
begin;
select '── people: publishing a rota ────────────────────────────────────';

select t.expect_fail($$
  insert into shifts (org_id, employee_id, job_role_id, starts_at, ends_at, status)
  select o.id,(select id from employees where employee_number='T-2'),
         (select id from job_roles where title='Test electrician'),
         (current_date+1+time '09:00') at time zone 'UTC',
         (current_date+1+time '17:00') at time zone 'UTC','PUBLISHED'
    from organizations o where o.name='Demo Kitchen'$$,
  'cannot roster somebody into a role they are not certified for');

select t.expect_ok($$
  insert into shifts (org_id, employee_id, job_role_id, starts_at, ends_at, status)
  select o.id,(select id from employees where employee_number='T-1'),
         (select id from job_roles where title='Test electrician'),
         (current_date+1+time '09:00') at time zone 'UTC',
         (current_date+1+time '17:00') at time zone 'UTC','PUBLISHED'
    from organizations o where o.name='Demo Kitchen'$$,
  'can roster somebody who holds the certificate');

select t.expect_fail($$
  insert into shifts (org_id, employee_id, starts_at, ends_at, status)
  select o.id,(select id from employees where employee_number='T-3'),
         (current_date+3+time '09:00') at time zone 'UTC',
         (current_date+3+time '17:00') at time zone 'UTC','PUBLISHED'
    from organizations o where o.name='Demo Kitchen'$$,
  'cannot roster somebody on approved leave');

select t.expect_ok($$
  update employees set employment_status='ARCHIVED' where employee_number='T-2'$$,
  'archive somebody');
select t.expect_fail($$
  insert into shifts (org_id, employee_id, starts_at, ends_at, status)
  select o.id,(select id from employees where employee_number='T-2'),
         (current_date+1+time '09:00') at time zone 'UTC',
         (current_date+1+time '17:00') at time zone 'UTC','PUBLISHED'
    from organizations o where o.name='Demo Kitchen'$$,
  'cannot roster somebody who has left');

select '── people: a decision names who made it ─────────────────────────';
select t.expect_fail($$
  insert into leave_requests (org_id, employee_id, leave_type_id, starts_on, ends_on,
                              status, days)
  select o.id,(select id from employees where employee_number='T-1'),
         (select id from leave_types where org_id=o.id limit 1),
         current_date+40, current_date+41,'APPROVED',2
    from organizations o where o.name='Demo Kitchen'$$,
  'an approved leave request must record its decider');

-- The 0054 bug: a manager could file their decision under the employee's name.
select t.act_as('a0000000-0000-0000-0000-000000000002','chef@test.local');
select t.expect_ok($$
  insert into staff_requests (org_id, employee_id, kind, subject, status)
  select o.id,(select id from employees where employee_number='T-5'),
         'LOAN','T-loan','SUBMITTED'
    from organizations o where o.name='Demo Kitchen'$$,
  'a staff request is raised');
select t.expect_ok($$
  update staff_requests set status='APPROVED', decided_by_email='staff@test.local'
   where subject='T-loan'$$,
  'a manager approves it, sending the employee''s address');
select t.expect_value($$select decided_by_email from staff_requests where subject='T-loan'$$,
  'and the record names the manager, not whoever the client claimed',
  'chef@test.local');

select '── people: self-service still works ─────────────────────────────';
select t.act_as('a0000000-0000-0000-0000-000000000004','staff@test.local');
select t.expect_value($$
  select (public.auth_employee_id() =
          (select id from employees where employee_number='T-5'))::text$$,
  'the portal resolves the signed-in user to their own record', 'true');

/*
 * KNOWN GAP, found by writing this suite.
 *
 * `leave_requests` carries the People section guard and has no self-service
 * carve-out, so an employee with no HR access cannot request their own leave.
 * The staff portal appears to work only because joining an organisation seeds
 * a CHEF with WRITE on every section — the moment an administrator restricts
 * somebody, the feature stops working for them.
 *
 * This is the 0057 problem in reverse: there the guard was missing, here it is
 * too broad. The fix is the same shape as the leave_attachments owner rule —
 * the subject may write their own row, anybody else needs the section.
 *
 * Asserted as it behaves today, so the suite stays honest and goes red when
 * somebody fixes it. Recorded in PROGRESS.md.
 */
select t.expect_fail($$
  insert into leave_requests (org_id, employee_id, leave_type_id, starts_on, ends_on,
                              status, days)
  select o.id, public.auth_employee_id(),
         (select id from leave_types where org_id=o.id limit 1),
         current_date+50, current_date+51,'REQUESTED',2
    from organizations o where o.name='Demo Kitchen'$$,
  'GAP: an employee with no HR access cannot request their own leave');

select t.expect_fail($$
  insert into leave_attachments (org_id, leave_request_id, file_path, file_name)
  select o.id,(select l.id from leave_requests l
                join employees e on e.id=l.employee_id
               where e.employee_number='T-3' limit 1),'x','someone-elses.pdf'
    from organizations o where o.name='Demo Kitchen'$$,
  'an employee cannot attach to somebody else''s leave request');

select '── people: the staff board is moderated ─────────────────────────';
select t.expect_ok($$
  insert into board_posts (org_id, employee_id, kind, title, body, status)
  select o.id, public.auth_employee_id(),'FOR_SALE','T-post','body','PUBLISHED'
    from organizations o where o.name='Demo Kitchen'$$,
  'a post asking to be published is accepted');
select t.expect_value($$select status::text from board_posts where title='T-post'$$,
  'and stored as PENDING regardless of what was asked for', 'PENDING');
select t.expect_fail($$
  update board_posts set status='PUBLISHED' where title='T-post'$$,
  'the poster cannot publish their own');

select t.act_as('a0000000-0000-0000-0000-000000000003','nobody@test.local');
select t.expect_fail($$
  update board_posts set status='PUBLISHED' where title='T-post'$$,
  'nor can somebody with no People access');

select t.act_as('a0000000-0000-0000-0000-000000000002','chef@test.local');
select t.expect_rows($$
  update board_posts set status='PUBLISHED' where title='T-post'$$,
  'a moderator can', 1);
rollback;
