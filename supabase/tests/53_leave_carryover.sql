-- ---------------------------------------------------------------------------
-- A leave year that closes (0112)
-- ---------------------------------------------------------------------------
-- `max_carryover_days` existed for months and nothing read it, so on the
-- first of January everybody's unused days vanished.
--
-- The assertion worth having is the one about a null cap. Reading null as
-- "unlimited" is the natural guess and it hands every employee their whole
-- unused balance the first time a venue closes a year — which is not
-- recoverable, because by the time anybody notices the holiday is booked.
-- Reading it as "none" is recoverable: the venue sets a number and closes
-- again.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into leave_types (id, org_id, code, name, paid,
                         annual_entitlement_days, max_carryover_days)
values ('b0000000-0000-4000-8000-000000530001', :'demo', 'T-ANN',
        'T-Annual leave', true, 20, 5),
       ('b0000000-0000-4000-8000-000000530002', :'demo', 'T-ANN-NOCAP',
        'T-Annual, no cap set', true, 20, null),
       ('b0000000-0000-4000-8000-000000530003', :'demo', 'T-SICK',
        'T-Sick leave', true, null, null);

insert into employees (id, org_id, employee_number, first_name, last_name,
                       started_on)
values ('b0000000-0000-4000-8000-000000530010', :'demo', 'T-LV1',
        'Tess', 'Carryover', current_date - 800);

/*
 * Took eight of twenty in 2025, so twelve unused against a cap of five.
 * The cap is the point: twelve unused is not twelve carried.
 */
-- `decided_by_email` is not optional: a leave decision must record who made
-- it, which is a trigger and not a convention.
insert into leave_requests
  (org_id, employee_id, leave_type_id, starts_on, ends_on, days, status,
   decided_by_email)
values (:'demo', 'b0000000-0000-4000-8000-000000530010',
        'b0000000-0000-4000-8000-000000530001',
        date '2025-06-01', date '2025-06-08', 8, 'APPROVED', 'gm@test.local'),
       (:'demo', 'b0000000-0000-4000-8000-000000530010',
        'b0000000-0000-4000-8000-000000530002',
        date '2025-06-01', date '2025-06-08', 8, 'APPROVED', 'gm@test.local');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select '── a year with an undecided request cannot close' as "──";

select t.fixture($$
  insert into leave_requests
    (org_id, employee_id, leave_type_id, starts_on, ends_on, days, status)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000530010',
          'b0000000-0000-4000-8000-000000530001',
          date '2025-11-03', date '2025-11-05', 3, 'REQUESTED')$$);

/*
 * Refused, not warned about. Closing around an undecided request either
 * loses the days or carries them over as though they were never going to be
 * taken, and either way it is found in December when it cannot be fixed.
 */
select t.expect_refused(
  'select public.close_leave_year(' || quote_literal(:'demo') ||
  '::uuid, date ''2025-01-01'', date ''2025-12-31'')',
  'a year holding an undecided request is refused',
  'still undecided');

select t.expect_value($$
  select count(*)::text from leave_carryover
   where employee_id = 'b0000000-0000-4000-8000-000000530010'$$,
  'and nothing is written', '0');

select '── closing it' as "──";

select t.fixture($$
  update leave_requests
     set status = 'REJECTED', decided_by_email = 'gm@test.local'
   where employee_id = 'b0000000-0000-4000-8000-000000530010'
     and starts_on = date '2025-11-03'$$);

select t.expect_value(
  'select (public.close_leave_year(' || quote_literal(:'demo') ||
  '::uuid, date ''2025-01-01'', date ''2025-12-31'') > 0)::text',
  'with every request decided, the year closes', 'true');

select t.expect_value($$
  select unused_days::text || ' unused, ' || carried_days::text || ' carried'
    from leave_carryover
   where employee_id = 'b0000000-0000-4000-8000-000000530010'
     and leave_type_id = 'b0000000-0000-4000-8000-000000530001'$$,
  'twelve days unused, five of them carried — the cap is applied',
  '12.00 unused, 5.00 carried');

/*
 * A rejected request gives nobody their days back and takes none away.
 * Counting anything other than approved and taken would quietly change the
 * balance in whichever direction the filter was wrong.
 */
