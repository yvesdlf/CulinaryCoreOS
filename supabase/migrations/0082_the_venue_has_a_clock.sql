-- ---------------------------------------------------------------------------
-- 0082 · The venue has a clock
-- ---------------------------------------------------------------------------
-- "Today" was the UTC date everywhere: in twelve views (the HACCP, maintenance
-- and housekeeping boards, the overview, the calendar, the hygiene and unit
-- summaries), in fourteen functions, and on the screens. For a venue in Bali
-- the business day turned over at eight in the morning; a fridge check done at
-- seven counted for yesterday, and a takings figure entered after service went
-- to tomorrow.
--
-- Rather than thread a time zone through every one of those, the session is
-- put in the venue's time zone at the start of each API request.
-- `current_date`, `now()::date` and date casts of `timestamptz` all follow the
-- session's TimeZone setting, so every view and function that already says
-- "today" now means the venue's today, and one written next year will too.
-- Stored timestamps are unchanged: `timestamptz` is an instant, and only its
-- reading as a day moves.
--
-- The scheduler has no request and no venue, and keeps UTC; its jobs compare
-- instants, not days.
-- ---------------------------------------------------------------------------

alter table public.organizations add column timezone text not null default 'UTC';

/*
 * A name Postgres knows, checked by trigger because a CHECK constraint cannot
 * read `pg_timezone_names`. A typo here would otherwise fail every request the
 * venue makes, from the first one after it was saved.
 */
create or replace function public.check_organization_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception '% is not a time zone Postgres knows; use a name such as Asia/Makassar or Europe/Lisbon',
      new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger organizations_check_timezone
  before insert or update of timezone on public.organizations
  for each row execute function public.check_organization_timezone();

/*
 * The time zone of the venue the caller works in. Definer because a staff
 * portal user is not a member (AGENTS.md §7) and cannot read `organizations`,
 * and their rota needs the venue's day as much as anybody's. A time zone is
 * not a secret.
 */
create or replace function public.venue_timezone()
returns text
language sql stable security definer
set search_path = ''
as $$
  select o.timezone
    from public.organizations o
   where o.id = coalesce(public.auth_default_org_id(), public.auth_employee_org());
$$;

/*
 * Run by PostgREST before every request. Invoker-rights and granted to anon,
 * because PostgREST runs it as whatever role the request has, including the
 * signed-out one; it returns at once for a caller with no user, and never
 * reaches the definer function above in that case.
 */
create or replace function public.apply_venue_timezone()
returns void
language plpgsql
set search_path = ''
as $$
declare tz text;
begin
  if auth.uid() is null then
    return;
  end if;
  tz := public.venue_timezone();
  if tz is not null then
    perform set_config('timezone', tz, true);
  end if;
end;
$$;

grant execute on function public.apply_venue_timezone() to anon, authenticated;

alter role authenticator set pgrst.db_pre_request = 'public.apply_venue_timezone';
notify pgrst, 'reload config';
