-- ---------------------------------------------------------------------------
-- Purchasing: numbers, and who may approve (0021, 0047–0052)
-- ---------------------------------------------------------------------------
-- Segregation of duties is the oldest control in this database and has never
-- had a test. It lives on the approval ledger rather than on a column, and is
-- matched on both user id and email so that a document raised before somebody
-- had an account is still caught.
-- ---------------------------------------------------------------------------
begin;
select '── purchasing: the reference number ─────────────────────────────';

-- The stem is allocated by the database; the client sends neither number.
select t.expect_ok($$
  insert into requisitions (org_id, reference_stem, reference, cost_centre_id,
                            needed_by, justification, status,
                            requested_by, requested_by_email, total_amount)
  select o.id,
         public.next_reference_stem('KIT', o.id),
         'PLACEHOLDER',
         (select id from cost_centres where org_id=o.id and code='KITCHEN'),
         current_date+7,'T-req','SUBMITTED',
         'a0000000-0000-0000-0000-000000000001','owner@test.local', 1000000
    from organizations o where o.name='Demo Kitchen'$$,
  'a requisition is raised');

select t.expect_value($$
  select (reference ~ ('^REQ-KIT-' || to_char(current_date,'YYMMDD') || '-[0-9]{3}$'))::text
    from requisitions where justification='T-req'$$,
  'and the trigger numbers it REQ-KIT-yymmdd-nnn', 'true');

select t.expect_value($$
  select (reference = 'REQ-' || reference_stem)::text
    from requisitions where justification='T-req'$$,
  'the reference is the stem under its current name', 'true');

select t.expect_value($$
  select (count(distinct r) = 3)::text from (
    select public.next_document_reference('REQ','KIT',
             (select id from organizations where name='Demo Kitchen')) as r
    union all select public.next_document_reference('REQ','KIT',
             (select id from organizations where name='Demo Kitchen'))
    union all select public.next_document_reference('REQ','KIT',
             (select id from organizations where name='Demo Kitchen'))) x$$,
  'three allocations in a row produce three distinct numbers', 'true');

select '── purchasing: segregation of duties ────────────────────────────';
-- Approval is an event on a ledger, not a column, so it cannot be re-described.
select t.expect_fail($$
  insert into approval_events (org_id, document_type, document_id, action,
                               actor_id, actor_email, actor_role, amount)
  select o.id,'REQUISITION',(select id from requisitions where justification='T-req'),
         'APPROVED','a0000000-0000-0000-0000-000000000001','owner@test.local','OWNER',1000000
    from organizations o where o.name='Demo Kitchen'$$,
  'the person who raised it cannot approve it');

select t.expect_fail($$
  insert into approval_events (org_id, document_type, document_id, action,
                               actor_id, actor_email, actor_role, amount)
  select o.id,'REQUISITION',(select id from requisitions where justification='T-req'),
         'APPROVED','a0000000-0000-0000-0000-000000000003','OWNER@test.local','OWNER',1000000
    from organizations o where o.name='Demo Kitchen'$$,
  'nor under a different case of the same address');

select t.expect_ok($$
  insert into approval_events (org_id, document_type, document_id, action,
                               actor_id, actor_email, actor_role, amount)
  select o.id,'REQUISITION',(select id from requisitions where justification='T-req'),
         'APPROVED','a0000000-0000-0000-0000-000000000002','chef@test.local','CHEF',1000000
    from organizations o where o.name='Demo Kitchen'$$,
  'somebody else can approve it');

select t.expect_fail($$
  insert into approval_events (org_id, document_type, document_id, action,
                               actor_id, actor_email, actor_role, amount)
  select o.id,'REQUISITION',(select id from requisitions where justification='T-req'),
         'APPROVED','a0000000-0000-0000-0000-000000000009','stranger@test.local','OWNER',1000000
    from organizations o where o.name='Demo Kitchen'$$,
  'somebody outside the organisation cannot approve at all');

select '── purchasing: the approval ledger does not move ────────────────';
select t.expect_value($$select has_table_privilege('authenticated','approval_events','UPDATE')::text$$,
  'an approval cannot be re-described afterwards', 'false');
select t.expect_value($$select has_table_privilege('authenticated','approval_events','DELETE')::text$$,
  'nor removed', 'false');
select t.expect_value($$
  select (amount = 1000000)::text from approval_events
   where document_id=(select id from requisitions where justification='T-req')
     and actor_email='chef@test.local'$$,
  'and it records the amount the decision was made against', 'true');

select '── purchasing: the rules are data, not code ─────────────────────';
select t.expect_value($$select (count(*) > 0)::text from approval_policies$$,
  'approval authority is policy finance can change without a deployment', 'true');
select t.expect_value($$select (count(*) > 0)::text from matching_tolerances$$,
  'so are invoice matching tolerances', 'true');
rollback;
