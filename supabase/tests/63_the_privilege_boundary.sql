-- ---------------------------------------------------------------------------
-- The privilege boundary, asserted rather than assumed (0122)
-- ---------------------------------------------------------------------------
-- Every other file in this suite tests a policy or a trigger. This one tests
-- the layer underneath them: whether the table is addressable by the role at
-- all.
--
-- It exists because that layer silently disappeared on hosted Supabase and no
-- check noticed for 121 migrations. The project's default privileges grant
-- all on every new table to `anon` and `authenticated`, so a migration that
-- granted what it needed without revoking first was a no-op there — and the
-- local database, where this suite runs, was the only place the boundary
-- existed. 19 checks went red the first time the suite was pointed at a
-- hosted project; none had ever gone red in CI.
--
-- So these assertions are written to hold on *any* database, hosted or local,
-- and a run against staging is the only thing that exercises what they are
-- for. See DEPLOY.md §1.
-- ---------------------------------------------------------------------------

select '── privileges: a signed-out visitor reaches the registry only ────';

/*
 * `anon` is the role an unauthenticated request arrives as. Row-level
 * security still stands behind this, and in every probe it returned no rows
 * — but a privilege it should not have is a layer that is not there, and the
 * whole point of two layers is not to find out which one was load-bearing.
 *
 * The three exceptions carry no venue's information: they are the allergen
 * substances and the profiles saying which of them a venue must declare.
 */
select t.expect_value($$
  select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and has_table_privilege('anon', c.oid, 'SELECT')
     and c.relname not in
       ('allergen_substances', 'allergen_profiles', 'allergen_declarations')$$,
  'a signed-out visitor can address nothing but the allergen registry', '');

select t.expect_value($$
  select coalesce(string_agg(c.relname || ':' || p, ', '), '')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   cross join unnest(array['INSERT','UPDATE','DELETE']) as p
   where n.nspname = 'public' and c.relkind = 'r'
     and has_table_privilege('anon', c.oid, p)$$,
  'and write to nothing at all', '');

select '── privileges: the platform''s own plumbing is not venue-readable ─';

/*
 * Credentials, the seeder registry AGENTS.md §6 exists to protect, the answers
 * to the questions being marked, and the retention machinery. A member has no
 * business addressing any of them, and for `quiz_questions` reading the table
 * is the whole attack.
 */
select t.expect_value($$
  select coalesce(string_agg(t, ', ' order by t), '')
    from unnest(array['message_channel_secrets','message_endpoint_origins',
                      'organization_seeders','quiz_questions',
                      'storage_api','storage_deletions']) as t
   where has_table_privilege('authenticated', ('public.'||t)::regclass, 'SELECT')$$,
  'a member cannot read secrets, seeders, quiz answers or the storage tables', '');

select '── privileges: append-only means the grant is absent too ─────────';

/*
 * These are the tables whose honesty the rest of the system rests on: what a
 * parameter used to be, who approved what, what a shift actually recorded,
 * what was charged. Several are protected locally by the absent grant alone
 * — their update policies are never reached — and `parameter_changes`' says
 * `using (auth_can_write(org_id))`, which is true for most of the staff. If
 * the privilege comes back, that policy is what stands between a member and
 * the audit trail, and it would let them through.
 */
select t.expect_value($$
  select coalesce(string_agg(t || ':' || p, ', ' order by t || ':' || p), '')
    from unnest(array['parameter_changes','work_order_events','room_state_events',
                      'approval_events','stock_movements','ai_usage',
                      'ai_allowances','payroll_lines','payroll_runs',
                      'message_deliveries','label_prints','allergen_substances',
                      'allergen_profiles','app_sections','plans',
                      'plan_sections','subscriptions','subscription_packs']) as t
   cross join unnest(array['UPDATE','DELETE']) as p
   where has_table_privilege('authenticated', ('public.'||t)::regclass, p)$$,
  'nothing append-only, priced or platform-owned is updatable or deletable', '');

select '── privileges: a table born after this is caught too ────────────';

/*
 * The canary, and the reason the `anon` check above is written over every
 * table rather than a list.
 *
 * The default privileges that caused all of this are owned by
 * `supabase_admin` on a hosted project, and no migration running as the
 * project role can remove them — 0122 says so rather than pretending
 * otherwise. So the guarantee cannot be "it can never happen again"; it has
 * to be "it cannot happen again unnoticed". A new table born with the hosted
 * defaults is granted to `anon` and `authenticated` alike, and the first
 * assertion in this file sweeps every table in the schema, so the table
 * appears there the first time this suite runs against that database.
 *
 * Which is only true if the suite is actually pointed at one. A local run
 * cannot see a hosted project's defaults, and for 121 migrations nobody
 * looked. DEPLOY.md §1 is the step that matters.
 */
select t.expect_value($$
  select (count(*) > 100)::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'$$,
  'the anon sweep above covers the whole schema, not a list', 'true');
