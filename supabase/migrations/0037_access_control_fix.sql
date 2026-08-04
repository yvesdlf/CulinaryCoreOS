-- ---------------------------------------------------------------------------
-- Scope the section grant to an organisation
-- ---------------------------------------------------------------------------
-- 0036 shipped an access model that granted everything to everybody. The
-- ownership shortcut read:
--
--   select 'WRITE' from organization_members
--    where user_id = auth.uid() and role = 'OWNER'
--
-- with no organisation in the WHERE clause. Sign-up creates an organisation
-- and makes the new user its owner, so *every* user is an owner of something —
-- their own personal organisation, usually empty. The check therefore passed
-- for everyone, and a person granted READ on Recipes could edit them.
--
-- Tested rather than assumed: a member with WRITE on People, READ on Recipes
-- and no grant at all on Purchasing could write to all three.
--
-- This is the same mistake as the one 0025 fixed — treating a membership as
-- singular when a user can hold several — and it is worth naming as a class.
-- A permission question is never "is this person an owner", it is "is this
-- person an owner *here*". Any check on organization_members that does not
-- name an organisation is wrong.
--
-- So the level now takes the organisation it is being asked about, and the
-- trigger passes the organisation of the row being written. A grant in one
-- venue says nothing about another.
--
-- Second half of this migration: 0036 left member_access empty, which meant
-- everyone except an owner had NONE everywhere and the application was
-- effectively bricked for them. Existing members are seeded with the access
-- their role already implied, so nothing that worked yesterday stops working.
-- The seed is a starting point for the administrator to narrow, not a policy.
-- ---------------------------------------------------------------------------

drop function if exists public.can_write_section(text);
drop function if exists public.can_read_section(text);
drop function if exists public.auth_section_level(text);

/*
 * What access this user has to a section of one organisation.
 *
 * An owner of *that* organisation has everything: somebody has to be able to
 * grant the first rights, and the last owner cannot be demoted, so no
 * organisation can lock itself out of its own administration screen.
 *
 * Everyone else holds exactly what they were granted, and nothing by default.
 */
create or replace function public.auth_section_level(p_section text, p_org uuid)
returns public.access_level
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select 'WRITE'::public.access_level
       from public.organization_members m
      where m.user_id = (select auth.uid())
        and m.organization_id = p_org
        and m.role = 'OWNER'
      limit 1),
    (select a.level
       from public.member_access a
      where a.user_id = (select auth.uid())
        and a.section_code = p_section
        and a.org_id = p_org
      limit 1),
    'NONE'::public.access_level
  );
$$;

-- The one-argument form asks about the organisation the caller is working in.
-- Screens use this; the trigger below does not, because a row knows its own
-- organisation and that is the one that must be checked.
create or replace function public.auth_section_level(p_section text)
returns public.access_level
language sql
stable
security definer
set search_path = ''
as $$
  select public.auth_section_level(p_section, public.auth_default_org_id());
$$;

