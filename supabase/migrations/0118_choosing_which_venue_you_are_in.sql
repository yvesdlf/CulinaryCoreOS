-- ---------------------------------------------------------------------------
-- Choosing which venue you are in
-- ---------------------------------------------------------------------------
-- `auth_default_org_id()` picks a venue for somebody who belongs to more than
-- one, and it picks well: an organisation they were invited into comes before
-- one they created at sign-up, and one with colleagues in it before a
-- personal one of one. For the common case — a chef invited to a restaurant
-- who also has an empty organisation from signing up — that is the right
-- answer and needs no screen.
--
-- Somebody genuinely working at two venues has no way to say which. The
-- function picks, consistently, and they get the other one.
--
-- The important thing about this migration is where the choice is read.
-- `auth_default_org_id()` is not a convenience for the UI: `set_org_id()`
-- stamps new rows with it, so it decides which venue a stocktake, a
-- requisition or a punch belongs to. A switcher implemented in the client —
-- a dropdown filtering what is displayed — would leave every write still
-- landing in the venue the database chose. The choice has to be the same one
-- the trigger reads, which means it lives here.
--
-- Two rules that the obvious implementation gets wrong:
--
--   The preference is checked against membership every time it is read, not
--   only when it is set. Somebody removed from a venue they had selected
--   would otherwise keep writing into it — the row survives the membership
--   that justified it, and a stale pointer into an organisation is the worst
--   possible shape for one.
--
--   A preference naming a venue they are no longer in falls back to the
--   existing order rather than failing. Signing in to find the application
--   refuses to load, because of a venue you were removed from last week, is
--   not a safer outcome than being shown the venue you still work at.
-- ---------------------------------------------------------------------------

create table if not exists member_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,

  /*
   * Deliberately no foreign key to `organizations`.
   *
   * `on delete cascade` would silently drop the row when a venue is deleted
   * and `on delete restrict` would stop the venue being deleted at all. The
   * membership check below makes the reference safe without either, and a
   * dangling id simply reads as "no preference", which is what it means.
   */
  active_org_id uuid,

  updated_at timestamptz not null default now()
);

alter table member_preferences enable row level security;

/*
 * Your own row and nobody else's, in both directions.
 *
 * There is no section grant involved and there should not be: which venue a
 * person is looking at is their own business, not an administrative
 * privilege, and a venue owner has no reason to set it for them.
 */
drop policy if exists member_preferences_own on member_preferences;
create policy member_preferences_own on member_preferences for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists member_preferences_own_write on member_preferences;
create policy member_preferences_own_write on member_preferences for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on member_preferences to authenticated;

/*
 * The chosen venue, if it is still theirs.
 *
 * The membership check is the whole point. Setting the preference validates
 * too, but that validation is worth nothing a week later: memberships are
 * revoked and this row is not. Reading it through a join means a revoked
 * member falls back the moment they are revoked, with no cleanup job and no
 * window.
 */
create or replace function public.auth_default_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.active_org_id
       from public.member_preferences p
       join public.organization_members m
         on m.organization_id = p.active_org_id
        and m.user_id = p.user_id
      where p.user_id = (select auth.uid())),

    -- Unchanged: what somebody who has never chosen has always been given.
    (select m.organization_id
       from public.organization_members m
      where m.user_id = (select auth.uid())
      order by
        (exists (
          select 1 from public.organization_invitations i
           where i.organization_id = m.organization_id
             and i.accepted_by = m.user_id
        )) desc,
        (select count(*) from public.organization_members m2
          where m2.organization_id = m.organization_id) desc,
        m.created_at
      limit 1)
  );
$$;

/*
 * Choose one.
 *
 * Refuses a venue the caller is not a member of rather than storing it and
 * letting the read-time check quietly ignore it. Both behaviours are safe;
 * only one of them tells somebody their click did nothing.
 *
 * Passing null clears the choice and returns them to the default order,
 * which is how somebody undoes a switch without needing to know what the
 * default was.
 */
create or replace function public.set_active_org(p_org uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org is not null and not exists (
    select 1 from public.organization_members m
     where m.user_id = (select auth.uid())
       and m.organization_id = p_org
  ) then
    raise exception 'you are not a member of that venue' using errcode = '42501';
  end if;

  insert into public.member_preferences (user_id, active_org_id)
  values ((select auth.uid()), p_org)
  on conflict (user_id) do update
    set active_org_id = excluded.active_org_id,
        updated_at = now();

  return public.auth_default_org_id();
end $$;

revoke all on function public.set_active_org(uuid) from public, anon;
grant execute on function public.set_active_org(uuid) to authenticated;

/*
 * The venues somebody can switch between, with the active one marked.
 *
 * A view rather than a client-side join so the screen and the triggers agree
 * about which one is active — the alternative is a dropdown whose highlighted
 * row is computed from different logic than the writes.
 */
create or replace view my_venues
with (security_invoker = true) as
  select
    o.id            as org_id,
    o.name,
    m.role,
    (o.id = public.auth_default_org_id()) as is_active,
    (select count(*) from public.organization_members m2
      where m2.organization_id = o.id)    as members
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
 where m.user_id = (select auth.uid());

grant select on my_venues to authenticated;

comment on table member_preferences is
  'Which venue somebody is working in. Validated against membership every time it is read, not only when set — a revoked member must not keep writing into the venue they chose. See 0118.';
comment on function public.set_active_org(uuid) is
  'Refuses a venue the caller is not in. Null clears the choice and returns them to the default order.';
