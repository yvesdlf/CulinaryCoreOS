-- ---------------------------------------------------------------------------
-- What was planned and what was made (0130)
-- ---------------------------------------------------------------------------
-- `production_report` puts the prep sheet and the completion record side by
-- side for the first time. Four things it could get wrong, in order of how
-- long each would go unnoticed:
--
--   Counting a corrected batch twice. Both rows stay in the table by design
--   (0060), so a report that sums them reads high and reads *plausible* — the
--   failure mode with no symptom. This is the first thing asserted below and
--   the reason the arithmetic is written out rather than compared to itself.
--
--   Dating a batch by the clock instead of the plan. Prep for Saturday lunch
--   done on Friday night is the normal case in a kitchen, not the exception.
--   A report that filtered records by its own period would show every such
--   service as one nobody cooked for, and the kitchen would learn to ignore
--   the column within a fortnight.
--
--   Dropping production that answered to no plan. It is the half worth
--   reading: a kitchen improvising is either covering a shortage or ignoring
--   the sheet. Dropping it would make the report agree with the plan by
--   construction — a document that cannot disagree with itself.
--
--   Showing any of it to a reader with no Production access. The three
--   tables are gated on PRODUCTION for reads (`section_read_rules`), and the
--   function is invoker-rights so that gate decides. If it were ever made
--   `security definer` for convenience, nothing else in this suite would
--   notice.
--
-- The fixtures are parked three hundred days back. The demo seed covers the
-- last four weeks and `_fixtures.sql` plants a plan on today, and a test that
-- shared a window with either would be asserting on somebody else's rows.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset
select id as prep from sub_recipes where name = 'T-prep' and org_id = :'demo' \gset
select id as dish from recipes where name = 'T-dish' and org_id = :'demo' \gset

/*
 * Four plans, each carrying one thing the report has to notice, plus a batch
 * that answered to nothing.
 *
 *   A  cooked for, and one of its batches corrected afterwards
 *   B  planned and never cooked for
 *   C  a sheet with no dishes written on it
 *   D  prepped the night before
 */
insert into production_plans (id, org_id, planned_for, service, note, created_by_email)
values
  ('e0000000-0000-4000-8000-000000000691', :'demo', current_date - 300,
   'Dinner', 'T-69-A', 'chef@test.local'),
  ('e0000000-0000-4000-8000-000000000692', :'demo', current_date - 301,
   'Lunch',  'T-69-B', 'chef@test.local'),
  ('e0000000-0000-4000-8000-000000000693', :'demo', current_date - 302,
   'Dinner', 'T-69-C', 'chef@test.local'),
  ('e0000000-0000-4000-8000-000000000694', :'demo', current_date - 303,
   'Dinner', 'T-69-D', 'chef@test.local');

-- C deliberately gets none; the other three get a dish each.
insert into production_plan_lines (plan_id, recipe_id, covers)
values
  ('e0000000-0000-4000-8000-000000000691', :'dish', 40),
  ('e0000000-0000-4000-8000-000000000692', :'dish', 25),
  ('e0000000-0000-4000-8000-000000000694', :'dish', 30);

/*
 * A's batches: two of them, and the second is superseded by a correction
 * halving it. Effective is 2 + 0.5 = 2.5 batches of a 1000 g preparation,
 * which is 2500 g. A double count would say 3.5 and 3500, and both numbers
 * would look like a busy service.
 */
insert into production_records
  (id, plan_id, sub_recipe_id, batches, unit, occurred_at, produced_by_email,
   corrects_id, correction_reason)
values
  ('e0000000-0000-4000-8000-000000000695',
   'e0000000-0000-4000-8000-000000000691', :'prep', 2, 'g',
   ((current_date - 300)::timestamp + interval '8 hours') at time zone 'UTC',
   'cook-one@test.local', null, null),
  ('e0000000-0000-4000-8000-000000000696',
   'e0000000-0000-4000-8000-000000000691', :'prep', 1, 'g',
   ((current_date - 300)::timestamp + interval '9 hours') at time zone 'UTC',
   'cook-two@test.local', null, null),
  ('e0000000-0000-4000-8000-000000000697',
   'e0000000-0000-4000-8000-000000000691', :'prep', 0.5, 'g',
   ((current_date - 300)::timestamp + interval '11 hours') at time zone 'UTC',
   'cook-two@test.local',
   'e0000000-0000-4000-8000-000000000696',
   'Counted the second tray twice when writing the sheet up.'),

  -- C: a batch against a sheet with nothing written on it.
  ('e0000000-0000-4000-8000-000000000698',
   'e0000000-0000-4000-8000-000000000693', :'prep', 1, 'g',
   ((current_date - 302)::timestamp + interval '8 hours') at time zone 'UTC',
   'cook-one@test.local', null, null),

  -- D: worked the night before the service it belongs to.
  ('e0000000-0000-4000-8000-000000000699',
   'e0000000-0000-4000-8000-000000000694', :'prep', 3, 'g',
   ((current_date - 304)::timestamp + interval '21 hours') at time zone 'UTC',
   'cook-one@test.local', null, null),

  -- And one that answered to nothing at all.
  ('e0000000-0000-4000-8000-00000000069a',
   null, :'prep', 1.5, 'g',
   ((current_date - 305)::timestamp + interval '19 hours') at time zone 'UTC',
   'cook-two@test.local', null, null);

