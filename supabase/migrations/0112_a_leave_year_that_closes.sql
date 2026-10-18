-- ---------------------------------------------------------------------------
-- A leave year that closes
-- ---------------------------------------------------------------------------
-- `leave_types.max_carryover_days` has existed since the HR tables were
-- written and nothing has ever read it. Balances are computed from the
-- current year's requests alone, so on the first of January everybody's
-- unused days vanish — which is both wrong and, in most of Europe, unlawful.
--
-- Carry-over is stored rather than computed, and that is the whole design.
-- The cap is applied once, on a day, under a policy that was in force then;
-- recomputing it next March against a `max_carryover_days` somebody has since
-- changed would quietly rewrite what people were told they had. It also ends
-- up in pay when somebody leaves, and AGENTS.md §4 is about figures that
-- become money.
--
-- Three decisions worth stating, because each could reasonably go the other
-- way:
--
--   A null `max_carryover_days` means **none carries over**, not "unlimited".
--   The column is not configured on most types, and a null that silently
--   meant unlimited would hand every employee their entire unused balance the
--   first time a venue closed a year. The strict reading is recoverable — a
--   venue sets a number and closes again; the generous one is not, because by
--   then people have booked the holiday.
--
--   A year with requests still pending **cannot be closed**. Closing around
--   them would either lose the days or inflate what carries over, and both
--   are discovered in December when they cannot be fixed. The refusal names
--   how many are outstanding.
--
--   Carried days **expire**. A balance that rolls forever is not a carry-over
--   policy, it is an unfunded liability that grows — and the statutory
--   schemes this follows all put a date on it. The default is three months
--   into the new year, as a venue parameter.
-- ---------------------------------------------------------------------------

