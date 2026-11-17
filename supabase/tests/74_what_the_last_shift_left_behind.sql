-- ---------------------------------------------------------------------------
-- What the last shift left behind, and whether anybody read it (0135)
-- ---------------------------------------------------------------------------
-- Four things this file exists to prevent.
--
--   A draft counting as a handover. 0071 makes DRAFT mean nobody else can
--   see it, so a department that writes them and never publishes has handed
--   over nothing at all — while believing it has. If a draft ever counted
--   towards `days_covered` the report would show that department as the best
--   in the venue.
--
--   A department with no handovers disappearing. It has none *because* it
--   has stopped writing them, so joining to the handover table drops exactly
--   the department most worth asking about. The same mistake the housekeeping
--   report made with rooms out of service, which is why it is checked here.
--
--   The longest gap ignoring the edges of the period. A department that
--   published once in the middle of a month has a gap before and a gap
--   after, and both are longer than the nought a naive "difference between
--   consecutive covered days" would report for a single row.
--
--   An empty handover passing as a handover. Published, no items, nothing in
--   the summary: it satisfies every check in the system and tells the next
--   shift nothing. Counted apart from the days with nothing at all, because
--   a department that has stopped bothering and one that has stopped
--   pretending are different problems.
--
-- The fixtures sit three hundred days back; the demo seed covers the last
-- four weeks across all five real departments.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

/*
 * Codes with distinct first three characters, because `unit_code()` is that
 * prefix and `idx_business_units_prefix` is unique on it. T74A, T74B, T74C
 * and T74D all collapse to T74 and the second insert is refused.
 */
insert into business_units (id, org_id, code, name)
values
  ('e0000000-0000-4000-8000-000000000771', :'demo', 'QAA', 'Test unit A'),
  ('e0000000-0000-4000-8000-000000000772', :'demo', 'QBB', 'Test unit B'),
  ('e0000000-0000-4000-8000-000000000773', :'demo', 'QCC', 'Test unit C'),
  -- D never writes one at all. It must still be in the report.
  ('e0000000-0000-4000-8000-000000000774', :'demo', 'QDD', 'Test unit D');

/*
 * A publishes once, in the middle of a sixteen-day period: seven days before
 * it and eight after. B writes one and never publishes it. C publishes one
 * with nothing in it and nobody acknowledges it.
 */
insert into handovers
  (id, org_id, business_unit_id, on_date, service, status,
   written_by_email, published_at, acknowledged_by_email, acknowledged_at, summary)
values
  ('e0000000-0000-4000-8000-000000000781', :'demo',
   'e0000000-0000-4000-8000-000000000771', current_date - 303, 'Evening',
   'PUBLISHED', 'writer@test.local',
   ((current_date - 303)::timestamp + interval '23 hours') at time zone 'UTC',
   'reader@test.local',
   ((current_date - 302)::timestamp + interval '7 hours') at time zone 'UTC',
   'A quiet one.'),

  ('e0000000-0000-4000-8000-000000000782', :'demo',
   'e0000000-0000-4000-8000-000000000772', current_date - 300, 'Evening',
   'DRAFT', 'writer@test.local', null, null, null, 'Written and left in a drawer.'),

  ('e0000000-0000-4000-8000-000000000783', :'demo',
   'e0000000-0000-4000-8000-000000000773', current_date - 300, 'Evening',
   'PUBLISHED', 'writer@test.local',
   ((current_date - 300)::timestamp + interval '23 hours') at time zone 'UTC',
   null, null, null);

insert into handover_items (handover_id, kind, note)
values
  ('e0000000-0000-4000-8000-000000000781', 'SAFETY',
   'Fire door on the terrace was wedged open; closed it.'),
  ('e0000000-0000-4000-8000-000000000781', 'STOCK', 'Down to two cases of tonic.'),
  -- On the draft, so the report must not count it as handed over.
  ('e0000000-0000-4000-8000-000000000782', 'BROKEN', 'Glasswasher draining slowly.');

select '── handover: the period is the report''s own ────────────────────';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_refused($$
  select * from public.handover_report(null, current_date)$$,
  'a handover report with no period is refused rather than guessed at',
  'needs a period');

select t.expect_refused($$
  select * from public.handover_report(current_date, current_date - 7)$$,
  'and so is one that ends before it begins', 'ends before it begins');

select t.expect_value($$
  select count(*)::text from public.handover_report(
    current_date - 310, current_date - 295) where unit_code like 'Q%'$$,
  'all four test departments are in the report', '4');

select '── handover: a draft is not a handover ─────────────────────────';

select t.expect_value($$
  select drafts::text from public.handover_report(
    current_date - 310, current_date - 295) where unit_code = 'QBB'$$,
  'a department that writes and never publishes is counted as doing so', '1');

/*
 * And has covered nothing. This is the assertion that fails if a draft is
 * ever allowed to count: B would otherwise show one covered day and look
 * better than the department that published.
 */
select t.expect_value($$
  select days_covered::text from public.handover_report(
    current_date - 310, current_date - 295) where unit_code = 'QBB'$$,
  'and has handed over nothing at all, because nobody else can see a draft',
  '0');

