-- ---------------------------------------------------------------------------
-- What the venue has actually bought (and what happens when it stops)
-- ---------------------------------------------------------------------------
-- docs/commercial/PRICING.md sells module packs — Core, Kitchen, Supply,
-- People, Property, Revenue — priced per venue. Nothing enforced that. There
-- was no subscription, no entitlement and no way to stop a venue using a
-- module it had not paid for, and `ai_allowances` was set by hand with the
-- service role.
--
-- The seam is already here: a pack is a group of `app_sections`, and sections
-- are what the access model is built around. So this is a *third gate*, not a
-- change to either of the two that exist.
--
--   auth_can_write(org)          may you write in this venue at all
--   require_section_write(sec)   may *you* write this section
--   entitled_level(sec, org)     has the *venue* bought this section   ← new
--
-- ── Why entitlement is not expressed through member_access ─────────────────
--
-- The tempting implementation is to grant and revoke `member_access` rows as
-- packs are bought and dropped. Three reasons not to, each of which surfaces
-- later as a support call:
--
--   1. "Not sold" and "not permitted" are different facts. Folded together,
--      an unpaid invoice is indistinguishable from a manager revoking a
--      permission, and the audit trail now lies about why access was lost.
--   2. Re-subscribing has to restore what was there. If dropping a pack
--      destroyed the grants, nobody can say what they were.
--   3. Lapsing must not make records unreachable. HACCP sheets, payroll and
--      traceability lots carry statutory retention; a venue that stops paying
--      for Kitchen still has a legal duty to produce its hygiene records.
--
-- ── The three states, and why they are three and not two ───────────────────
--
--   never bought it   NONE   there is no data; the module is genuinely
--                            unreachable, which is what AGENTS.md §1 asks for
--   bought, lapsed    READ   the data exists and stays readable and
--                            exportable — see reason 3 above
--   bought, current   WRITE
--
-- Distinguishing the first two is the whole reason `subscription_packs` keeps
-- ended rows instead of deleting them.
--
-- ── Two deliberate refusals to withhold ────────────────────────────────────
--
-- Core is never withheld, whatever the subscription says. Core carries
-- Parameters and Administration, and a venue locked out of those cannot fix
-- its own billing, invite the person who would, or export anything on the way
-- out. A lock that cannot be undone from inside is a trap, not a control.
--
-- PAST_DUE still writes. A failed card is a commercial problem; stopping a
-- kitchen mid-service over one is an operational disaster that costs more
-- goodwill than the invoice is worth. Only CANCELLED drops to READ.
--
-- ── Writes only ────────────────────────────────────────────────────────────
--
-- This gate governs writes. Reads are untouched, for two reasons: a
-- never-bought section has no rows to read, and a lapsed one must stay
-- readable by design. Threading entitlement through the three hundred read
-- policies would buy nothing and risk a great deal.
--
-- ── A venue with no subscription row is unmetered ──────────────────────────
--
-- Explicitly, and this is what makes the migration safe to apply to a live
-- database: billing is opt-in per organisation. Every venue that exists today
-- keeps full write access until somebody creates a subscription row for it.
-- ---------------------------------------------------------------------------

-- ── What is sold ───────────────────────────────────────────────────────────
/*
 * Platform catalogue, not venue data, so it belongs in the migration body for
 * the same reason `app_sections` does (0036) and AGENTS.md §6 does not apply:
 * §6 is about rows that must exist *per organisation*, which these are not.
 */
create table if not exists plans (
  code        text primary key,
  name        text not null,
  description text not null,
  /*
   * Not `app_sections.is_core`, which means "losing this would stop somebody
   * doing their job". This means "always included, never sold separately, and
   * never withheld" — the commercial sense. The two are deliberately separate
   * columns on separate tables because they answer different questions.
   */
  is_core     boolean not null default false,
  sort_order  integer not null default 0
);

