-- ---------------------------------------------------------------------------
-- What reaches past row-level security
-- ---------------------------------------------------------------------------
-- RLS on every table holds only if nothing callable bypasses it. Two things
-- do: SECURITY DEFINER functions, which run as their owner, and views without
-- `security_invoker`, which read as their owner. Both are reachable over the
-- REST API by name.
--
-- A review before deployment found 31 definer functions still carrying
-- Postgres's default EXECUTE to PUBLIC — so callable with nothing but the
-- public anon key — including one that queued a message into any venue's
-- email and WhatsApp channels, and one that returned every venue's bar costs.
-- It found definer views with no tenant filter, among them a stock view that
-- showed a signed-in stranger the whole demo catalogue.
--
-- The catalogue checks come first because they are the ones that stop the
-- class coming back: a function or view added next year fails here the day
-- it is written, not the day somebody notices.
-- ---------------------------------------------------------------------------

select '── exposure: nothing is callable without signing in ─────────────';

/*
 * The allowlist is empty, and should stay that way unless a feature genuinely
 * runs before sign-in. Adding a name here is a decision, and the reason
 * belongs next to it.
 */
select t.expect_value($$
  select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by 1), '')
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prosecdef
     and has_function_privilege('anon', p.oid, 'execute')$$,
  'no definer function is executable by anon', '');

select t.expect_value($$
  select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by 1), '')
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where a.grantee = 0 and a.privilege_type = 'EXECUTE')$$,
  'and no function in public is executable by PUBLIC, the role everybody has', '');

/*
 * Default privileges are what a function created next month gets. Asked by
 * creating one, as the role migrations run as, rather than by reading
 * pg_default_acl: Postgres's database-wide default (PUBLIC may execute) has
 * no row there at all, so a check on the rows passes while the default is
 * still wide open. That is the mistake the first draft of 0077 made.
 */
begin;
create function public.t_brand_new_function() returns int language sql as 'select 1';
select t.expect_value($$
  select (has_function_privilege('anon', 'public.t_brand_new_function()', 'execute')
       or exists (select 1 from pg_proc p,
                    aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where p.oid = 'public.t_brand_new_function()'::regprocedure
                     and a.grantee = 0))::text$$,
  'and a function created later does not start out executable by anon', 'false');
select t.expect_value($$
  select has_function_privilege('authenticated', 'public.t_brand_new_function()', 'execute')::text$$,
  'but a signed-in user can still call it, as before', 'true');
rollback;

select '── exposure: internal machinery is not an API ───────────────────';

/*
 * These are called by triggers and the scheduler, which run as the owner.
 * Over the API, `notify` writes a message into any venue's outbox addressed
 * however the caller likes; the seeders write defaults into any venue, five
 * of them not idempotently; `escalation_chain` hands out managers' emails.
 */
select t.expect_value($$
  select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by 1), '')
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.proname = 'notify' or p.proname like 'seed\_%'
          or p.proname in ('escalation_chain', 'refresh_section_unit_scoping'))
     and has_function_privilege('authenticated', p.oid, 'execute')$$,
  'notify, the seeders and escalation_chain cannot be called by a signed-in user', '');

select t.expect_value($$
  select (select prosecdef from pg_proc
           where oid = 'public.pour_variance(date,date)'::regprocedure)::text$$,
  'pour_variance reads as the caller, like production_variance', 'false');

select '── exposure: no view reads past RLS without a filter of its own ─';

/*
 * A definer view is allowed — the supplier portal needs them — but only if
 * it names whose rows it returns. One that neither reads as the caller nor
 * filters on the caller's identity returns everybody's.
 */
select t.expect_value($$
  select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
    from pg_class c
   where c.relkind = 'v'
     and c.relnamespace = 'public'::regnamespace
     and has_table_privilege('authenticated', c.oid, 'select')
     and not coalesce('security_invoker=true' = any(c.reloptions)
                   or 'security_invoker=on'   = any(c.reloptions), false)
     and pg_get_viewdef(c.oid) !~ '(auth_org_ids|auth_employee_id|auth_employee_org|auth_supplier_id|can_read_section)\('$$,
  'every view a signed-in user can read is invoker-rights or filtered', '');

select t.expect_value($$
  select (has_table_privilege('authenticated', 'public.scheduled_jobs', 'select')
       or has_table_privilege('anon', 'public.scheduled_jobs', 'select'))::text$$,
  'the scheduler''s job list is not readable over the API', 'false');

select t.expect_value($$
  select relrowsecurity::text from pg_class where oid = 'public.app_sections'::regclass$$,
  'app_sections has row-level security like every other table', 'true');

select '── exposure: a stranger sees nothing, a member still sees theirs ─';

/*
 * Behaviour, not just wiring. A birthday is put on the calendar so the
 * stranger has something to fail to see; product_stock already has the demo
 * catalogue in it. Then the same questions as a member, because a fix that
 * hides everything from everybody would pass the stranger's half on its own.
 */
begin;

update employees set birthday_visible = true
 where org_id = (select id from organizations where name = 'Demo Kitchen')
   and employee_number = 'T-5';
insert into employee_private (employee_id, org_id, date_of_birth)
select id, org_id, '1990-01-15' from employees
 where org_id = (select id from organizations where name = 'Demo Kitchen')
   and employee_number = 'T-5';

insert into time_entries (org_id, employee_id, clock_in_at, clock_out_at)
select org_id, id, now() - interval '8 hours', now() - interval '1 hour'
  from employees
 where org_id = (select id from organizations where name = 'Demo Kitchen')
   and employee_number = 'T-5';

-- A second venue, so "somebody else's" means a venue that exists. Against an
-- id that does not, a refusal is just a foreign key failing.
insert into organizations (id, name, slug)
values ('b0000000-0000-4000-8000-0000000000ee', 'T-Other Venue', 't-other-venue');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-0000000000ff', 'outsider@test.local');

select t.expect_value($$select count(*)::text from product_stock$$,
  'a signed-in user in no venue reads no stock', '0');
select t.expect_value($$select count(*)::text from venue_calendar$$,
  'nor anybody''s calendar', '0');
select t.expect_value($$select count(*)::text from attendance$$,
  'nor anybody''s attendance', '0');
select t.expect_value($$select count(*)::text from production_usage_theoretical$$,
  'nor anybody''s production usage', '0');
select t.expect_value($$select count(*)::text from public.contract_prices$$,
  'and contract prices stay behind RLS', '0');

select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_value($$select (count(*) > 0)::text from product_stock$$,
  'a member still reads their own venue''s stock', 'true');
select t.expect_value($$select (count(*) > 0)::text from venue_calendar
                          where kind = 'BIRTHDAY'$$,
  'and their own venue''s calendar', 'true');
select t.expect_value($$select count(*)::text from attendance$$,
  'and their own venue''s attendance', '1');

select t.expect_fail($$select public.next_reference_stem('KIT',
    'b0000000-0000-4000-8000-0000000000ee')$$,
  'a member cannot draw document numbers from a venue that is not theirs');
select t.expect_ok($$select public.next_reference_stem('KIT')$$,
  'but still draws their own');

rollback;