select t.expect_value($$
  select (concerns @> array[
    '1 written and never published, so nobody else saw it'])::text
    from public.handover_report(current_date - 310, current_date - 295)
   where unit_code = 'QBB'$$,
  'and that is the first thing its row says', 'true');

/*
 * The item on the draft must not be counted either. A note nobody can read
 * is not information that was passed on.
 */
select t.expect_value($$
  select items::text from public.handover_report(
    current_date - 310, current_date - 295) where unit_code = 'QBB'$$,
  'the note on the draft is still counted as written, not as handed over', '1');

select '── handover: a department that writes none at all ──────────────';

select t.expect_value($$
  select days_missing::text from public.handover_report(
    current_date - 310, current_date - 295) where unit_code = 'QDD'$$,
  'a department with no handovers is listed, with the whole period missing',
  '16');

select t.expect_value($$
  select written::text from public.handover_report(
    current_date - 310, current_date - 295) where unit_code = 'QDD'$$,
  'and nought rather than null in the columns it has nothing for', '0');

select '── handover: the longest gap counts the edges ──────────────────';

/*
 * A published once, on the eighth day of a sixteen-day period: seven days
 * before it and eight after. The answer is eight.
 *
 * A version that only measured between consecutive covered days would
 * report nought here — there is only one covered day, so there are no
 * consecutive pairs — and a department that published once in a month would
 * look like one with no gaps at all.
 */
select t.expect_value($$
  select days_covered::text from public.handover_report(
    current_date - 310, current_date - 295) where unit_code = 'QAA'$$,
  'one day covered out of sixteen', '1');

select t.expect_value($$
  select longest_gap_days::text from public.handover_report(
    current_date - 310, current_date - 295) where unit_code = 'QAA'$$,
  'and the longest run without one reaches the end of the period', '8');

select '── handover: published, and saying nothing ─────────────────────';

select t.expect_value($$
  select empty_handovers::text from public.handover_report(
    current_date - 310, current_date - 295) where unit_code = 'QCC'$$,
  'a handover with no items and no summary is counted as empty', '1');

select t.expect_value($$
  select never_acknowledged::text from public.handover_report(
    current_date - 310, current_date - 295) where unit_code = 'QCC'$$,
  'and nobody acknowledged it either', '1');

/*
 * A's was acknowledged at seven the next morning, eight hours after it was
 * published at eleven at night. Measured from `published_at`, not from the
 * handover's date: a handover written on Tuesday and read on Wednesday
 * morning was read promptly, and dating it from Tuesday midnight would call
 * it thirty-one hours.
 */
select t.expect_value($$
  select avg_hours_to_acknowledge::text from public.handover_report(
    current_date - 310, current_date - 295) where unit_code = 'QAA'$$,
  'time to acknowledge runs from when it was published', '8.0');

select t.expect_value($$
  select safety_items::text from public.handover_report(
    current_date - 310, current_date - 295) where unit_code = 'QAA'$$,
  'and safety items are counted apart from the rest', '1');

select '── handover: one venue, and who may read it ────────────────────';

reset role;
select t.act_as_nobody();

insert into organizations (id, name, slug)
values ('e0000000-0000-4000-8000-000000000770', 'T-74 Other Venue', 't74-other');
insert into organization_members (organization_id, user_id, role)
values ('e0000000-0000-4000-8000-000000000770',
        'a0000000-0000-0000-0000-000000000002', 'OWNER');
insert into member_preferences (user_id, active_org_id)
values ('a0000000-0000-0000-0000-000000000002', :'demo')
on conflict (user_id) do update set active_org_id = excluded.active_org_id;
insert into business_units (id, org_id, code, name)
values ('e0000000-0000-4000-8000-000000000775',
        'e0000000-0000-4000-8000-000000000770', 'QEE', 'Other venue unit');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_rows($$
  select 1 from public.handover_report(current_date - 310, current_date - 295)
   where unit_code = 'QEE'$$,
  'the other venue''s departments are not in this venue''s report', 0);

select t.expect_rows($$
  select 1 from public.business_units where code = 'QEE'$$,
  'even though the reader can see that department perfectly well', 1);

select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');

/*
 * And this one is not row-level security doing the work.
 *
 * A row here is a *department*, and `business_units` is shared — every
 * member of the venue can read it. So the row set survives RLS untouched
 * and only the counts come from the gated tables: without the explicit
 * check in 0135 this reader was handed five departments with nought in
 * every column, which reads as "nobody wrote a handover all month" rather
 * than "this is not yours to read". The first version of the function did
 * exactly that, and this is the check that found it.
 */
select t.expect_rows($$
  select 1 from public.handover_report(current_date - 310, current_date - 295)$$,
  'a reader with no Handover access sees nothing, not a venue of empty columns',
  0);

select t.expect_value($$
  select has_function_privilege(
    'anon', 'public.handover_report(date,date)', 'execute')::text$$,
  'and a signed-out caller is not granted it at all', 'false');

rollback;