select t.expect_value($$
  select taken_days::text from leave_carryover
   where employee_id = 'b0000000-0000-4000-8000-000000530010'
     and leave_type_id = 'b0000000-0000-4000-8000-000000530001'$$,
  'the rejected three days were never taken', '8.00');

select '── a cap nobody set carries nothing' as "──";

/*
 * The assertion this file exists for. Twelve days unused on a type whose
 * `max_carryover_days` is null, and the honest answer is none — because the
 * generous reading cannot be undone once somebody has booked against it.
 */
select t.expect_value($$
  select carried_days::text from leave_carryover
   where employee_id = 'b0000000-0000-4000-8000-000000530010'
     and leave_type_id = 'b0000000-0000-4000-8000-000000530002'$$,
  'an unset cap carries nothing, rather than everything', '0.00');

select t.expect_value($$
  select unused_days::text from leave_carryover
   where employee_id = 'b0000000-0000-4000-8000-000000530010'
     and leave_type_id = 'b0000000-0000-4000-8000-000000530002'$$,
  'and the twelve unused days are still on the record, so it can be corrected',
  '12.00');

select '── nothing to run down, nothing to carry' as "──";

select t.expect_value($$
  select count(*)::text from leave_carryover
   where employee_id = 'b0000000-0000-4000-8000-000000530010'
     and leave_type_id = 'b0000000-0000-4000-8000-000000530003'$$,
  'sick leave has no allowance, so no carried balance is invented', '0');

select '── carried days expire' as "──";

select t.expect_value($$
  select expires_on::text from leave_carryover
   where employee_id = 'b0000000-0000-4000-8000-000000530010'
     and leave_type_id = 'b0000000-0000-4000-8000-000000530001'$$,
  'three months into the new year, from the venue parameter', '2026-04-01');

select t.expect_value($$
  select carried_in_now::text || '/' || expired::text
    from leave_entitlement_now
   where employee_id = 'b0000000-0000-4000-8000-000000530010'
     and leave_type_id = 'b0000000-0000-4000-8000-000000530001'$$,
  'and by today they have lapsed, counting for nothing', '0.00/true');

/*
 * Lapsed, not deleted. The row is the record of what was decided at close,
 * and a balance that silently stopped existing leaves nothing to explain why
 * somebody's figure dropped.
 */
select t.expect_value($$
  select carried_days::text from leave_entitlement_now
   where employee_id = 'b0000000-0000-4000-8000-000000530010'
     and leave_type_id = 'b0000000-0000-4000-8000-000000530001'$$,
  'while the five days remain visible as what was carried', '5.00');

select '── closing twice' as "──";

select t.expect_value(
  'select public.close_leave_year(' || quote_literal(:'demo') ||
  '::uuid, date ''2025-01-01'', date ''2025-12-31'')::text',
  'closing the same year again writes nothing rather than doubling it', '0');

select '── the next year carries it in' as "──";

select t.fixture($$
  update venue_parameters set value = 24
   where code = 'CARRYOVER_EXPIRES_MONTHS'
     and org_id = (select id from organizations where name='Demo Kitchen')$$);
select t.fixture($$
  select public.close_leave_year(
    (select id from organizations where name='Demo Kitchen'),
    date '2026-01-01', date '2026-12-31')$$);

/*
 * Twenty days of allowance plus the five that came in, none of it taken, so
 * twenty-five unused — and five of those carry on again under the same cap.
 */
select t.expect_value($$
  select carried_in_days::text || ' in, ' || unused_days::text || ' unused'
    from leave_carryover
   where employee_id = 'b0000000-0000-4000-8000-000000530010'
     and leave_type_id = 'b0000000-0000-4000-8000-000000530001'
     and year_starts_on = date '2026-01-01'$$,
  'last year''s five are part of this year''s balance, not forgotten',
  '5.00 in, 25.00 unused');

select '── who may close a year' as "──";

select t.expect_guarded('leave_carryover', 'PEOPLE');

select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_refused(
  'select public.close_leave_year(' || quote_literal(:'demo') ||
  '::uuid, date ''2024-01-01'', date ''2024-12-31'')',
  'somebody with no People access cannot close a year',
  'edit access to People');

select t.expect_value($$
  select count(*)::text from leave_carryover$$,
  'nor read anybody''s carried balance', '0');

reset role;
rollback;
