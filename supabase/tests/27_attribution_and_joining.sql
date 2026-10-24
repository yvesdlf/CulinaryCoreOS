-- ---------------------------------------------------------------------------
-- Who did it, who may set the tax, where a sick note goes, and joining (0081)
-- ---------------------------------------------------------------------------

select '── attribution: the database says who did it, not the browser ───';

/*
 * Five logs took the actor from whatever the client sent. Each now has the
 * stamp; checked by name so a log added later without one is noticed.
 */
select t.expect_value($$
  select coalesce(string_agg(x.t, ', ' order by x.t), '')
    from (values ('recipe_status_events'), ('stock_movements'), ('parameter_changes'),
                 ('work_order_events'), ('room_state_events')) as x(t)
   where not exists (select 1 from pg_trigger g
                      where g.tgrelid = ('public.' || x.t)::regclass
                        and g.tgname = x.t || '_stamp_actor')$$,
  'every log that records an actor stamps it itself', '');

begin;
set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_ok($$
  insert into recipe_status_events (org_id, recipe_id, to_status, actor_id, actor_email)
  select r.org_id, r.id, 'DRAFT', 'a0000000-0000-0000-0000-000000000001', 'owner@test.local'
    from recipes r join organizations o on o.id = r.org_id
   where o.name = 'Demo Kitchen' limit 1$$,
  'a chef writes a status event claiming to be the owner');
select t.expect_value($$
  select actor_email || ' ' || actor_id from recipe_status_events
   order by created_at desc limit 1$$,
  'and it is recorded as the chef', 'chef@test.local a0000000-0000-0000-0000-000000000002');

rollback;

select '── tax: an owner''s setting, and on the record ───────────────────';

begin;
set local role authenticated;

select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_rows($$update organizations set standard_vat_percent = 0
                        where name = 'Demo Kitchen'$$,
  'a chef cannot change the venue''s VAT rate', 0);

select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_rows($$update organizations set standard_vat_percent = 11
                        where name = 'Demo Kitchen'$$,
  'an owner can', 1);
select t.expect_value($$
  select trim_scale(new_value)::text || ' by ' || changed_by_email from parameter_changes
   where parameter_code = 'STANDARD_VAT_PERCENT' order by changed_at desc limit 1$$,
  'and the change is on the parameter log', '11 by owner@test.local');

rollback;

select '── sick notes: filed under your own venue ───────────────────────';

begin;
set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000004', 'staff@test.local');

/*
 * staff@ is employee T-5 of the demo venue. The second path segment is
 * theirs, as the policy always required; the first now has to be their
 * venue too, or the note lands in another venue's People folder.
 */
select t.expect_fail(format($$
  insert into storage.objects (bucket_id, name, owner)
  values ('sick-notes', %L, auth.uid())$$,
  'b0000000-0000-4000-8000-0000000000ee/' || public.auth_employee_id() || '/T-note.pdf'),
  'an employee cannot file a sick note under another venue');
select t.expect_ok(format($$
  insert into storage.objects (bucket_id, name, owner)
  values ('sick-notes', %L, auth.uid())$$,
  public.auth_employee_org() || '/' || public.auth_employee_id() || '/T-note.pdf'),
  'but can under their own');

rollback;

select '── joining: an invitation can be accepted ───────────────────────';

/*
 * The review suspected nobody had ever accepted one: accept_invitation
 * inserts the membership as the invitee, and the membership guard refused
 * any insert by a non-member into a venue that already had members. No
 * check covered it. Now one does.
 */
begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

-- Invitations first: sign-up checks for one and, finding none, gives the new
-- user a venue of their own — which is not what joining looks like.
insert into organization_invitations (id, organization_id, email, role)
values ('b0000000-0000-4000-8000-0000000000c1', :'demo', 'joiner@test.local', 'CHEF'),
       ('b0000000-0000-4000-8000-0000000000c2', :'demo', 'unproved@test.local', 'CHEF');
insert into auth.users (id, email, instance_id, aud, role, email_confirmed_at)
values ('a0000000-0000-0000-0000-0000000000a1', 'joiner@test.local',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now()),
       ('a0000000-0000-0000-0000-0000000000a2', 'unproved@test.local',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null);

set local role authenticated;

select t.act_as('a0000000-0000-0000-0000-0000000000a1', 'joiner@test.local');
select t.expect_fail(format($$insert into organization_members (organization_id, user_id, role)
    values (%L, 'a0000000-0000-0000-0000-0000000000a1', 'OWNER')$$, :'demo'),
  'the way in is the invitation, not a direct insert');
select t.expect_ok($$select public.accept_invitation('b0000000-0000-4000-8000-0000000000c1')$$,
  'an invited person can accept');
select t.expect_value(format($$
  select role::text from organization_members
   where user_id = 'a0000000-0000-0000-0000-0000000000a1' and organization_id = %L$$, :'demo'),
  'and is a member with the role they were invited as', 'CHEF');

select t.act_as('a0000000-0000-0000-0000-0000000000a2', 'unproved@test.local');
select t.expect_fail($$select public.accept_invitation('b0000000-0000-4000-8000-0000000000c2')$$,
  'an address nobody has proved cannot accept an invitation sent to it');

rollback;
