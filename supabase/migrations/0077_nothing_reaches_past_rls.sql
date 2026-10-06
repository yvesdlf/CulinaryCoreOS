-- ---------------------------------------------------------------------------
-- 0077 · Nothing callable reaches past row-level security
-- ---------------------------------------------------------------------------
-- Every table has RLS, and that statement was true and not enough. Two kinds
-- of object read as their owner instead of the caller and are reachable over
-- the REST API by name: SECURITY DEFINER functions and views without
-- `security_invoker`. A review before deployment found:
--
--   * Every function in `public` still carried Postgres's default EXECUTE to
--     PUBLIC, so the anon key — public by design — could call any of them.
--     Among the definer ones: `notify`, which queues a message into any
--     venue's email and WhatsApp channels with whatever subject and body the
--     caller writes; thirteen `seed_*` functions that write defaults into any
--     venue, five of them not idempotently; `pour_variance`, which returned
--     every venue's bar costs; `escalation_chain`, managers' emails.
--   * `next_reference_stem` drew from any venue's document sequence, and
--     `contract_price_for` answered for any venue's contracts, given UUIDs.
--   * `refresh_contract_statuses` rewrote every venue's contracts.
--   * Five definer views with no tenant filter. A signed-in user belonging to
--     no venue at all read the whole demo catalogue out of `product_stock`,
--     and `venue_calendar` and `attendance` give names, birthdays, leave and
--     hours on the same terms once there is data in them.
--
-- `supabase/tests/23_exposure.sql` checks the catalogue rather than the list
-- above, so a function or view added later fails there the day it is written.
-- ---------------------------------------------------------------------------

-- 1 · Nobody executes anything without signing in ---------------------------

/*
 * Grant to `authenticated` first, explicitly, whatever PUBLIC could run — so
 * removing PUBLIC changes nothing for a signed-in user — then take PUBLIC
 * away. Functions that were already restricted (the outbox drain, the
 * scheduler's jobs) never had PUBLIC and are not touched, which is why this
 * is not a blanket grant.
 */
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and exists (select 1
                     from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                    where a.grantee = 0 and a.privilege_type = 'EXECUTE')
  loop
    execute format('grant execute on function %s to authenticated, service_role', f);
    execute format('revoke execute on function %s from public', f);
  end loop;
end $$;

revoke execute on all functions in schema public from anon;

/*
 * What the next function gets. Two lines because they are two defaults:
 * Postgres's own, database-wide, gives PUBLIC execute on every new function,
 * and a per-schema rule can only add to that, never take from it; Supabase's
 * per-schema rule for `public` adds anon. Missing the first is how a fix like
 * this one passes its own checks and lets the next function through.
 */
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon;
alter default privileges for role postgres in schema public
  grant execute on functions to authenticated, service_role;

-- 2 · Internal machinery is not an API --------------------------------------

/*
 * Called by triggers and the scheduler. Those are definer functions, so they
 * run as the owner and keep working without these grants; checked by finding
 * every caller in pg_proc before writing this.
 */
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and (p.proname = 'notify' or p.proname like 'seed\_%'
            or p.proname in ('escalation_chain', 'refresh_section_unit_scoping'))
  loop
    execute format('revoke execute on function %s from authenticated', f);
  end loop;
end $$;

-- 3 · Functions the screens call ask whose data it is ------------------------

-- Its sibling `production_variance` was always invoker-rights. This one read
-- across every venue because nothing told it otherwise.
alter function public.pour_variance(date, date) security invoker;

/*
 * Rewritten whole because a SQL function cannot be amended; the only change
 * is the `org_id` line. A stranger now gets null — the same answer as "no
 * contract", which tells them nothing.
 */
create or replace function public.contract_price_for(
  p_product uuid, p_supplier uuid, p_on date default current_date)
returns numeric
language sql stable security definer
set search_path = ''
as $$
  select cp.unit_price
  from public.contract_prices cp
  join public.contracts c on c.id = cp.contract_id
  where cp.product_id = p_product
    and c.supplier_id = p_supplier
    and c.org_id in (select public.auth_org_ids())
    and c.status in ('ACTIVE', 'EXPIRING')
    and p_on between cp.effective_from and coalesce(cp.effective_to, 'infinity'::date)
    and p_on >= c.starts_on
    and p_on <= coalesce(c.ends_on, 'infinity'::date)
  order by cp.effective_from desc
  limit 1;
$$;

/*
 * Called from the contracts screen when it opens. It now refreshes the
 * caller's venues only; nothing else ever called it, so nothing else is
 * waiting on the venues it no longer touches.
 */
