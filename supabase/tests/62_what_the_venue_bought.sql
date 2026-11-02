-- ---------------------------------------------------------------------------
-- What the venue has actually bought (0121)
-- ---------------------------------------------------------------------------
-- The entitlement gate is the third thing that can refuse a write, and the
-- easiest of the three to get wrong in a way nobody notices until a customer
-- is affected: too tight and a paying venue is locked out of its own records,
-- too loose and the product is free.
--
-- Every check below is written against `chef@test.local`, who holds WRITE on
-- every section in `member_access`. That is deliberate. If the permission gate
-- were doing the refusing, these would pass for the wrong reason and keep
-- passing after the entitlement gate was removed. With full permission, any
-- refusal here has exactly one possible source.
-- ---------------------------------------------------------------------------

select '── entitlement: a venue on no plan is unmetered ──────────────────';

/*
 * The backward-compatibility promise, and the reason 0121 is safe to apply to
 * a live database: billing is opt-in. Every venue that existed before it keeps
 * writing until somebody creates a subscription row.
 */
begin;
select id as demo from organizations where name = 'Demo Kitchen' \gset

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_value($$select entitled_level('RECIPES')::text$$,
  'with no subscription row, a section nobody bought is still writable', 'WRITE');

select t.expect_ok($$
  insert into collections (org_id, name)
  values ((select id from organizations where name='Demo Kitchen'), 'T-Unmetered')$$,
  'and the write actually lands');
rollback;

select '── entitlement: a module nobody bought is unreachable ────────────';

begin;
select id as demo from organizations where name = 'Demo Kitchen' \gset

-- Written as the owner of the platform would: service role, not the venue.
insert into subscriptions (org_id, status) values (:'demo', 'ACTIVE');
insert into subscription_packs (org_id, plan_code) values (:'demo', 'SUPPLY');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_value($$select entitled_level('RECIPES')::text$$,
  'a venue on Supply alone has not bought Kitchen', 'NONE');

/*
 * The message matters as much as the refusal. `expect_refused` requires the
 * reason, so this cannot be satisfied by a foreign key, a typo or the
 * permission gate — all of which would refuse too, and say something else.
 */
select t.expect_refused($$
  insert into collections (org_id, name)
  values ((select id from organizations where name='Demo Kitchen'), 'T-Unsold')$$,
  'and writing to it is refused as a plan problem, not a rights problem',
  'not part of this venue''s plan');

-- The pack it did buy is unaffected.
select t.expect_value($$select entitled_level('PURCHASING')::text$$,
  'while the module it did buy is writable', 'WRITE');
rollback;

select '── entitlement: the plan answers before the permission ───────────';

/*
 * Order of refusal, which is a real decision and not cosmetic. Telling
 * somebody to ask an administrator for rights, when no grant could help
 * because the venue never bought the module, sends them to a person who
 * cannot fix it.
 *
 * chef@ has WRITE on RECIPES. If permission were asked first this would pass
 * the gate and fail somewhere else, or succeed.
 */
begin;
select id as demo from organizations where name = 'Demo Kitchen' \gset
insert into subscriptions (org_id, status) values (:'demo', 'ACTIVE');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_value($$
  select auth_section_level('RECIPES',
    (select id from organizations where name='Demo Kitchen'))::text$$,
  'the chef does hold WRITE on Recipes', 'WRITE');

select t.expect_refused($$
  insert into collections (org_id, name)
  values ((select id from organizations where name='Demo Kitchen'), 'T-Order')$$,
  'and is still refused, for the plan rather than for rights',
  'not part of this venue''s plan');
rollback;

select '── entitlement: a lapsed module keeps its records ────────────────';

/*
 * The distinction the whole schema is shaped around. A venue that stops
 * paying for Kitchen still has a statutory duty to produce its hygiene
 * records, so a lapsed pack must read differently from one never bought —
 * which is only possible because `subscription_packs` ends rows instead of
 * deleting them.
 */
begin;
select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into subscriptions (org_id, status) values (:'demo', 'ACTIVE');
insert into subscription_packs (org_id, plan_code) values (:'demo', 'KITCHEN');
-- Something written while the venue was paying.
insert into collections (org_id, name) values (:'demo', 'T-Written While Paid');
-- And then they stop.
update subscription_packs set ended_on = current_date
 where org_id = :'demo' and plan_code = 'KITCHEN';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_value($$select entitled_level('RECIPES')::text$$,
  'a pack that ended reads READ, not NONE', 'READ');

select t.expect_refused($$
  insert into collections (org_id, name)
  values ((select id from organizations where name='Demo Kitchen'), 'T-After')$$,
  'writing stops, and says the subscription lapsed rather than never existed',
  'read-only');

