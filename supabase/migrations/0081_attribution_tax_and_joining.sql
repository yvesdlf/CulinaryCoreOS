-- ---------------------------------------------------------------------------
-- 0081 · The database says who did it; tax is the owner's; a sick note is
--        filed under its own venue; and an invitation can be accepted
-- ---------------------------------------------------------------------------
-- The remaining findings of the review before deployment, plus one defect it
-- suspected and the suite confirmed.
--
-- * Five logs took "who did this" from whatever the client sent: a chef could
--   record a recipe approval as the owner's. 0054 fixed this for approvals;
--   these were missed. One trigger now stamps them all.
-- * `organizations` carries the VAT and service-charge rates 0036 calls
--   protected parameters. Any CHEF could change them, and nothing logged it.
-- * The sick-notes bucket checked that a file sat under the uploader's own
--   employee id, but not under their own venue, so a note could be dropped
--   into another venue's People folder.
-- * `accept_invitation` inserted the membership as the invitee, and the
--   membership guard refused any insert by a non-member into a venue that
--   already had members. Joining a venue by invitation has never worked.
--
-- Tests: supabase/tests/27_attribution_and_joining.sql.
-- ---------------------------------------------------------------------------

-- 1 · Attribution ---------------------------------------------------------------

/*
 * Arguments: the column for the user id ('-' where the log has none), then
 * the column for the email. A session with no user — the scheduler, a
 * migration — keeps what it wrote, because there is nobody to stamp.
 */
create or replace function public.stamp_actor()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare patch jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_argv[0] <> '-' then
    patch := patch || jsonb_build_object(tg_argv[0], auth.uid());
  end if;
  patch := patch || jsonb_build_object(tg_argv[1], auth.jwt() ->> 'email');
  new := jsonb_populate_record(new, patch);
  return new;
end;
$$;

create trigger recipe_status_events_stamp_actor before insert on public.recipe_status_events
  for each row execute function public.stamp_actor('actor_id', 'actor_email');
create trigger stock_movements_stamp_actor before insert on public.stock_movements
  for each row execute function public.stamp_actor('actor_id', 'actor_email');
create trigger parameter_changes_stamp_actor before insert on public.parameter_changes
  for each row execute function public.stamp_actor('-', 'changed_by_email');
create trigger work_order_events_stamp_actor before insert on public.work_order_events
  for each row execute function public.stamp_actor('-', 'actor_email');
create trigger room_state_events_stamp_actor before insert on public.room_state_events
  for each row execute function public.stamp_actor('-', 'actor_email');

-- 2 · Tax rates ------------------------------------------------------------------

drop policy organizations_update on public.organizations;
create policy organizations_update on public.organizations
  for update to authenticated
  using (public.auth_is_admin(id)) with check (public.auth_is_admin(id));

/*
 * The protected columns need Parameters write as well as the role, and every
 * change goes on the same log venue parameters use. A cleared rate (null) is
 * not logged: the log's value is required, and a rate is cleared only by
 * somebody who could already set it.
 */
create or replace function public.guard_organization_rates()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  col text;
  before numeric;
  after numeric;
begin
  if (new.standard_vat_percent, new.reduced_vat_percent, new.service_charge_percent,
      new.prices_include_tax, new.currency_code)
     is not distinct from
     (old.standard_vat_percent, old.reduced_vat_percent, old.service_charge_percent,
      old.prices_include_tax, old.currency_code) then
    return new;
  end if;

  if auth.uid() is not null and not public.can_write_section('PARAMETERS', new.id) then
    raise exception 'changing tax, service charge or currency needs Parameters access'
      using errcode = '42501';
  end if;

  foreach col in array array['standard_vat_percent', 'reduced_vat_percent', 'service_charge_percent'] loop
    execute format('select ($1).%I::numeric, ($2).%I::numeric', col, col)
      into before, after using old, new;
    if after is distinct from before and after is not null then
      insert into public.parameter_changes (org_id, parameter_code, old_value, new_value)
      values (new.id, upper(col), before, after);
    end if;
  end loop;
  return new;
