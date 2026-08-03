-- ---------------------------------------------------------------------------
-- Membership management — inviting people and setting their role
-- ---------------------------------------------------------------------------
-- Until now `organization_members` was readable and nothing else: no policy
-- and no grant for insert, update or delete. Roles could only be set with a
-- SQL client.
--
-- That made every separation-of-duties control in the system unusable in
-- practice. Segregation of duties needs a second person, and there was no way
-- to add one — so an owner was blocked from approving their own requisitions
-- and had no means of inviting anybody who could approve them instead.
--
-- Granting the writes is the easy half. The dangerous half is that membership
-- is where privilege escalation lives, so four rules are enforced by trigger
-- rather than trusted to a screen:
--
--   Nobody changes their own role. Otherwise the weakest account in the
--   organisation is one update away from being the strongest.
--   Only an owner grants ownership. An admin who could appoint owners is an
--   owner with extra steps.
--   The last owner cannot be removed or demoted, or the organisation locks
--   itself out and only a database console can recover it.
--   Only owners and admins manage membership at all.
--
-- Invitations exist because a person cannot be added before they have an
-- account. The invitation is by email and carries the role; accepting it is
-- what creates the membership, and it is the invited person's own action.
-- ---------------------------------------------------------------------------

create table if not exists organization_invitations (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id) on delete cascade,

  -- Stored lower-cased so an invitation to Chef@… is accepted by chef@….
  email text not null,
  role org_role not null default 'CHEF',

  invited_by uuid,
  invited_by_email text,
  created_at timestamptz not null default now(),
  -- An invitation that never expires is a standing key to the organisation.
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid,
  revoked_at timestamptz
);

-- One live invitation per email per organisation.
create unique index if not exists idx_invitations_pending
  on organization_invitations(organization_id, lower(email))
  where accepted_at is null and revoked_at is null;

create index if not exists idx_invitations_email
  on organization_invitations(lower(email)) where accepted_at is null;

/*
 * The guards.
 *
 * Written as one function over insert, update and delete because the four
 * rules are about the same thing — who may change whose role — and splitting
 * them across three triggers would let one be edited without the others.
 */
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
  target_org  := coalesce(new.organization_id, old.organization_id);
  target_user := coalesce(new.user_id, old.user_id);
  new_role    := new.role;

  select m.role into actor_role
    from public.organization_members m
   where m.organization_id = target_org
     and m.user_id = auth.uid();

  /*
   * The first member of a new organisation has nobody to authorise them, so a
   * row inserted when the organisation has no members yet is allowed. This is
   * how sign-up creates an owner.
   */
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

  -- Nobody changes their own role. The weakest account in the organisation
  -- must not be one update away from being the strongest.
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

  -- Only an owner grants ownership. An admin who could appoint owners is an
  -- owner with extra steps.
  if tg_op in ('INSERT', 'UPDATE') and new_role = 'OWNER' and actor_role <> 'OWNER' then
    raise exception 'only an owner can make someone an owner';
  end if;

  -- An admin cannot act on an owner at all.
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'OWNER' and actor_role <> 'OWNER' then
    raise exception 'only an owner can change or remove another owner';
  end if;

  -- The last owner cannot be demoted or removed, or the organisation locks
  -- itself out and only a database console can recover it.
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

create trigger organization_members_guard
  before insert or update or delete on organization_members
  for each row execute function public.enforce_membership_rules();

-- The policies are permissive; the trigger above is what actually decides.
-- Keeping the hard rules in one place means a policy change cannot quietly
-- widen them.
create policy organization_members_insert on organization_members
  for insert to authenticated
  with check (organization_id in (select public.auth_org_ids()));
create policy organization_members_update on organization_members
  for update to authenticated
  using (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));
create policy organization_members_delete on organization_members
  for delete to authenticated
  using (organization_id in (select public.auth_org_ids()));

grant insert, update, delete on organization_members to authenticated;

-- ── Invitations ─────────────────────────────────────────────────────────────

alter table organization_invitations enable row level security;

create policy invitations_read on organization_invitations
  for select to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    -- Or it is addressed to you, so you can find and accept it.
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

create policy invitations_insert on organization_invitations
  for insert to authenticated
  with check (
    exists (
      select 1 from public.organization_members m
       where m.organization_id = organization_invitations.organization_id
         and m.user_id = auth.uid()
         and m.role in ('OWNER', 'ADMIN')
    )
  );

create policy invitations_update on organization_invitations
  for update to authenticated
  using (
    exists (
      select 1 from public.organization_members m
       where m.organization_id = organization_invitations.organization_id
         and m.user_id = auth.uid()
         and m.role in ('OWNER', 'ADMIN')
    )
  );

grant select, insert, update on organization_invitations to authenticated;
-- No delete: a revoked invitation is evidence of who was offered access.

/*
 * An admin must not be able to invite an owner, for the same reason they
 * cannot appoint one directly.
 */
create or replace function public.enforce_invitation_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare actor_role public.org_role;
begin
  new.email := lower(btrim(new.email));
  if new.email = '' or new.email not like '%_@_%' then
    raise exception 'a valid email address is required';
  end if;

  select m.role into actor_role
    from public.organization_members m
   where m.organization_id = new.organization_id and m.user_id = auth.uid();

  if new.role = 'OWNER' and actor_role <> 'OWNER' then
    raise exception 'only an owner can invite another owner';
  end if;
  return new;
end;
$$;

create trigger organization_invitations_guard
  before insert or update on organization_invitations
  for each row execute function public.enforce_invitation_rules();

/*
 * Accept an invitation.
 *
 * SECURITY DEFINER because the invited person is by definition not yet a
 * member and so cannot insert into a table scoped to members. It only ever
 * adds the caller, only against an invitation addressed to the caller's own
 * verified email, and only while that invitation is live.
 */
create or replace function public.accept_invitation(invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.organization_invitations;
  caller_email text;
begin
  select lower(coalesce(auth.jwt() ->> 'email', '')) into caller_email;
  if caller_email = '' then
    raise exception 'not signed in';
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

  insert into public.organization_members (organization_id, user_id, role)
    values (inv.organization_id, auth.uid(), inv.role)
    on conflict (organization_id, user_id) do update set role = excluded.role;

  update public.organization_invitations
     set accepted_at = now(), accepted_by = auth.uid()
   where id = inv.id;

  return inv.organization_id;
end;
$$;

revoke all on function public.accept_invitation(uuid) from public;
grant execute on function public.accept_invitation(uuid) to authenticated;

/*
 * Who is in this organisation, with their email.
 *
 * `auth.users` is not readable by clients, and it should not be — it holds
 * every user of the whole instance. This view exposes only the email of people
 * who are already members of an organisation the caller belongs to.
 */
/*
 * Runs as its owner, not as the caller. `authenticated` has no access to
 * auth.users and must not be given any — it holds every user of the whole
 * instance. The WHERE clause is what scopes this: only members of an
 * organisation the caller belongs to, via auth_org_ids(), which resolves from
 * auth.uid() and cannot be widened by the caller.
 */
create or replace view organization_people as
  select
    m.organization_id,
    m.user_id,
    m.role,
    m.created_at,
    u.email
  from public.organization_members m
  join auth.users u on u.id = m.user_id
  where m.organization_id in (select public.auth_org_ids());

grant select on organization_people to authenticated;

comment on table organization_invitations is
  'Pending access to an organization. Accepting is the invited person''s own action.';
comment on function public.accept_invitation(uuid) is
  'Adds the caller to an organization from an invitation addressed to their own email.';