create table if not exists plan_sections (
  plan_code    text not null references plans(code) on delete cascade,
  section_code text not null references app_sections(code) on delete cascade,
  primary key (plan_code, section_code),
  /*
   * One pack per section. Two packs carrying the same section would mean
   * dropping one leaves the section half-sold, and `entitled_level` would
   * have to pick a winner. There is no good rule for picking, so the schema
   * refuses the situation instead.
   */
  unique (section_code)
);

insert into plans (code, name, description, is_core, sort_order) values
  ('CORE',     'Core',     'The section grid, the audit trail, requests, handover, messaging and the staff portal. Always included.', true,  10),
  ('KITCHEN',  'Kitchen',  'Costing, sub-recipes, allergens, menu engineering, production and HACCP.',                               false, 20),
  ('SUPPLY',   'Supply',   'Stock, counts, requisitions, orders, receiving, landed cost, suppliers and recall.',                     false, 30),
  ('PEOPLE',   'People',   'Rota, attendance, leave and carry-over, HR cases and payroll export.',                                   false, 40),
  ('PROPERTY', 'Property', 'Assets, work orders, meters, rooms and attendant workload.',                                             false, 50),
  ('REVENUE',  'Revenue',  'Takings, forecasting and profit by unit.',                                                               false, 60)
on conflict (code) do nothing;

insert into plan_sections (plan_code, section_code) values
  ('CORE',     'PARAMETERS'),
  ('CORE',     'ADMIN'),
  ('CORE',     'MESSAGING'),
  ('CORE',     'REQUESTS'),
  ('CORE',     'HANDOVER'),
  ('KITCHEN',  'RECIPES'),
  ('KITCHEN',  'MENU'),
  ('KITCHEN',  'PRODUCTION'),
  ('KITCHEN',  'HYGIENE'),
  ('SUPPLY',   'INVENTORY'),
  ('SUPPLY',   'PURCHASING'),
  ('SUPPLY',   'SUPPLIERS'),
  ('SUPPLY',   'TRACEABILITY'),
  ('PEOPLE',   'PEOPLE'),
  ('PEOPLE',   'HR_CASES'),
  ('PEOPLE',   'PAY'),
  ('PROPERTY', 'MAINTENANCE'),
  ('PROPERTY', 'HOUSEKEEPING'),
  ('REVENUE',  'REVENUE')
on conflict do nothing;

-- ── What a venue is on ─────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'subscription_status') then
    create type subscription_status as enum
      ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED');
  end if;
end $$;

create table if not exists subscriptions (
  org_id     uuid primary key references organizations(id) on delete cascade,
  status     subscription_status not null default 'TRIALING',

  trial_ends_on        date,
  current_period_start date,
  current_period_end   date,

  /*
   * The provider's own identifier, and null until there is a provider. Which
   * provider is still an open commercial question — see
   * docs/programme/DEPLOYMENT_AND_BILLING.md — so nothing here assumes one,
   * and no column is named after one.
   */
  external_ref text,

  updated_at       timestamptz not null default now(),
  updated_by_email text
);

create table if not exists subscription_packs (
  org_id     uuid not null references subscriptions(org_id) on delete cascade,
  plan_code  text not null references plans(code),
  started_on date not null default current_date,
  /*
   * Null means currently held. A dropped pack is ended, never deleted: the
   * difference between "never bought Kitchen" and "had Kitchen until March"
   * is the difference between NONE and READ, and deleting the row throws the
   * only evidence away.
   */
  ended_on   date,
  primary key (org_id, plan_code, started_on),
  constraint subscription_packs_ends_after_it_starts
    check (ended_on is null or ended_on >= started_on)
);

-- At most one live holding of a pack at a time.
create unique index if not exists subscription_packs_one_current
  on subscription_packs (org_id, plan_code) where ended_on is null;

create index if not exists subscription_packs_by_org
  on subscription_packs (org_id);

comment on table plans is
  'The module packs that are sold. Platform catalogue; venues never write it.';
comment on table subscriptions is
  'What a venue is on. No row means unmetered: billing is opt-in per organisation.';
