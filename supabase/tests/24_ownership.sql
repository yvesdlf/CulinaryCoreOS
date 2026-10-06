-- ---------------------------------------------------------------------------
-- Who things belong to (0078)
-- ---------------------------------------------------------------------------
-- The messaging provider's key, the address a message goes to, and the staff
-- record a login resolves to. Each was decided by whoever could write a row,
-- and each is now decided by the database. See 0078's header for what each
-- one allowed.
-- ---------------------------------------------------------------------------

begin;

-- A second venue with a supplier of its own, so "another venue's supplier"
-- is a supplier that exists rather than a foreign key failing.
insert into organizations (id, name, slug)
values ('b0000000-0000-4000-8000-0000000000ee', 'T-Other Venue', 't-other-venue');
insert into suppliers (id, org_id, name)
values ('b0000000-0000-4000-8000-0000000000aa', 'b0000000-0000-4000-8000-0000000000ee', 'T-Other Supplier');

set local role authenticated;

select '── ownership: a channel is the owner''s to configure ───────────';

select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_rows($$update message_channels set enabled = not enabled where kind = 'EMAIL'$$,
  'a chef cannot change how the venue sends messages', 0);
select t.expect_fail($$select count(*) from message_channel_secrets$$,
  'nor read a channel''s key');
select t.expect_fail($$select set_channel_secret(
    (select id from message_channels where kind = 'EMAIL' limit 1), 'Bearer x')$$,
  'nor set one');

select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');

select t.expect_fail($$update message_channels
    set config = config || '{"auth_header": "Bearer x"}' where kind = 'EMAIL'$$,
  'not even an owner can put a key in the config members read');
select t.expect_fail($$update message_channels
    set config = config || '{"endpoint": "http://169.254.169.254/latest/meta-data"}' where kind = 'EMAIL'$$,
  'an endpoint cannot be an internal address');
select t.expect_fail($$update message_channels
    set config = config || '{"endpoint": "https://api.resend.com.evil.test/x"}' where kind = 'EMAIL'$$,
  'nor a host that only starts like a provider''s');
select t.expect_fail($$update message_channels
    set config = config || '{"endpoint": "https://user@api.resend.com/x"}' where kind = 'EMAIL'$$,
  'nor one with credentials in it');
select t.expect_rows($$update message_channels
    set config = config || '{"endpoint": "https://api.resend.com/emails"}' where kind = 'EMAIL'$$,
  'an approved provider is accepted', 1);
select t.expect_ok($$select set_channel_secret(
    (select id from message_channels where kind = 'EMAIL'), 'Bearer test')$$,
  'an owner sets the key');
select t.expect_value($$select has_secret::text from message_channels where kind = 'EMAIL'$$,
  'and the screen can tell it is set', 'true');
select t.expect_fail($$select auth_header from message_channel_secrets$$,
  'but cannot read it back');

select '── ownership: a message goes where the database says ────────────';

select t.expect_value($$
  select (has_table_privilege('authenticated', 'public.message_deliveries', 'insert')
       or has_table_privilege('authenticated', 'public.message_deliveries', 'update')
       or has_table_privilege('authenticated', 'public.message_deliveries', 'delete'))::text$$,
  'nobody signed in can queue, re-address or delete a delivery', 'false');

select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_fail($$insert into notifications (org_id, kind, subject, supplier_id)
    select id, 'ORDER_SENT', 'T-hello', 'b0000000-0000-4000-8000-0000000000aa'
      from organizations where name = 'Demo Kitchen'$$,
  'a venue cannot message another venue''s supplier');

/*
 * The provider's reply. A 500 whose body is whatever the far end said — on
 * an internal address, its error page — must not come back as text members
 * can read.
 */
reset role;
insert into notifications (id, org_id, kind, subject)
select 'b0000000-0000-4000-8000-0000000000b1', id, 'ORDER_SENT', 'T-reply'
  from organizations where name = 'Demo Kitchen';
insert into message_deliveries (id, org_id, notification_id, channel_id, kind,
                                destination, status, attempts, external_id)
select 'b0000000-0000-4000-8000-0000000000d1', c.org_id,
       'b0000000-0000-4000-8000-0000000000b1', c.id, c.kind,
       'someone@test.local', 'PENDING', 1, '987654321'
  from message_channels c
  join organizations o on o.id = c.org_id
 where o.name = 'Demo Kitchen' and c.kind = 'EMAIL';
insert into net._http_response (id, status_code, content, created)
values (987654321, 500, 'T-internal-secret-error-page', now());
select public.reconcile_deliveries();

select t.expect_value($$
  select (last_error like '%T-internal-secret%')::text || '/' || response_code
    from message_deliveries where id = 'b0000000-0000-4000-8000-0000000000d1'$$,
  'a provider''s reply body is not written where members read it, its code is', 'false/500');

select '── ownership: a staff record belongs to the person it describes ─';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_fail($$update employees set user_id = auth.uid() where employee_number = 'T-1'$$,
  'a chef cannot attach a colleague''s record to themselves');
select t.expect_fail($$insert into employees (org_id, user_id, employee_number, first_name, last_name)
    select org_id, auth.uid(), 'T-9', 'Made', 'Up' from employees where employee_number = 'T-1'$$,
  'nor create one already attached');
select t.expect_rows($$update employees set work_email = 'chef@test.local' where employee_number = 'T-5'$$,
  'a chef can still correct a work email', 1);

reset role;
select t.expect_value($$select (user_id is null)::text from employees where employee_number = 'T-5'$$,
  'and a re-addressed record stops belonging to the account it was linked to', 'true');

/*
 * The chef's address is now T-5's work email, and the chef's account has
 * never been confirmed. Before 0078 that was enough to be T-5.
 */
set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_value($$select (public.auth_employee_id() is null)::text$$,
  'an unconfirmed address does not make somebody the employee it names', 'true');

reset role;
update auth.users set email_confirmed_at = now()
 where id = 'a0000000-0000-0000-0000-000000000002';
select t.expect_value($$
  select (user_id = 'a0000000-0000-0000-0000-000000000002')::text
    from employees where employee_number = 'T-5'$$,
  'confirming it does, and links the record', 'true');

/*
 * Sign-up with somebody's work email, unconfirmed: the record waits.
 */
insert into auth.users (id, email, instance_id, aud, role)
values ('a0000000-0000-0000-0000-00000000000f', 'cert@test.local',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
select t.expect_value($$select (user_id is null)::text from employees where employee_number = 'T-1'$$,
  'signing up with a colleague''s address does not take their record', 'true');
update auth.users set email_confirmed_at = now()
 where id = 'a0000000-0000-0000-0000-00000000000f';
select t.expect_value($$
  select (user_id = 'a0000000-0000-0000-0000-00000000000f')::text
    from employees where employee_number = 'T-1'$$,
  'until the address is proved', 'true');

select '── ownership: a birthday is the employee''s to share ─────────────';

select t.expect_value($$
  select count(*)::text from information_schema.columns
   where table_schema = 'public' and table_name = 'employees' and column_name = 'date_of_birth'$$,
  'a date of birth is kept once, in the restricted record', '0');
select t.expect_value($$
  select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'employees' and column_name = 'birthday_visible'$$,
  'and is off the calendar until the employee says otherwise', 'false');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_value($$
  select coalesce(string_agg(distinct detail, ','), 'none') from venue_calendar where kind = 'LEAVE'$$,
  'leave on the calendar says who is away, not why', 'Away');

rollback;
