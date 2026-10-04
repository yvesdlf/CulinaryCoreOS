-- ---------------------------------------------------------------------------
-- Handover (0071)
-- ---------------------------------------------------------------------------
-- Gap 14. The competitor is WhatsApp, which wins on four seconds and loses on
-- everything afterwards, so the rules worth proving are the ones that make the
-- record worth more than the message:
--
--   What was published stays published. A handover is read by somebody who was
--   not there, to learn what was known at the time. Editing it afterwards does
--   not correct the record, it replaces it, and the person who acted on the
--   first version is left holding a decision nobody can account for.
--
--   Adding to it is allowed. That is how a correction is made without
--   rewriting history, and refusing it would send the correction to WhatsApp.
--
--   Somebody read it, by name. That is the one fact a message on a phone
--   cannot give you.
-- ---------------------------------------------------------------------------

begin;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select '── handover: one per department per service ─────────────────────';

select t.expect_rows($$
  insert into handovers (business_unit_id, on_date, service, summary)
  select (select id from business_units where code='KITCHEN' and org_id=o.id),
         current_date, 'Dinner', 'T-quiet service, two covers walked out'
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'the kitchen writes one for dinner', 1);

select t.expect_fail($$
  insert into handovers (business_unit_id, on_date, service, summary)
  select (select id from business_units where code='KITCHEN' and org_id=o.id),
         current_date, 'Dinner', 'T-a second one'
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'and cannot write a second for the same service');

-- Not per person: two chefs finishing the same shift write one between them,
-- which is what happens in a kitchen.
select t.expect_rows($$
  insert into handovers (business_unit_id, on_date, service, summary)
  select (select id from business_units where code='KITCHEN' and org_id=o.id),
         current_date, 'Lunch', 'T-busy'
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'but lunch is a different handover', 1);

select t.expect_value($$
  select written_by_email from handovers where summary='T-quiet service, two covers walked out'$$,
  'and it records who wrote it, from the session', 'chef@test.local');

select '── handover: an item can be the thing, not a copy of it ─────────';

/*
 * "The tap is still broken" retyped every night for a week is four sentences
 * that cannot be counted, chased or closed.
 */
select t.expect_rows($$
  insert into requests (request_type_id, title)
  select id, 'T-tap in the prep sink' from request_types
   where code='FAULT' and org_id=(select id from organizations where name='Demo Kitchen')$$,
  'a fault is raised', 1);

select t.expect_rows($$
  insert into handover_items (handover_id, kind, note, request_id)
  select h.id, 'BROKEN', 'T-still not fixed', r.id
    from handovers h, requests r
   where h.summary='T-quiet service, two covers walked out'
     and r.title='T-tap in the prep sink'$$,
  'and the handover points at it rather than describing it again', 1);

select t.expect_value($$
  select open_items::text from handover_board
   where summary='T-quiet service, two covers walked out'$$,
  'which counts as outstanding while the request is', '1');

select t.expect_rows($$
  update requests set status='RESOLVED', resolution='T-washer replaced'
   where title='T-tap in the prep sink'$$,
  'the fault is fixed', 1);
select t.expect_value($$
  select open_items::text from handover_board
   where summary='T-quiet service, two covers walked out'$$,
  'and the handover stops saying it is outstanding, without anybody ticking it',
  '0');

select '── handover: published is a one-way door ────────────────────────';

select t.expect_rows($$
  update handovers set status='PUBLISHED'
   where summary='T-quiet service, two covers walked out'$$,
  'the chef publishes it at the end of service', 1);
select t.expect_value($$
  select (published_at is not null)::text from handovers
   where summary='T-quiet service, two covers walked out'$$,
  'and the time is the database''s, not the client''s', 'true');

select t.expect_fail($$
  update handovers set summary='T-actually it was busy'
   where summary='T-quiet service, two covers walked out'$$,
  'what was said stays said');

select t.expect_fail($$
  update handover_items set note='T-never mind'
   where note='T-still not fixed'$$,
  'and so does each item');
select t.expect_fail($$
  delete from handover_items where note='T-still not fixed'$$,
  'which cannot be removed either');

/*
 * The exception that makes the rule usable. Refusing this would send the
 * correction to WhatsApp, which is the thing being replaced.
 */
select t.expect_rows($$
  insert into handover_items (handover_id, kind, note)
  select id, 'NOTE', 'T-correction: the walkout was table 4, not table 6'
    from handovers where summary='T-quiet service, two covers walked out'$$,
  'but a correction can be added, and both stay', 1);
select t.expect_value($$
  select count(*)::text from handover_items i join handovers h on h.id=i.handover_id
   where h.summary='T-quiet service, two covers walked out'$$,
  'in the order they arrived', '2');

select '── handover: somebody read it, by name ──────────────────────────';

select t.expect_value($$
  select unread::text from handover_board
   where summary='T-quiet service, two covers walked out'$$,
  'until then it is unread', 'true');

-- A draft has not been offered to anybody, so it is not unread. Conflating the
-- two puts every half-written handover on somebody's list to chase.
select t.expect_value($$
  select coalesce(unread::text, 'null') from handover_board where summary='T-busy'$$,
  'and a draft is neither read nor unread', 'null');

select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_rows($$
  update handovers set acknowledged_by_email='placeholder@test.local'
   where summary='T-quiet service, two covers walked out'$$,
  'the next shift says they have read it', 1);
select t.expect_value($$
  select acknowledged_by_email from handovers
   where summary='T-quiet service, two covers walked out'$$,
  'and it is filed under them, not under whatever the client sent',
  'owner@test.local');
select t.expect_value($$
  select coalesce(unread::text, 'null') from handover_board
   where summary='T-quiet service, two covers walked out'$$,
  'and it stops being unread', 'false');

select t.expect_fail($$
  update handovers set acknowledged_by_email='someone@test.local'
   where summary='T-busy'$$,
  'a draft cannot be read by the next shift yet');

select '── handover: whose department is it ─────────────────────────────';

select t.expect_guarded('handovers', 'HANDOVER');
select t.expect_value($$
  select scopes_by_unit::text from app_sections where code='HANDOVER'$$,
  'and a grant can name one department, because the row carries one', 'true');

select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_fail($$
  insert into handovers (business_unit_id, on_date, service, summary)
  select (select id from business_units where code='BAR' and org_id=o.id),
         current_date, 'Dinner', 'T-not mine to write'
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'somebody with no Handover access writes none');

-- But can read them, because a handover the next shift cannot find is a
-- handover that goes back to WhatsApp.
select t.expect_value($$
  select count(*)::text from handover_board where summary like 'T-%'$$,
  'and can still read every department''s', '2');

rollback;
