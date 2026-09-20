-- ---------------------------------------------------------------------------
-- Maintenance (0055)
-- ---------------------------------------------------------------------------
-- Who may be sent, who may sign off, and whether a meter can run backwards.
-- The assignment rules read the rota and the certificates that HR holds, so a
-- change in People can break a control in Maintenance — which is exactly the
-- kind of coupling that needs a test rather than a memory.
-- ---------------------------------------------------------------------------
begin;
select '── maintenance: who may be sent ─────────────────────────────────';

select t.expect_fail($$
  update work_orders set assigned_to=(select id from employees where employee_number='T-3'),
         due_by = current_date + 3
   where title='T-job'$$,
  'a technician on approved leave cannot be assigned');

select t.expect_fail($$
  update work_orders set assigned_to=(select id from employees where employee_number='T-2')
   where title='T-job'$$,
  'a technician with no certificate cannot be assigned');

select t.expect_rows($$
  update work_orders set assigned_to=(select id from employees where employee_number='T-1')
   where title='T-job'$$,
  'the certified technician can be', 1);

select t.expect_value($$select status::text from work_orders where title='T-job'$$,
  'and the job moves to ASSIGNED by itself', 'ASSIGNED');

-- The certificate is checked against the day the work is due, not today.
select t.expect_ok($$
  update employee_certifications set expires_on = current_date + 5
   where employee_id=(select id from employees where employee_number='T-1')$$,
  'shorten the certificate so it expires in five days');
select t.expect_fail($$
  update work_orders set assigned_to=(select id from employees where employee_number='T-1'),
         due_by = current_date + 30
   where title='T-job'$$,
  'cannot be assigned work due after the certificate lapses');

select '── maintenance: completing and signing off ──────────────────────';
select t.expect_fail($$
  update work_orders set status='COMPLETED', completed_by_email='cert@test.local'
   where title='T-job'$$,
  'a completion with no note is refused');

select t.expect_rows($$
  update work_orders set status='COMPLETED', completed_by_email='cert@test.local',
         completion_note='Replaced the contactor.', labour_minutes=90, downtime_minutes=120
   where title='T-job'$$,
  'a completion that says what was done is accepted', 1);

select t.expect_fail($$
  update work_orders set status='VERIFIED', verified_by_email='cert@test.local'
   where title='T-job'$$,
  'the technician cannot sign off their own work');

select t.expect_value($$select coalesce(last_completed_on::text,'never') from maintenance_plans where code='T-PM'$$,
  'the statutory plan has NOT advanced on completion alone', 'never');

select t.expect_rows($$
  update work_orders set status='VERIFIED', verified_by_email='supervisor@test.local'
   where title='T-job'$$,
  'somebody else can sign it off', 1);

select t.expect_value($$select coalesce(last_completed_on::text,'never') from maintenance_plans where code='T-PM'$$,
  'and the plan advances only then', current_date::text);

select t.expect_value($$
  select actor_email from work_order_events
   where work_order_id=(select id from work_orders where title='T-job')
     and to_status='VERIFIED'$$,
  'the ledger names the supervisor, not the technician', 'supervisor@test.local');

select '── maintenance: meters ──────────────────────────────────────────';
select t.expect_ok($$
  insert into meter_readings (org_id, meter_id, read_on, reading, read_by_email)
  select o.id,(select id from meters where code='T-ELEC'), current_date-2, 100000,'eng@test.local'
    from organizations o where o.name='Demo Kitchen'$$,
  'a first reading is accepted');
select t.expect_value($$select coalesce(consumption::text,'null') from meter_readings
   where meter_id=(select id from meters where code='T-ELEC') and read_on=current_date-2$$,
  'and is a baseline, not consumption', 'null');

select t.expect_ok($$
  insert into meter_readings (org_id, meter_id, read_on, reading, read_by_email)
  select o.id,(select id from meters where code='T-ELEC'), current_date-1, 100420,'eng@test.local'
    from organizations o where o.name='Demo Kitchen'$$,
  'a second reading is accepted');
select t.expect_value($$select consumption::text from meter_readings
   where meter_id=(select id from meters where code='T-ELEC') and read_on=current_date-1$$,
  'and consumption is computed by the database', '420.00000');

select t.expect_fail($$
  insert into meter_readings (org_id, meter_id, read_on, reading, read_by_email)
  select o.id,(select id from meters where code='T-ELEC'), current_date, 90,'eng@test.local'
    from organizations o where o.name='Demo Kitchen'$$,
  'a cumulative meter cannot read backwards');
select t.expect_fail($$
  insert into meter_readings (org_id, meter_id, read_on, reading, reset, read_by_email)
  select o.id,(select id from meters where code='T-ELEC'), current_date, 90, true,'eng@test.local'
    from organizations o where o.name='Demo Kitchen'$$,
  'a declared reset must say what happened');
select t.expect_ok($$
  insert into meter_readings (org_id, meter_id, read_on, reading, reset, reset_reason, read_by_email)
  select o.id,(select id from meters where code='T-ELEC'), current_date, 90, true,
         'Meter replaced','eng@test.local'
    from organizations o where o.name='Demo Kitchen'$$,
  'a reset that explains itself is accepted');
select t.expect_value($$select coalesce(consumption::text,'null') from meter_readings
   where meter_id=(select id from meters where code='T-ELEC') and read_on=current_date$$,
  'and consumption across it is left unknown rather than guessed', 'null');

select '── maintenance: the location tree ───────────────────────────────';
select t.expect_fail($$update locations set parent_id=id where code='T-PLANT'$$,
  'a location cannot be inside itself');
rollback;