-- The promise that makes the refusal defensible.
select t.expect_value($$
  select count(*)::text from collections where name = 'T-Written While Paid'$$,
  'and everything written while they were paying is still readable', '1');
rollback;

select '── entitlement: never bought and lapsed do not sound alike ───────';

/*
 * Both refuse, so a check that only asserted "refused" would pass with the
 * two collapsed into one state. These assert the two messages differ, which
 * is the only thing that tells a venue whether to call sales or to renew.
 */
begin;
select id as demo from organizations where name = 'Demo Kitchen' \gset
insert into subscriptions (org_id, status) values (:'demo', 'ACTIVE');
insert into subscription_packs (org_id, plan_code, ended_on)
values (:'demo', 'KITCHEN', current_date);

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

-- Lapsed Kitchen says one thing...
select t.expect_refused($$
  insert into collections (org_id, name)
  values ((select id from organizations where name='Demo Kitchen'), 'T-A')$$,
  'a lapsed module is not described as one that was never sold', 'lapsed');

-- ...and never-bought People says another.
select t.expect_refused($$
  insert into job_roles (org_id, title)
  values ((select id from organizations where name='Demo Kitchen'), 'T Role')$$,
  'and a module never sold is not described as lapsed', 'not part of this venue''s plan');
rollback;

select '── entitlement: Core is never withheld ───────────────────────────';

/*
 * A venue locked out of Administration and Parameters cannot change its
 * payment details, invite the person who would, or export anything on the way
 * out. That is a trap rather than a control, so Core is exempt in every state
 * — including the worst one.
 */
begin;
select id as demo from organizations where name = 'Demo Kitchen' \gset
insert into subscriptions (org_id, status) values (:'demo', 'CANCELLED');

/*
 * The owner, not the chef, for this one: a message channel is the owner's to
 * configure (24_ownership), so a chef's update would match nothing for a
 * reason that has nothing to do with entitlement — and would pass this check
 * after the Core exemption was removed.
 */
set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');

select t.expect_value($$select entitled_level('ADMIN')::text$$,
  'a cancelled venue still reaches Administration', 'WRITE');
select t.expect_value($$select entitled_level('PARAMETERS')::text$$,
  'and Venue parameters', 'WRITE');
select t.expect_value($$select entitled_level('REQUESTS')::text$$,
  'and Requests', 'WRITE');

-- Behaviour, not just the function: a Core write still lands.
select t.expect_rows($$
  update message_channels set name = name
   where org_id = (select id from organizations where name='Demo Kitchen')$$,
  'and a write to a Core section is not refused', 3);
rollback;

select '── entitlement: a failed card does not stop a service ────────────';

/*
 * PAST_DUE keeps writing and CANCELLED does not. Dunning is a commercial
 * problem; stopping a kitchen mid-service over an expired card is an
 * operational one, and costs more than the invoice.
 */
begin;
select id as demo from organizations where name = 'Demo Kitchen' \gset
insert into subscriptions (org_id, status) values (:'demo', 'PAST_DUE');
insert into subscription_packs (org_id, plan_code) values (:'demo', 'KITCHEN');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_ok($$
  insert into collections (org_id, name)
  values ((select id from organizations where name='Demo Kitchen'), 'T-PastDue')$$,
  'a venue behind on payment still writes');

reset role;
update subscriptions set status = 'CANCELLED'
 where org_id = (select id from organizations where name='Demo Kitchen');
set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_refused($$
  insert into collections (org_id, name)
  values ((select id from organizations where name='Demo Kitchen'), 'T-Cancelled')$$,
  'a cancelled one does not', 'read-only');
rollback;

select '── entitlement: a venue cannot sell itself a module ──────────────';

/*
 * The control that decides whether any of the above is a billing system or
 * merely a suggestion. There are no write policies on these tables for
 * `authenticated` at all — not a narrow one, none — so this is testing the
 * absence of something, which is exactly the kind of thing that gets added
 * back by accident.
 *
 * The owner is used rather than the chef: if anybody could do it, it is them.
 */
begin;
select id as demo from organizations where name = 'Demo Kitchen' \gset
insert into subscriptions (org_id, status) values (:'demo', 'ACTIVE');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');

select t.expect_fail($$
  insert into subscription_packs (org_id, plan_code)
  values ((select id from organizations where name='Demo Kitchen'), 'PEOPLE')$$,
  'the owner of the venue cannot grant it a module');

