-- ---------------------------------------------------------------------------
-- Do not create an organisation for someone who was invited to one
-- ---------------------------------------------------------------------------
-- Sign-up creates an organisation and makes the new user its owner. That is
-- right for the first person at a venue and wrong for everybody invited after
-- them, and the combination is worse than either.
--
-- `auth_default_org_id()` returns the OLDEST membership, because until now a
-- user only ever had one. An invited person signs up, gets a personal
-- organisation, then accepts the invitation — so their oldest membership is
-- the empty personal one, and every row they write lands there. They would see
-- an empty catalogue and their colleagues would never see their work. Nothing
-- would error.
--
-- So: if a live invitation exists for the address signing up, no organisation
-- is created. Accepting the invitation is what gives them a membership, and it
-- is then their only one.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_org_id uuid;
  base_slug text;
  final_slug text;
  n int := 0;
begin
  -- Someone with an invitation waiting is joining a venue, not starting one.
  if exists (
    select 1 from public.organization_invitations i
     where lower(i.email) = lower(new.email)
       and i.accepted_at is null
       and i.revoked_at is null
       and i.expires_at > now()
  ) then
    return new;
  end if;

  base_slug := regexp_replace(lower(split_part(new.email, '@', 1)), '[^a-z0-9]+', '-', 'g');
  if base_slug is null or base_slug = '' then
    base_slug := 'org';
  end if;

  final_slug := base_slug;
  while exists (select 1 from public.organizations o where o.slug = final_slug) loop
    n := n + 1;
    final_slug := base_slug || '-' || n::text;
  end loop;

  insert into public.organizations (name, slug)
  values (coalesce(new.raw_user_meta_data ->> 'organization_name', base_slug), final_slug)
  returning id into new_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_org_id, new.id, 'OWNER');

  return new;
end;
$$;

/*
 * Prefer a real organisation over a personal one.
 *
 * Belt and braces for anyone who already signed up before the above, and for
 * a user legitimately in two organisations: the one they were invited to and
 * accepted is where their work belongs, so an accepted invitation wins over
 * an organisation they merely created by signing up.
 */
create or replace function public.auth_default_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.organization_members m
  where m.user_id = (select auth.uid())
  order by
    -- An organisation somebody invited them into comes first.
    (exists (
      select 1 from public.organization_invitations i
       where i.organization_id = m.organization_id
         and i.accepted_by = m.user_id
    )) desc,
    -- Then the one with other people in it, over a personal one of one.
    (select count(*) from public.organization_members m2
      where m2.organization_id = m.organization_id) desc,
    m.created_at
  limit 1;
$$;

comment on function public.auth_default_org_id() is
  'The organization a user writes into. Prefers one they were invited to over one created at sign-up.';