select '── production: the period is the report''s own ───────────────────';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_refused($$
  select * from public.production_report(null, current_date)$$,
  'a production report with no period is refused rather than guessed at',
  'needs a period');

select t.expect_refused($$
  select * from public.production_report(current_date, current_date - 7)$$,
  'and so is one that ends before it begins', 'ends before it begins');

/*
 * The fixture actually loaded.
 *
 * `_harness.sql` records this failure: a half-loaded fixture reports passes
 * for checks that never executed. Every count below is of a subset, so if the
 * four plans were not inserted the subsets would all be empty and all agree.
 * This is the one assertion that would notice.
 */
select t.expect_value($$
  select count(*)::text from public.production_report(
    current_date - 310, current_date - 295) pr
    join public.production_plans p on p.id = pr.plan_id
   where p.note like 'T-69-%'$$,
  'all four planned services are in the report', '4');

select '── production: a corrected batch is not counted twice ───────────';

select t.expect_value($$
  select pr.batches_made::text from public.production_report(
    current_date - 310, current_date - 295) pr
    join public.production_plans p on p.id = pr.plan_id
   where p.note = 'T-69-A'$$,
  'a superseded batch drops out of the total', '2.50000');

select t.expect_value($$
  select pr.quantity_made::text from public.production_report(
    current_date - 310, current_date - 295) pr
    join public.production_plans p on p.id = pr.plan_id
   where p.note = 'T-69-A'$$,
  'and so does the quantity it claimed to have made', '2500.00000');

select t.expect_value($$
  select pr.corrections::text from public.production_report(
    current_date - 310, current_date - 295) pr
    join public.production_plans p on p.id = pr.plan_id
   where p.note = 'T-69-A'$$,
  'but the correction itself is counted and said out loud', '1');

select t.expect_value($$
  select (array_to_string(pr.concerns, '; ')) from public.production_report(
    current_date - 310, current_date - 295) pr
    join public.production_plans p on p.id = pr.plan_id
   where p.note = 'T-69-A'$$,
  'and named in the concerns, in words a reader can act on',
  '1 batch corrected after the fact');

/*
 * The two cooks are both named. A report that showed only the last one would
 * make a service look like one person''s work — and the correction was made
 * by the same cook who recorded the batch, so a distinct count is two.
 */
select t.expect_value($$
  select pr.made_by from public.production_report(
    current_date - 310, current_date - 295) pr
    join public.production_plans p on p.id = pr.plan_id
   where p.note = 'T-69-A'$$,
  'everyone who worked the service is named',
  'cook-one@test.local, cook-two@test.local');

select '── production: the three disagreements ──────────────────────────';

select t.expect_value($$
  select array_to_string(pr.concerns, '; ') from public.production_report(
    current_date - 310, current_date - 295) pr
    join public.production_plans p on p.id = pr.plan_id
   where p.note = 'T-69-B'$$,
  'a service planned and never cooked for says so',
  'planned, and nothing was made for it');

select t.expect_value($$
  select pr.preparations_made::text from public.production_report(
    current_date - 310, current_date - 295) pr
    join public.production_plans p on p.id = pr.plan_id
   where p.note = 'T-69-B'$$,
  'and reports nothing made rather than no row at all', '0');

select t.expect_value($$
  select array_to_string(pr.concerns, '; ') from public.production_report(
    current_date - 310, current_date - 295) pr
    join public.production_plans p on p.id = pr.plan_id
   where p.note = 'T-69-C'$$,
  'a sheet with no dishes on it says that instead',
  'a plan with no dishes on it');

select t.expect_rows($$
  select 1 from public.production_report(
    current_date - 310, current_date - 295)
   where plan_id is null
     and planned_for = current_date - 305
     and 'made with no plan behind it' = any(concerns)$$,
  'production with no plan behind it gets its own row, by the day it happened',
  1);

select t.expect_value($$
  select batches_made::text from public.production_report(
    current_date - 310, current_date - 295)
   where plan_id is null and planned_for = current_date - 305$$,
  'carrying what was actually made', '1.50000');

select '── production: a batch belongs to its plan, not to its clock ────';

/*
 * D was prepped at nine the previous evening. The service is still answered.
 * If this ever reads 0, the function has started filtering records by the
 * report''s own period, and every Saturday-lunch prep in the venue will read
 * as a service nobody cooked for.
 */
