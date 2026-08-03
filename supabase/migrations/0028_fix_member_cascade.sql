-- ---------------------------------------------------------------------------
-- Let a user account be deleted
-- ---------------------------------------------------------------------------
-- Deleting a row from auth.users cascades to organization_members, and the
-- privilege-escalation guard refused it — so an account could not be removed
-- at all without disabling the trigger, which is not something an application
-- should ever have to do. It also means a data-deletion request under GDPR
-- Article 17 could not be honoured.
--
-- The guard exists to stop one person changing another's role, or their own,
-- through the API. Every such action carries a session. A statement with no
-- session is not a person using the app: it is a cascade, a migration, or an
-- administrator with direct access, none of which the guard was written for
-- and all of which it was breaking.
--
-- Anonymous API access is already refused by row-level security, so allowing
-- the guard to stand aside when there is no session does not open a path in.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_membership_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
