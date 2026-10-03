-- ---------------------------------------------------------------------------
-- What a new organisation is given, and the registry that decides it
-- ---------------------------------------------------------------------------
-- This file exists because of a failure it would have caught.
--
-- 0060 was written to add one line to `seed_organization_defaults`. It is the
-- fifth migration to have rewritten that function in full to do it, and it was
-- written on a branch where 0059 did not exist, so the rewrite dropped
-- `seed_media_defaults`. The consequence was not an error: a new venue simply
-- had no retention policy, which under the "a missing row means keep" rule in
-- 0059 means every photograph it ever takes is kept forever. Nobody is told,
-- and the bill arrives eighteen months later.
--
-- Four media checks went red and named the missing line, which is the only
-- reason it was found before merging. They found it by accident — they are
-- about retention, not about seeding. This file is the check that is about it,
-- so the sixth migration to touch the list does not need the accident.
--
-- Asserted on *every* organisation rather than on one. A seeder dropped from
-- the list still leaves its rows behind on the venues that already ran it, so
-- a check against one venue created before the mistake passes while the mistake
-- is live.
-- ---------------------------------------------------------------------------

begin;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select '── starting data: the list is rows, not a function body ─────────';

select t.expect_value($$select count(*)::text from organization_seeders$$,
  'ten seeders are registered', '10');

/*
 * Asked as `authenticated`, not as the suite's own connection.
 *
 * 07_media.sql found this and it applies to every policy in the schema: the
 * suite connects as `postgres`, which owns these tables and is exempt from
 * row-level security. A refusal proved as `postgres` is a trigger refusing;
 * a policy would not have fired at all. The protection on this table is a
 * revoked grant and row-level security with no policy, so it has to be asked
 * as somebody both of those apply to.
 */
set local role authenticated;

select t.expect_fail($$
  insert into organization_seeders (ordinal, function_name)
  values (999, 'seed_anything_at_all')$$,
  'nobody signed in may register a seeder');
select t.expect_fail($$delete from organization_seeders where ordinal = 80$$,
  'nor remove the one that an earlier rewrite dropped by hand');
select t.expect_fail($$
  update organization_seeders set function_name = 'seed_anything_at_all'
   where ordinal = 80$$,
  'nor point an existing row at a different function');
-- Not even read: there is no grant and no policy, so the list is invisible
-- rather than merely read-only. A caller that could read it learns which
-- functions run as the schema owner.
select t.expect_fail($$select count(*) from organization_seeders$$,
  'and cannot even read the list');

reset role;

/*
 * Read back as the owner, because the refusals above prove only that nothing
 * was *allowed*. An attempt that raises leaves no row either way, so the state
 * afterwards is the assertion that matters — the second false pass in
 * _harness.sql, which is a trigger silently correcting rather than refusing.
 */
select t.expect_value($$select count(*)::text from organization_seeders$$,
  'the list is the same length afterwards', '10');
select t.expect_value($$
  select function_name from organization_seeders where ordinal = 80$$,
  'and the media seeder is still the eightieth', 'seed_media_defaults');

select '── starting data: every registered seeder exists ────────────────';

/*
 * The cost of a registry over a function body: the calls resolve at run time,
 * so a typo is not a syntax error. 0060 raises on this at deploy; this is the
 * same question asked of the database as it stands.
 */
select t.expect_value($$
  select count(*)::text from organization_seeders s
   where not exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = s.function_name
        and p.pronargs = 1 and p.proargtypes[0] = 'uuid'::regtype)$$,
  'no seeder is registered under a name that does not exist', '0');

select '── starting data: no venue is missing any of it ─────────────────';

/*
 * One assertion per seeder, naming the rows it is responsible for. Written out
 * rather than derived, because the point is to state what each one owes: a
 * derived check would have been derived from the same broken list.
 */
select t.expect_value($$select count(*)::text from organizations o
  where not exists (select 1 from venue_parameters v
    where v.org_id = o.id and v.code = 'TARGET_FOOD_COST')$$,
  'every venue has its costing targets (seed_venue_parameters)', '0');

select t.expect_value($$select count(*)::text from organizations o
  where not exists (select 1 from approval_policies a where a.org_id = o.id)$$,
  'every venue has an approval policy (seed_purchasing_defaults)', '0');

select t.expect_value($$select count(*)::text from organizations o
  where not exists (select 1 from business_units b where b.org_id = o.id)$$,
  'every venue has business units (seed_purchasing_defaults, 0058)', '0');

select t.expect_value($$select count(*)::text from organizations o
  where not exists (select 1 from budgets b where b.org_id = o.id)$$,
  'every venue has a budget per unit (seed_purchasing_defaults)', '0');

select t.expect_value($$select count(*)::text from organizations o
  where not exists (select 1 from tax_rates r where r.org_id = o.id)$$,
  'every venue has a tax rate (seed_tax_and_channels)', '0');

select t.expect_value($$select count(*)::text from organizations o
  where not exists (select 1 from leave_types l where l.org_id = o.id)$$,
  'every venue has leave types (seed_people_defaults)', '0');

select t.expect_value($$select count(*)::text from organizations o
  where not exists (select 1 from haccp_forms f where f.org_id = o.id)$$,
  'every venue has the food-safety forms (seed_haccp_forms)', '0');

select t.expect_value($$select count(*)::text from organizations o
  where not exists (select 1 from locations l where l.org_id = o.id)$$,
  'every venue has a location tree (seed_maintenance_defaults)', '0');

select t.expect_value($$select count(*)::text from organizations o
  where not exists (select 1 from room_types rt where rt.org_id = o.id)$$,
  'every venue has room types (seed_housekeeping_defaults)', '0');

-- The line that was dropped. Six rows, not one: a retention figure per parent
-- type per kind, and a venue with four of them is a venue keeping two kinds of
-- file forever.
select t.expect_value($$select count(*)::text from organizations o
  where (select count(*) from attachment_retention r where r.org_id = o.id) <> 6$$,
  'every venue has all six retention figures (seed_media_defaults)', '0');

select t.expect_value($$select count(*)::text from organizations o
  where not exists (select 1 from venue_parameters v
    where v.org_id = o.id and v.code = 'PRODUCTION_VARIANCE_TOLERANCE')$$,
  'every venue has a variance tolerance (seed_production_defaults)', '0');

select '── starting data: a venue created now gets all of it ────────────';

/*
 * The checks above pass on a venue that was created while the list was correct
 * and would keep passing after a seeder was dropped. This one creates an
 * organisation *now*, through the same trigger a sign-up goes through, and
 * counts what it was given.
 *
 * Rolled back with the rest of the file, so it leaves nothing behind.
 */
select t.expect_rows($$
  insert into organizations (name, slug) values ('T-Seeded venue', 't-seeded-venue')$$,
  'create a venue the way a sign-up does', 1);

select t.expect_value($$
  select count(*)::text from venue_parameters v
   join organizations o on o.id = v.org_id
  where o.name = 'T-Seeded venue' and v.code = 'TARGET_FOOD_COST'$$,
  'the new venue has its costing target', '1');

select t.expect_value($$
  select count(*)::text from attachment_retention r
   join organizations o on o.id = r.org_id
  where o.name = 'T-Seeded venue'$$,
  'six retention figures on a venue that is seconds old', '6');

select t.expect_value($$
  select count(*)::text from business_units b
   join organizations o on o.id = b.org_id
  where o.name = 'T-Seeded venue'$$,
  'and four business units, not the five the two old trees had', '4');

rollback;