create or replace function public.refresh_contract_statuses()
returns void
language sql security definer
set search_path = ''
as $$
  update public.contracts
     set status = case
           when ends_on is null then 'ACTIVE'::public.contract_status
           when ends_on < current_date then 'EXPIRED'::public.contract_status
           when ends_on <= current_date + 60 then 'EXPIRING'::public.contract_status
           else 'ACTIVE'::public.contract_status
         end,
         updated_at = now()
   where status in ('ACTIVE', 'EXPIRING', 'EXPIRED')
     and org_id in (select public.auth_org_ids());
$$;

/*
 * Two kinds of caller. The screen, directly, for its own venue. And four
 * reference triggers, for the row being written — including a supplier
 * sending an invoice through the portal, who is not a member of the venue
 * and must still get a number. `pg_trigger_depth()` tells them apart: zero
 * means nobody but the caller asked. A caller with no `auth.uid()` is the
 * service role or the database itself — anon can no longer reach it at all.
 */
create or replace function public.next_reference_stem(p_unit text, p_org uuid default null)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  target_org uuid := coalesce(p_org, public.auth_default_org_id());
  code text := public.unit_code(p_unit);
  seq integer;
begin
  if target_org is null then
    raise exception 'no organization for the current user';
  end if;

  if pg_trigger_depth() = 0
     and auth.uid() is not null
     and target_org not in (select public.auth_org_ids()) then
    raise exception 'not a member of that organization'
      using errcode = '42501';
  end if;

  insert into public.document_sequences (org_id, doc_type, unit_code, day, last_seq)
  values (target_org, public.purchasing_sequence_key(), code, current_date, 1)
  on conflict (org_id, doc_type, unit_code, day)
  do update set last_seq = public.document_sequences.last_seq + 1
  returning last_seq into seq;

  return code || '-' || to_char(current_date, 'YYMMDD') || '-' ||
         lpad(seq::text, 3, '0');
end;
$$;

-- 4 · Views read as the caller, or say whose rows they return ---------------

/*
 * Each of these sits on tables whose RLS already says the right thing, so
 * reading as the caller is the whole fix.
 */
alter view public.product_stock                set (security_invoker = true);
alter view public.attendance                   set (security_invoker = true);
alter view public.production_usage_theoretical set (security_invoker = true);

/*
 * The calendar stays definer: a staff-portal user is not a member of the
 * venue (AGENTS.md §7), cannot read `employees`, and is still meant to see
 * the venue's holidays and colleagues' birthdays. So it names its audience —
 * members, or the venue the portal user works at — instead of borrowing the
 * tables'. What it shows (birthdays on by default, the leave type) is a
 * separate question, settled in a later migration.
 */
create or replace view public.venue_calendar as
select v.*
  from (
    select h.org_id,
           'HOLIDAY'::text as kind,
           h.holiday_on as on_date,
           h.name as title,
           case when h.closed then 'Venue closed'::text else 'Trading'::text end as detail,
           null::uuid as employee_id
      from public.public_holidays h
    union all
    select e.org_id,
           'BIRTHDAY'::text,
           make_date(extract(year from current_date)::integer,
                     extract(month from e.date_of_birth)::integer,
                     extract(day from e.date_of_birth)::integer),
           e.first_name || ' ' || e.last_name,
           coalesce(b.name, ''),
           e.id
      from public.employees e
      left join public.business_units b on b.id = e.business_unit_id
     where e.date_of_birth is not null
       and e.birthday_visible
       and e.employment_status in ('PROBATION', 'ACTIVE', 'NOTICE')
    union all
    select l.org_id,
           'LEAVE'::text,
           l.starts_on,
           e.first_name || ' ' || e.last_name,
           t.name,
           e.id
      from public.leave_requests l
      join public.employees e on e.id = l.employee_id
      join public.leave_types t on t.id = l.leave_type_id
     where l.status in ('APPROVED', 'TAKEN')
  ) v
 where v.org_id in (select public.auth_org_ids())
    or v.org_id = public.auth_employee_org();

/*
 * The scheduler's own list. Nothing on a screen reads it, and `cron.job` is
 * where a job with a key written inline would one day end up.
 */
revoke select on public.scheduled_jobs from anon, authenticated;

-- 5 · The one table without RLS ----------------------------------------------

-- Reference data: the list of sections, identical for everybody. `true` is
-- deliberate here and nowhere else.
alter table public.app_sections enable row level security;
create policy app_sections_read on public.app_sections
  for select to authenticated using (true);