end;
$$;

create trigger organizations_guard_rates before update on public.organizations
  for each row execute function public.guard_organization_rates();

-- 3 · Sick notes under their own venue -----------------------------------------

alter policy sick_notes_write on storage.objects
  with check (bucket_id = 'sick-notes' and (
    (public.auth_employee_id()::text = split_part(name, '/', 2)
       and public.storage_path_org(name) = public.auth_employee_org())
    or public.can_write_section('PEOPLE', public.storage_path_org(name))));

alter policy sick_notes_read on storage.objects
  using (bucket_id = 'sick-notes' and (
    (public.auth_employee_id()::text = split_part(name, '/', 2)
       and public.storage_path_org(name) = public.auth_employee_org())
    or public.can_write_section('PEOPLE', public.storage_path_org(name))));

-- 4 · Joining by invitation ------------------------------------------------------

/*
 * Both rewritten whole because they are PL/pgSQL; the new lines are marked
 * by their comments. The setting is transaction-local and names one
 * invitation, which the guard re-checks against the row being inserted, so
 * it cannot be used to join anything else.
 */
create or replace function public.enforce_membership_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  actor_role public.org_role;
  target_org uuid;
  target_user uuid;
  new_role public.org_role;
  owner_count integer;
begin
  -- No session means no person: a cascade from auth.users, a migration, or a
  -- direct administrative statement. RLS already refuses anonymous API calls,
  -- so there is nothing here for the guard to protect against.
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  target_org  := coalesce(new.organization_id, old.organization_id);
  target_user := coalesce(new.user_id, old.user_id);
  new_role    := new.role;

  select m.role into actor_role
    from public.organization_members m
   where m.organization_id = target_org
     and m.user_id = auth.uid();

  if actor_role is null then
    if tg_op = 'INSERT'
       and not exists (select 1 from public.organization_members m2
                        where m2.organization_id = target_org)
    then
      return new;
    end if;
    -- Joining through an invitation (0081). accept_invitation names the one
    -- invitation it is honouring for this transaction; the row must be that
    -- invitation's venue and role, for the person it was sent to. Before
    -- this branch the guard refused every invitee, and no test noticed.
    if tg_op = 'INSERT'
       and target_user = auth.uid()
       and exists (select 1 from public.organization_invitations i
                    where i.id = nullif(current_setting('ccos.accepting_invitation', true), '')::uuid
                      and i.organization_id = target_org
                      and i.role = new_role
                      and i.accepted_at is null and i.revoked_at is null)
    then
      return new;
    end if;
    raise exception 'only a member of this organization can manage its membership';
  end if;

  if actor_role not in ('OWNER', 'ADMIN') then
    raise exception 'only owners and administrators can manage membership';
  end if;

  if target_user = auth.uid() and tg_op <> 'INSERT' then
    if tg_op = 'DELETE' then
      raise exception 'you cannot remove your own membership'
        using hint = 'Ask another owner to remove you.';
    end if;
    if old.role is distinct from new.role then
      raise exception 'you cannot change your own role'
        using hint = 'Ask another owner to change it.';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new_role = 'OWNER' and actor_role <> 'OWNER' then
    raise exception 'only an owner can make someone an owner';
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.role = 'OWNER' and actor_role <> 'OWNER' then
    raise exception 'only an owner can change or remove another owner';
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.role = 'OWNER' then
    select count(*) into owner_count
      from public.organization_members m3
     where m3.organization_id = target_org and m3.role = 'OWNER';
    if owner_count <= 1 and (tg_op = 'DELETE' or new_role <> 'OWNER') then
      raise exception 'this is the last owner of the organization'
        using hint = 'Make someone else an owner first.';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function public.accept_invitation(invitation_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  inv public.organization_invitations;
  caller_email text;
begin
  select lower(coalesce(auth.jwt() ->> 'email', '')) into caller_email;
  if caller_email = '' then
    raise exception 'not signed in';
  end if;

  -- The address on the session has to be one somebody proved (0078's rule
  -- for staff records, applied to joining a venue).
  if not exists (select 1 from auth.users u
                  where u.id = auth.uid() and u.email_confirmed_at is not null) then
    raise exception 'confirm your email address before accepting an invitation';
  end if;

  select * into inv from public.organization_invitations
   where id = invitation_id
     and lower(email) = caller_email
     and accepted_at is null
     and revoked_at is null
     and expires_at > now();

  if inv is null then
    raise exception 'this invitation is not available'
      using hint = 'It may have been used, revoked, or expired.';
  end if;

  perform set_config('ccos.accepting_invitation', inv.id::text, true);
  insert into public.organization_members (organization_id, user_id, role)
    values (inv.organization_id, auth.uid(), inv.role)
    on conflict (organization_id, user_id) do update set role = excluded.role;

  update public.organization_invitations
     set accepted_at = now(), accepted_by = auth.uid()
   where id = inv.id;

  return inv.organization_id;
end;
$$;

/*
 * Accepting an invitation inserts a membership, which seeds the new member's
 * access grid, which the grid's guard refused — because by then the invitee
 * is a member without Administration. The guard is replaced by one for this
 * table: the seeder's own rows pass; everything else needs Administration,
 * for the unit the grant is scoped to, as require_section_write asked.
 */
create or replace function public.seed_member_access()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  s record;
  lvl public.access_level;
begin
  if new.role = 'OWNER' then
    return new;
  end if;

  -- These are defaults written for the person just admitted, not an edit
  -- of somebody's access. The grid's guard accepts exactly these rows, for
  -- this person, in this transaction (0081).
  perform set_config('ccos.seeding_access_for', new.user_id::text, true);

  for s in select code from public.app_sections loop
    lvl := case
      -- Pay is granted by a person, never by a role. See 0064.
      when s.code = 'PAY' then 'NONE'::public.access_level
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
      on conflict (org_id, user_id, section_code) where business_unit_id is null
        do nothing;
    end if;
  end loop;
  return new;
end;
$$;

create or replace function public.guard_member_access()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  row_org uuid := coalesce(new.org_id, old.org_id);
  row_unit uuid := coalesce(new.business_unit_id, old.business_unit_id);
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT'
     and current_setting('ccos.seeding_access_for', true) = new.user_id::text then
    return new;
  end if;
  if not public.can_write_section('ADMIN', row_org, row_unit) then
    raise exception 'you do not have edit access to Administration'
      using hint = 'Ask an administrator for edit rights to this section.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger member_access_section_guard on public.member_access;
create trigger member_access_section_guard
  before insert or update or delete on public.member_access
  for each row execute function public.guard_member_access();

/*
 * And then accepting marks the invitation used, which the invitations guard
 * refused for the same reason. The invitation being accepted may have its
 * `accepted_*` columns set, by its invitee, in the transaction that names
 * it; anything else about any invitation still needs Administration.
 */
create or replace function public.guard_invitation()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE'
     and new.id::text = current_setting('ccos.accepting_invitation', true)
     and new.accepted_by = auth.uid()
     and (new.organization_id, new.email, new.role, new.expires_at, new.revoked_at,
          new.invited_by, new.invited_by_email)
         is not distinct from
         (old.organization_id, old.email, old.role, old.expires_at, old.revoked_at,
          old.invited_by, old.invited_by_email) then
    return new;
  end if;
  if not public.can_write_section('ADMIN', coalesce(new.organization_id, old.organization_id)) then
    raise exception 'you do not have edit access to Administration'
      using hint = 'Ask an administrator for edit rights to this section.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger organization_invitations_section_guard on public.organization_invitations;
create trigger organization_invitations_section_guard
  before insert or update or delete on public.organization_invitations
  for each row execute function public.guard_invitation();