/*
 * `expect_fail` rather than `expect_rows(0)`: there is no write grant on the
 * table at all, so these are refused outright rather than filtered to no
 * rows. That is the stronger of the two outcomes and worth asserting as
 * itself — a policy that merely matched nothing would still be a policy
 * somebody could widen.
 */
select t.expect_refused($$
  update subscriptions set status = 'ACTIVE'
   where org_id = (select id from organizations where name='Demo Kitchen')$$,
  'nor talk its subscription back into life', 'permission denied');

select t.expect_refused($$
  delete from subscriptions
   where org_id = (select id from organizations where name='Demo Kitchen')$$,
  'nor delete the subscription to become unmetered again', 'permission denied');

select t.expect_fail($$
  insert into plan_sections (plan_code, section_code) values ('CORE', 'PAY')$$,
  'nor move a section into the pack they already have');

-- They may see what they are on. Reading is the point of the screen.
select t.expect_value($$
  select status::text from subscriptions
   where org_id = (select id from organizations where name='Demo Kitchen')$$,
  'but they can read what their venue is on', 'ACTIVE');
rollback;

select '── entitlement: one venue cannot read another'' s subscription ────';

begin;
insert into organizations (id, name, slug)
values ('b0000000-0000-4000-8000-000000620001', 'T-Other Venue', 't-other-venue');
insert into subscriptions (org_id, status)
values ('b0000000-0000-4000-8000-000000620001', 'ACTIVE');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_value($$
  select count(*)::text from subscriptions
   where org_id = 'b0000000-0000-4000-8000-000000620001'$$,
  'somebody else''s billing state is not readable', '0');
rollback;

select '── entitlement: the catalogue covers the product ─────────────────';

/*
 * A section in no pack is a section nobody can be sold and nobody can be
 * stopped from using. `entitled_level` lets those through deliberately —
 * refusing a section that cannot be bought would lock every venue out of it
 * forever — which means a section added later and never mapped silently
 * becomes free. This is the check that notices.
 */
select t.expect_value($$
  select coalesce(string_agg(s.code, ', ' order by s.code), '')
    from app_sections s
   where not exists (select 1 from plan_sections ps where ps.section_code = s.code)$$,
  'every section belongs to a pack somebody can buy', '');

select t.expect_value($$
  select coalesce(string_agg(section_code, ', '), '')
    from (select section_code from plan_sections
          group by section_code having count(*) > 1) x$$,
  'and to exactly one, so dropping a pack has an unambiguous effect', '');

select t.expect_value($$
  select count(*)::text from plans where is_core$$,
  'exactly one pack is the one that is never withheld', '1');

select '── entitlement: the platform can still bill a cancelled venue ────';

/*
 * The service role writes with no `auth.uid()`, and the guard returns early
 * on that. If it did not, a cancelled venue could never be reinstated,
 * because reinstating it is itself a write.
 */
begin;
select id as demo from organizations where name = 'Demo Kitchen' \gset
insert into subscriptions (org_id, status) values (:'demo', 'CANCELLED');
insert into subscription_packs (org_id, plan_code) values (:'demo', 'KITCHEN');

select t.expect_ok($$
  update subscriptions set status = 'ACTIVE'
   where org_id = (select id from organizations where name='Demo Kitchen')$$,
  'the platform can reinstate a venue it cut off');

select t.expect_value($$
  select entitled_level('RECIPES',
    (select id from organizations where name='Demo Kitchen'))::text$$,
  'and the module it holds is writable again the moment it is', 'WRITE');
rollback;

select '── entitlement: what the settings screen reads ───────────────────';

begin;
select id as demo from organizations where name = 'Demo Kitchen' \gset
insert into subscriptions (org_id, status) values (:'demo', 'ACTIVE');
insert into subscription_packs (org_id, plan_code) values (:'demo', 'KITCHEN');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_value($$
  select count(*)::text from org_entitlements
   where org_id = (select id from organizations where name='Demo Kitchen')$$,
  'the grid offers every section', '19');

select t.expect_value($$
  select level::text from org_entitlements
   where section_code = 'RECIPES'
     and org_id = (select id from organizations where name='Demo Kitchen')$$,
  'and says WRITE for a pack the venue holds', 'WRITE');

select t.expect_value($$
  select level::text from org_entitlements
   where section_code = 'PAY'
     and org_id = (select id from organizations where name='Demo Kitchen')$$,
  'and NONE for one it does not', 'NONE');

select t.expect_value($$
  select plan_name from org_entitlements
   where section_code = 'HOUSEKEEPING'
     and org_id = (select id from organizations where name='Demo Kitchen')$$,
  'and names the pack that would sell it', 'Property');
rollback;