select t.expect_value($$
  select pr.batches_made::text from public.production_report(
    current_date - 310, current_date - 295) pr
    join public.production_plans p on p.id = pr.plan_id
   where p.note = 'T-69-D'$$,
  'prep done the night before still answers the service it was for', '3.00000');

select t.expect_value($$
  select array_to_string(pr.concerns, '; ') from public.production_report(
    current_date - 310, current_date - 295) pr
    join public.production_plans p on p.id = pr.plan_id
   where p.note = 'T-69-D'$$,
  'and raises no concern about it', '');

/*
 * The same claim, with the period drawn so it *matters*.
 *
 * The check above passes on a function that filters records by the report's
 * own dates, because the window is wide enough to contain the night before
 * as well as the service. That is the harness's first false-pass mode wearing
 * a different coat: an assertion that cannot fail is not an assertion. Here
 * the window opens on D's service and the batch is the day before it, outside
 * — so a date filter returns 0 and only the join on the plan returns 3.
 */
select t.expect_value($$
  select pr.batches_made::text from public.production_report(
    current_date - 303, current_date - 295) pr
    join public.production_plans p on p.id = pr.plan_id
   where p.note = 'T-69-D'$$,
  'and still answers it when the period itself excludes the night before',
  '3.00000');

/*
 * The other side of the same rule: a *planless* batch has only its own date,
 * so a window that excludes that date must exclude the row. Without this the
 * previous check would pass just as well on a function that ignored the
 * period entirely.
 */
select t.expect_rows($$
  select 1 from public.production_report(
    current_date - 304, current_date - 295)
   where plan_id is null and planned_for = current_date - 305$$,
  'but an unplanned batch outside the period stays out of it', 0);

select '── production: one venue, the one the reader is in ──────────────';

/*
 * Row-level security answers "may I see this", not "is this mine".
 *
 * A second venue, which chef@ also belongs to, with a service of its own on
 * the same day as A. Without an explicit scope the report would return both
 * — two Dinner rows on one date with no column saying which kitchen, and
 * totals that are the sum of two. RLS would permit every one of those rows,
 * so nothing else in this suite would object.
 *
 * `active_org_id` is set explicitly rather than left to the fallback,
 * because adding a second membership can change which venue the fallback
 * picks; the test would then be asserting the ordering rule rather than the
 * scope.
 */
reset role;
select t.act_as_nobody();

insert into organizations (id, name, slug)
values ('e0000000-0000-4000-8000-000000000690', 'T-69 Other Venue', 't69-other');

insert into organization_members (organization_id, user_id, role)
values ('e0000000-0000-4000-8000-000000000690',
        'a0000000-0000-0000-0000-000000000002', 'OWNER');

insert into member_access (org_id, user_id, section_code, level)
select 'e0000000-0000-4000-8000-000000000690',
       'a0000000-0000-0000-0000-000000000002', code, 'WRITE'
  from app_sections;

insert into member_preferences (user_id, active_org_id)
values ('a0000000-0000-0000-0000-000000000002', :'demo')
on conflict (user_id) do update set active_org_id = excluded.active_org_id;

insert into production_plans (id, org_id, planned_for, service, note,
                              created_by_email)
values ('e0000000-0000-4000-8000-00000000069b',
        'e0000000-0000-4000-8000-000000000690', current_date - 300,
        'Dinner', 'T-69-OTHER', 'chef@test.local');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_value($$
  select count(*)::text from public.production_report(
    current_date - 310, current_date - 295) pr
    join public.production_plans p on p.id = pr.plan_id
   where p.note like 'T-69-%'$$,
  'the other venue''s service is not in this venue''s report', '4');

/*
 * And the control on the control: chef@ really can read it, so the count
 * above is four because of the scope and not because the row is invisible.
 */
select t.expect_rows($$
  select 1 from public.production_plans p where p.note = 'T-69-OTHER'$$,
  'even though the reader can see that plan perfectly well', 1);

select '── production: who may read any of it ───────────────────────────';

select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');

/*
 * NONE on every section, including Production. The function is invoker-rights
 * so row-level security answers this, and the honest answer is nothing at
 * all: unlike traceability, where the lots were shared and only the trace was
 * gated, every table behind this report is gated.
 */
select t.expect_rows($$
  select 1 from public.production_report(current_date - 310, current_date - 295)$$,
  'a reader with no Production access sees no production at all', 0);

/*
 * And not to a signed-out one at all.
 *
 * Asserted as a privilege rather than by calling as `anon`: row-level
 * security would hide the rows anyway, so a call that returned nothing would
 * pass whether or not the grant had been revoked. The grant is the control.
 * `23_exposure.sql` makes the same check across every function; this one is
 * here so that the failure names this report when it happens.
 */
select t.expect_value($$
  select has_function_privilege(
    'anon', 'public.production_report(date,date)', 'execute')::text$$,
  'and a signed-out caller is not granted it at all', 'false');

rollback;