comment on table subscription_packs is
  'Which packs a venue holds, with history. Ended rows are kept so a lapsed pack can be told from one never bought.';

-- ── The gate ───────────────────────────────────────────────────────────────
/*
 * Computed live rather than materialised into a table.
 *
 * The first draft of this was a derived `org_entitlements` table refreshed by
 * a function, in the shape of `refresh_section_unit_scoping()` (0062). That is
 * right for `scopes_by_unit`, which is derived from the *schema* and changes
 * only when a migration runs. It is wrong here, because this is derived from
 * rows that change whenever somebody pays or stops paying, and a stale write
 * gate is either a hole or a lockout. The joins are three small indexed
 * tables; correctness is worth more than the microseconds.
 */
create or replace function public.entitled_level(p_section text, p_org uuid)
returns public.access_level
language sql
stable
security definer
set search_path = ''
as $$
  with sub as (
    select s.status from public.subscriptions s where s.org_id = p_org
  ),
  owned as (
    /*
     * `bool_or` over no rows is null, not false, and that is the signal being
     * used: null here means the venue has never held a pack containing this
     * section. True means it holds one now; false means it did once.
     */
    select bool_or(sp.ended_on is null) as held_now
      from public.subscription_packs sp
      join public.plan_sections ps on ps.plan_code = sp.plan_code
     where sp.org_id = p_org
       and ps.section_code = p_section
  )
  select case
    -- No subscription row at all: unmetered.
    when not exists (select 1 from sub)
      then 'WRITE'::public.access_level
    -- Core is never withheld; see the header.
    when exists (select 1
                   from public.plan_sections ps
                   join public.plans p on p.code = ps.plan_code
                  where ps.section_code = p_section and p.is_core)
      then 'WRITE'::public.access_level
    -- A section in no pack at all is not sellable, so it is not withheld.
    when not exists (select 1 from public.plan_sections ps
                      where ps.section_code = p_section)
      then 'WRITE'::public.access_level
    when (select held_now from owned) is null
      then 'NONE'::public.access_level
    when (select status from sub) = 'CANCELLED'
      then 'READ'::public.access_level
    when (select held_now from owned)
      then 'WRITE'::public.access_level
    else 'READ'::public.access_level
  end;
$$;

comment on function public.entitled_level(text, uuid) is
  'Has this venue bought this section: WRITE (held), READ (lapsed, retained) or NONE (never held). No subscription row means unmetered.';

create or replace function public.entitled_level(p_section text)
returns public.access_level
language sql stable security definer set search_path = ''
as $$ select public.entitled_level(p_section, public.auth_default_org_id()); $$;

grant execute on function
  public.entitled_level(text, uuid),
  public.entitled_level(text)
  to authenticated;

-- ── Who may read and write the billing tables ──────────────────────────────
/*
 * A venue reads its own subscription and writes none of it. There are no
 * INSERT, UPDATE or DELETE policies on any of these four tables for
 * `authenticated` at all, which is the point: a venue that could grant itself
 * the People pack is not a billing system. Writes come from the service role
 * — the provider's webhook — which bypasses row-level security.
 *
 * `plans` and `plan_sections` are the catalogue. Every member may read them,
 * because the settings screen has to be able to say what is for sale.
 */
alter table plans              enable row level security;
alter table plan_sections      enable row level security;
alter table subscriptions      enable row level security;
alter table subscription_packs enable row level security;

drop policy if exists plans_read on plans;
create policy plans_read on plans
  for select to authenticated using (true);

drop policy if exists plan_sections_read on plan_sections;
create policy plan_sections_read on plan_sections
  for select to authenticated using (true);

drop policy if exists subscriptions_read on subscriptions;
create policy subscriptions_read on subscriptions
  for select to authenticated using (org_id in (select auth_org_ids()));

drop policy if exists subscription_packs_read on subscription_packs;
create policy subscription_packs_read on subscription_packs
  for select to authenticated using (org_id in (select auth_org_ids()));

revoke all on plans, plan_sections, subscriptions, subscription_packs
  from anon, authenticated;