create or replace function public.seed_leave_carryover_parameter(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.venue_parameters
    (org_id, code, name, description, value, unit, min_value, max_value)
  values (p_org, 'CARRYOVER_EXPIRES_MONTHS', 'Carried leave expires after',
          'How long into the new year carried days last. A balance that rolls forever is not a policy, it is a liability that grows.',
          3, 'months', 0, 24)
  on conflict (org_id, code) do nothing;
end $$;

revoke all on function public.seed_leave_carryover_parameter(uuid)
  from public, anon, authenticated;

insert into public.organization_seeders (ordinal, function_name, note)
select coalesce(max(ordinal), 0) + 1, 'seed_leave_carryover_parameter',
       'How long carried leave lasts into the new year (0112)'
  from public.organization_seeders
on conflict (function_name) do nothing;

do $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.seed_leave_carryover_parameter(o.id);
  end loop;
end $$;

create table if not exists leave_carryover (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  leave_type_id uuid not null references leave_types(id) on delete restrict,

  year_starts_on date not null,
  year_ends_on date not null,

  /* The working, kept so the figure can be argued with rather than trusted. */
  entitlement_days numeric(6,2) not null,
  carried_in_days numeric(6,2) not null default 0,
  taken_days numeric(6,2) not null,
  unused_days numeric(6,2) not null,
  cap_days numeric(6,2),
  carried_days numeric(6,2) not null,
  expires_on date,

  closed_at timestamptz not null default now(),
  closed_by_email text,

  constraint leave_carryover_once
    unique (employee_id, leave_type_id, year_starts_on, year_ends_on),
  constraint leave_carryover_order check (year_ends_on > year_starts_on),
  constraint leave_carryover_not_negative check (carried_days >= 0)
);

create index if not exists idx_leave_carryover_employee
  on leave_carryover(org_id, employee_id, leave_type_id);

drop trigger if exists leave_carryover_set_org on leave_carryover;
create trigger leave_carryover_set_org before insert on leave_carryover
  for each row execute function public.set_org_id();

/*
 * Close a leave year.
 *
 * Returns how many carry-over rows were written. Zero is a real answer —
 * nobody had anything left, or no type permits it — and is not the same as
 * a failure, which raises.
 */
create or replace function public.close_leave_year(
  p_org uuid, p_from date, p_to date
)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  pending integer;
  expires date;
  months integer;
  n integer := 0;
begin
  if not public.can_write_section('PEOPLE', p_org) then
    raise exception 'you do not have edit access to People' using errcode = '42501';
  end if;

  if p_to <= p_from then
    raise exception 'a leave year ends after it starts';
  end if;

  /*
   * Pending requests first, and this is a refusal rather than a warning.
   * Closing around a request nobody has decided either loses the days or
   * carries them over as though they were never going to be taken — and
   * whichever it is, it is found in December.
   */
  select count(*) into pending
    from public.leave_requests r
   where r.org_id = p_org
     and r.status in ('DRAFT', 'REQUESTED')
     and r.starts_on between p_from and p_to;

  if pending > 0 then
    raise exception
      'cannot close the leave year: % request(s) in it are still undecided',
      pending
      using hint = 'Approve or reject them first. Closing around them would lose the days or carry them over as if they were never going to be taken.';
  end if;

  select coalesce(value, 3)::int into months
    from public.venue_parameters
   where org_id = p_org and code = 'CARRYOVER_EXPIRES_MONTHS';
  months := coalesce(months, 3);
  expires := case when months > 0
                  then (p_to + 1) + (months || ' months')::interval
             end::date;

  insert into public.leave_carryover
    (org_id, employee_id, leave_type_id, year_starts_on, year_ends_on,
     entitlement_days, carried_in_days, taken_days, unused_days,
     cap_days, carried_days, expires_on, closed_by_email)
  select
    p_org,
    e.id,
    lt.id,
    p_from,
    p_to,
    lt.annual_entitlement_days,
    coalesce(prior.carried_days, 0),
    coalesce(used.days, 0),
    greatest(lt.annual_entitlement_days + coalesce(prior.carried_days, 0)
             - coalesce(used.days, 0), 0),
    lt.max_carryover_days,
    /*
     * A null cap carries nothing. See the header: a null that meant
     * "unlimited" would hand everybody their whole balance the first time
     * anybody closed a year, and that is not recoverable once people have
     * booked against it.
     */
    least(
      greatest(lt.annual_entitlement_days + coalesce(prior.carried_days, 0)
               - coalesce(used.days, 0), 0),
      coalesce(lt.max_carryover_days, 0)
    ),
    expires,
    auth.jwt() ->> 'email'
  from public.employees e
  cross join public.leave_types lt
  left join lateral (
    select sum(r.days) as days
      from public.leave_requests r
     where r.employee_id = e.id
       and r.leave_type_id = lt.id
       and r.status in ('APPROVED', 'TAKEN')
       and r.starts_on between p_from and p_to
  ) used on true
  left join lateral (
    select c.carried_days
      from public.leave_carryover c
     where c.employee_id = e.id
       and c.leave_type_id = lt.id
       and c.year_ends_on < p_from
     order by c.year_ends_on desc
     limit 1
  ) prior on true
  where e.org_id = p_org
    and lt.org_id = p_org
    -- Nothing to run down, so nothing to carry. Sick and unpaid leave have
    -- no annual allowance and a "carried sick days" figure would read as an
    -- allowance to spend.
    and lt.annual_entitlement_days is not null
  on conflict (employee_id, leave_type_id, year_starts_on, year_ends_on)
  do nothing;

  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.close_leave_year(uuid, date, date) from public;
grant execute on function public.close_leave_year(uuid, date, date) to authenticated;

/*
 * What somebody is entitled to now: this year's allowance plus whatever
 * carried in and has not yet expired.
 *
 * Expiry is applied here rather than by deleting the row, because the row is
 * the record of what was decided at close. A balance that silently stopped
 * existing would leave nothing to explain why somebody's figure dropped.
 */
-- Dropped first, not replaced: `create or replace view` refuses a column
-- type change, and `carried_in_now` carries a cast. 0111 learned this the
-- expensive way, inside a script whose output nobody was reading.
drop view if exists leave_entitlement_now;

create view leave_entitlement_now
with (security_invoker = true) as
  select
    c.org_id,
    c.employee_id,
    c.leave_type_id,
    lt.name                  as leave_type_name,
    c.year_starts_on,
    c.year_ends_on,
    c.carried_days,
    c.expires_on,
    (c.expires_on is not null and c.expires_on < current_date) as expired,
    -- Cast, so a lapsed balance prints `0.00` beside the `5.00` above it
    -- rather than a bare `0`. Two scales in one column of a report read as
    -- two different kinds of figure.
    (case when c.expires_on is null or c.expires_on >= current_date
          then c.carried_days else 0 end)::numeric(6,2)         as carried_in_now
  from public.leave_carryover c
  join public.leave_types lt on lt.id = c.leave_type_id;

grant select on leave_entitlement_now to authenticated;

alter table leave_carryover enable row level security;

drop policy if exists leave_carryover_read on leave_carryover;
create policy leave_carryover_read on leave_carryover for select to authenticated
  using (public.can_read_section('PEOPLE', org_id));

/*
 * Own-row access for the staff portal, keyed on `auth_employee_id()` like
 * every other portal door since 0056. A commis chef is not a member of the
 * venue (AGENTS.md §7), so without this they read nothing — including their
 * own carried days, which is the figure they most want.
 */
drop policy if exists leave_carryover_own on leave_carryover;
create policy leave_carryover_own on leave_carryover for select to authenticated
  using (employee_id = public.auth_employee_id());

drop policy if exists leave_carryover_write on leave_carryover;
create policy leave_carryover_write on leave_carryover for all to authenticated
  using (public.auth_can_write(org_id)
         and public.can_read_section('PEOPLE', org_id))
  with check (public.auth_can_write(org_id));

grant select on leave_carryover to authenticated;

drop trigger if exists leave_carryover_section_guard on leave_carryover;
create trigger leave_carryover_section_guard
  before insert or update or delete on leave_carryover
  for each row execute function public.require_section_write('PEOPLE');

delete from public.section_read_rules where table_name = 'leave_carryover';
insert into public.section_read_rules (table_name, section_code)
values ('leave_carryover', 'PEOPLE');

comment on table leave_carryover is
  'What carried from one leave year into the next, with the working kept. Stored rather than recomputed: the cap was applied under a policy in force on the day, and the figure ends up in pay. See 0112.';
comment on function public.close_leave_year(uuid, date, date) is
  'Refuses while any request in the year is undecided. Closing around one either loses the days or carries them as though they were never going to be taken.';