create or replace function public.can_write_section(p_section text, p_org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.auth_section_level(p_section, p_org) = 'WRITE'; $$;

create or replace function public.can_write_section(p_section text)
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.auth_section_level(p_section, public.auth_default_org_id()) = 'WRITE'; $$;

create or replace function public.can_read_section(p_section text, p_org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.auth_section_level(p_section, p_org) <> 'NONE'; $$;

create or replace function public.can_read_section(p_section text)
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.auth_section_level(p_section, public.auth_default_org_id()) <> 'NONE'; $$;

grant execute on function public.auth_section_level(text, uuid) to authenticated;
grant execute on function public.auth_section_level(text) to authenticated;
grant execute on function public.can_write_section(text, uuid) to authenticated;
grant execute on function public.can_write_section(text) to authenticated;
grant execute on function public.can_read_section(text, uuid) to authenticated;
grant execute on function public.can_read_section(text) to authenticated;

/*
 * The guard, now asking about the right organisation.
 *
 * The row carries org_id — every table this trigger is attached to has one —
 * so the question is asked of the organisation being written to rather than of
 * whichever organisation the caller happens to default to. Otherwise someone
 * with rights at one venue could write to another.
 */
create or replace function public.require_section_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  section text := tg_argv[0];
  row_org uuid;
begin
  -- No session means a cascade, a migration, or an administrator with direct
  -- database access; the same reasoning as the membership guard.
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  row_org := coalesce(
    (to_jsonb(new) ->> 'org_id')::uuid,
    (to_jsonb(old) ->> 'org_id')::uuid,
    public.auth_default_org_id());

  if not public.can_write_section(section, row_org) then
    raise exception 'you do not have edit access to %',
      coalesce((select s.name from public.app_sections s where s.code = section), section)
      using hint = 'Ask an administrator for edit rights to this section.';
  end if;
  return coalesce(new, old);
end;
$$;

-- ── Keep everyone working ───────────────────────────────────────────────────
/*
 * Seed the grid from the roles that already exist.
 *
 * Before 0036 the rule was coarse: OWNER, ADMIN and CHEF could write
 * everything, VIEWER could read it. Introducing a finer model must not silently
 * revoke access from people who had it, so each existing member is given the
 * equivalent of what their role already allowed.
 *
 * Two deliberate narrowings, because they are the point of the exercise:
 * a chef does not get Parameters — the money settings — beyond reading them,
 * and only owners and administrators get the Administration section. Both are
 * grants an administrator can restore in one click if a venue disagrees.
 */
do $$
declare
  m record;
  s record;
  lvl public.access_level;
begin
  for m in
    select om.organization_id, om.user_id, om.role
      from public.organization_members om
  loop
    for s in select code from public.app_sections loop
      lvl := case
        when m.role in ('OWNER', 'ADMIN') then 'WRITE'::public.access_level
        when m.role = 'CHEF' then
          case
            when s.code = 'ADMIN' then 'NONE'::public.access_level
            when s.code = 'PARAMETERS' then 'READ'::public.access_level
            else 'WRITE'::public.access_level
          end
        else
          -- A viewer reads the operation but not its people problems.
          case
            when s.code in ('ADMIN', 'HR_CASES') then 'NONE'::public.access_level
            else 'READ'::public.access_level
          end
      end;

      if lvl <> 'NONE' then
        insert into public.member_access (org_id, user_id, section_code, level)
        values (m.organization_id, m.user_id, s.code, lvl)
        on conflict (org_id, user_id, section_code) do nothing;
      end if;
    end loop;
  end loop;
end $$;

/*
 * And for everyone who joins later.
 *
 * A membership with no grants is an account that can sign in and do nothing,
 * which reads as a broken application rather than as a security posture. New
 * members start with their role's equivalent and an administrator narrows it.
 * Owners are skipped: their access is implicit and rows would only confuse the
 * grid.
 */
create or replace function public.seed_member_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  lvl public.access_level;
begin
  if new.role = 'OWNER' then
    return new;
  end if;

  for s in select code from public.app_sections loop
    lvl := case
      when new.role = 'ADMIN' then 'WRITE'::public.access_level
      when new.role = 'CHEF' then
        case
          when s.code = 'ADMIN' then 'NONE'::public.access_level
          when s.code = 'PARAMETERS' then 'READ'::public.access_level
          else 'WRITE'::public.access_level
        end
      else
        case
          when s.code in ('ADMIN', 'HR_CASES') then 'NONE'::public.access_level
          else 'READ'::public.access_level
        end
    end;

    if lvl <> 'NONE' then
      insert into public.member_access (org_id, user_id, section_code, level)
      values (new.organization_id, new.user_id, s.code, lvl)
      on conflict (org_id, user_id, section_code) do nothing;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists organization_members_seed_access on organization_members;
create trigger organization_members_seed_access
  after insert on organization_members
  for each row execute function public.seed_member_access();

-- ── The same mistake, in the hiring guard ───────────────────────────────────
/*
 * enforce_hiring_approval() had the identical hole twice over: its two
 * fallbacks asked whether the caller is an OWNER of *anything*, so any signed-in
 * user — owner of their own empty personal organisation — satisfied it and
 * could approve a hire for a department they have nothing to do with. The
 * routing that is the whole point of the feature was advisory.
 *
 * Rewritten to ask about the organisation the request belongs to. Nothing else
 * about the rule changes: the named approver or their deputy decides, an owner
 * of that venue can step in when an approver has left, and nobody approves
 * their own request.
 */
create or replace function public.enforce_hiring_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  approver text;
  deputy text;
  caller text;
  dept_name text;
  is_owner_here boolean;
begin
  if new.status not in ('APPROVED', 'REJECTED') then
    return new;
  end if;

  caller := lower(coalesce(auth.jwt() ->> 'email', coalesce(new.decided_by_email, '')));
  if caller = '' then
    raise exception 'a hiring decision must record who made it';
  end if;

  if lower(coalesce(new.requested_by_email, '')) = caller then
    raise exception 'you cannot approve a hire you asked for'
      using hint = 'Segregation of duties: ask the department approver.';
  end if;

  select lower(a.approver_email), lower(coalesce(a.deputy_email, '')), d.name
    into approver, deputy, dept_name
    from public.department_approvers a
    join public.departments d on d.id = a.department_id
   where a.department_id = new.department_id;

  -- An owner *of this venue*. Ownership elsewhere is not authority here.
  is_owner_here := exists (
    select 1 from public.organization_members m
     where m.user_id = auth.uid()
       and m.organization_id = new.org_id
       and m.role = 'OWNER');

  if approver is null then
    if not is_owner_here then
      raise exception 'no approver is set for that department'
        using hint = 'Set one in Administration before hiring for it.';
    end if;
  elsif caller <> approver and caller <> deputy and not is_owner_here then
    raise exception 'only % can approve a hire for %', approver, dept_name
      using hint = 'Hiring is approved by the department that pays for it.';
  end if;

  new.decided_by_email := coalesce(new.decided_by_email, caller);
  if new.decided_at is null then new.decided_at := now(); end if;
  return new;
end;
$$;

comment on function public.auth_section_level(text, uuid) is
  'Access this user holds to a section of one organization. Always ask with the organization.';