grant select on plans, plan_sections, subscriptions, subscription_packs
  to authenticated;

-- ── What the screens read ──────────────────────────────────────────────────
/*
 * A view, not a table, for the reason given above `entitled_level`: one
 * implementation of the arithmetic, and nothing to go stale.
 */
create or replace view org_entitlements
with (security_invoker = true) as
select o.id              as org_id,
       s.code            as section_code,
       s.name            as section_name,
       ps.plan_code,
       p.name            as plan_name,
       public.entitled_level(s.code, o.id) as level
  from organizations o
 cross join app_sections s
  left join plan_sections ps on ps.section_code = s.code
  left join plans p on p.code = ps.plan_code
 where o.id in (select auth_org_ids());

comment on view org_entitlements is
  'Every section crossed with what this venue has bought. Derived from entitled_level, never stored.';

grant select on org_entitlements to authenticated;

-- ── The third gate, wired in ───────────────────────────────────────────────
/*
 * 0062's body, with the entitlement question added. Rewritten in full because
 * a trigger body cannot be a registry (AGENTS.md §2) — so the suite is what
 * catches a line going missing, and 11_access_by_unit.sql, 12, 13 and 57 all
 * exercise what is below.
 *
 * Order matters and is deliberate:
 *
 *   1. No `auth.uid()` — the service role, migrations and the provider's
 *      webhook. Untouched, or a venue could never be billed at all.
 *   2. Not a member of this venue — the staff portal. Untouched, for 0062's
 *      reason: refusing a commis chef their own clock-in with a message about
 *      a section they do not know exists.
 *   3. *Entitlement*, before permission. A venue that has not bought People
 *      should not be told to ask an administrator for rights, because no
 *      amount of rights will help. The error has to name the real obstacle.
 *   4. Permission, per unit, exactly as before.
 */
create or replace function public.require_section_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  section text := tg_argv[0];
  fresh jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  stale jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  row_org uuid;
  units uuid[];
  row_unit uuid;
  section_name text;
  plan_level public.access_level;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  row_org := coalesce(
    (fresh ->> 'org_id')::uuid,
    (stale ->> 'org_id')::uuid,
    public.auth_default_org_id());

  units := array(select distinct u from unnest(array[
    nullif(fresh ->> 'business_unit_id', '')::uuid,
    nullif(stale ->> 'business_unit_id', '')::uuid
  ]) as u);
  if array_length(units, 1) is null then
    units := array[null::uuid];
  end if;

  if not exists (
    select 1 from public.organization_members m
     where m.user_id = auth.uid() and m.organization_id = row_org
  ) then
    return coalesce(new, old);
  end if;

  section_name := coalesce(
    (select s.name from public.app_sections s where s.code = section), section);

  /*
   * Entitlement is a property of the venue, so it is asked once and not once
   * per unit: a venue does not buy Kitchen for one department.
   *
   * The two refusals say different things on purpose. "Not included" is a
   * sales conversation; "read-only, your records are still here" is a
   * reassurance somebody needs to hear the moment they discover they cannot
   * save — and it is the promise this schema keeps by ending pack rows rather
   * than deleting them.
   */
  plan_level := public.entitled_level(section, row_org);
  if plan_level = 'NONE' then
    raise exception '% is not part of this venue''s plan', section_name
      using hint = 'Add the module that includes it to this venue''s subscription.';
  elsif plan_level <> 'WRITE' then
    raise exception '% is read-only: the subscription for it has lapsed', section_name
      using hint = 'Existing records stay readable and can be exported. Renew to edit them again.';
  end if;

  foreach row_unit in array units loop
    if not public.can_write_section(section, row_org, row_unit) then
      raise exception 'you do not have edit access to %',
        section_name
        || case when row_unit is not null
                then ' for ' || coalesce((select b.name from public.business_units b
                                           where b.id = row_unit), 'that unit')
                else '' end
        using hint = 'Ask an administrator for edit rights to this section.';
    end if;
  end loop;
  return coalesce(new, old);
end;
$$;
