-- CulinaryCoreOS — multi-tenancy and real Row Level Security (SRS 4.15).
--
-- Replaces the wide-open `dev_open_access` policies from 0003 with policies
-- that scope every row to the caller's organization.
--
-- Design notes, because the failure modes here are subtle:
--
-- 1. Membership lookup goes through SECURITY DEFINER functions. A policy on
--    `products` that selects from `organization_members` would trigger that
--    table's own RLS, which in turn selects from it again — infinite recursion,
--    which Postgres reports as a confusing "stack depth exceeded". SECURITY
--    DEFINER runs the lookup as the function owner and bypasses RLS.
--
-- 2. Those functions are STABLE, so the planner evaluates them once per
--    statement rather than once per row.
--
-- 3. `search_path` is pinned to an empty string and every reference is fully
--    qualified. A SECURITY DEFINER function without this can be hijacked by a
--    caller who puts a malicious table earlier in their own search_path.
--
-- 4. Clients never send org_id. A BEFORE INSERT trigger stamps it from the
--    caller's membership, and the policy's WITH CHECK re-verifies it. Even a
--    tampered client cannot write into another tenant's data.
--
-- 5. Ingredient lines carry a denormalised org_id kept in step with their
--    parent by trigger. Scoping them through a join to the parent would work
--    but puts a subquery in the hot path of every line read.

-- ---------------------------------------------------------------------------
-- Organizations and membership
-- ---------------------------------------------------------------------------

create table if not exists organizations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  create type org_role as enum ('OWNER', 'ADMIN', 'CHEF', 'VIEWER');
exception when duplicate_object then null;
end $$;

create table if not exists organization_members (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role org_role not null default 'VIEWER',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index if not exists idx_org_members_user on organization_members(user_id);

-- ---------------------------------------------------------------------------
-- Membership helpers
-- ---------------------------------------------------------------------------

-- Every organization the current user belongs to.
create or replace function public.auth_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id
  from public.organization_members m
  where m.user_id = (select auth.uid());
$$;

-- The organization new rows are stamped with. A user in exactly one org — the
-- common case — needs no explicit choice; the oldest membership wins if there
-- are several, so behaviour is at least deterministic. Revisit when the UI
-- gains an organization switcher.
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
  order by m.created_at
  limit 1;
$$;

-- VIEWER is read-only; everyone else may write.
create or replace function public.auth_can_write(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.user_id = (select auth.uid())
      and m.organization_id = org
      and m.role in ('OWNER', 'ADMIN', 'CHEF')
  );
$$;

grant execute on function
  public.auth_org_ids(), public.auth_default_org_id(), public.auth_can_write(uuid)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sign-up: give every new user their own organization
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- org_id on every data table
-- ---------------------------------------------------------------------------

alter table products         add column if not exists org_id uuid references organizations(id) on delete cascade;
alter table sub_recipes      add column if not exists org_id uuid references organizations(id) on delete cascade;
alter table sub_recipe_lines add column if not exists org_id uuid references organizations(id) on delete cascade;
alter table recipes          add column if not exists org_id uuid references organizations(id) on delete cascade;
alter table recipe_lines     add column if not exists org_id uuid references organizations(id) on delete cascade;

-- Adopt any pre-tenancy rows (the seeded catalogue) into a demo organization,
-- so enabling these policies does not orphan existing data.
do $$
declare
  demo_id uuid;
begin
  if exists (select 1 from products where org_id is null)
     or exists (select 1 from sub_recipes where org_id is null)
     or exists (select 1 from recipes where org_id is null) then

    select id into demo_id from organizations where slug = 'demo';
    if demo_id is null then
      insert into organizations (name, slug) values ('Demo Kitchen', 'demo')
      returning id into demo_id;
    end if;

    update products         set org_id = demo_id where org_id is null;
    update sub_recipes      set org_id = demo_id where org_id is null;
    update sub_recipe_lines set org_id = demo_id where org_id is null;
    update recipes          set org_id = demo_id where org_id is null;
    update recipe_lines     set org_id = demo_id where org_id is null;
  end if;
end $$;

alter table products         alter column org_id set not null;
alter table sub_recipes      alter column org_id set not null;
alter table sub_recipe_lines alter column org_id set not null;
alter table recipes          alter column org_id set not null;
alter table recipe_lines     alter column org_id set not null;

create index if not exists idx_products_org         on products(org_id);
create index if not exists idx_sub_recipes_org      on sub_recipes(org_id);
create index if not exists idx_sub_recipe_lines_org on sub_recipe_lines(org_id);
create index if not exists idx_recipes_org          on recipes(org_id);
create index if not exists idx_recipe_lines_org     on recipe_lines(org_id);

-- ---------------------------------------------------------------------------
-- Stamp org_id server-side so the client never supplies it
-- ---------------------------------------------------------------------------

create or replace function public.set_org_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.org_id is null then
    new.org_id := public.auth_default_org_id();
  end if;
  if new.org_id is null then
    raise exception 'no organization for current user'
      using hint = 'The signed-in user has no organization membership.';
  end if;
  return new;
end;
$$;

-- Lines inherit their parent's organization rather than the caller's default,
-- so a line can never end up in a different tenant from the recipe owning it.
create or replace function public.set_line_org_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_org uuid;
begin
  if tg_table_name = 'sub_recipe_lines' then
    select s.org_id into parent_org from public.sub_recipes s where s.id = new.sub_recipe_id;
  else
    select r.org_id into parent_org from public.recipes r where r.id = new.recipe_id;
  end if;

  if parent_org is null then
    raise exception 'parent row not found for ingredient line';
  end if;
  new.org_id := parent_org;
  return new;
end;
$$;

drop trigger if exists products_set_org on products;
create trigger products_set_org before insert on products
  for each row execute function public.set_org_id();

drop trigger if exists sub_recipes_set_org on sub_recipes;
create trigger sub_recipes_set_org before insert on sub_recipes
  for each row execute function public.set_org_id();

drop trigger if exists recipes_set_org on recipes;
create trigger recipes_set_org before insert on recipes
  for each row execute function public.set_org_id();

drop trigger if exists sub_recipe_lines_set_org on sub_recipe_lines;
create trigger sub_recipe_lines_set_org before insert on sub_recipe_lines
  for each row execute function public.set_line_org_id();

drop trigger if exists recipe_lines_set_org on recipe_lines;
create trigger recipe_lines_set_org before insert on recipe_lines
  for each row execute function public.set_line_org_id();

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table organizations        enable row level security;
alter table organization_members enable row level security;

drop policy if exists organizations_read on organizations;
create policy organizations_read on organizations
  for select to authenticated
  using (id in (select public.auth_org_ids()));

drop policy if exists organizations_update on organizations;
create policy organizations_update on organizations
  for update to authenticated
  using (public.auth_can_write(id))
  with check (public.auth_can_write(id));

-- A member may see the roster of their own organizations. Membership changes
-- are intentionally not writable from the client yet — invites belong behind a
-- server-side flow, not an anon-key UPDATE.
drop policy if exists organization_members_read on organization_members;
create policy organization_members_read on organization_members
  for select to authenticated
  using (organization_id in (select public.auth_org_ids()));

-- Replace the open development policies from 0003.
do $$
declare
  t text;
begin
  foreach t in array array[
    'products', 'sub_recipes', 'sub_recipe_lines', 'recipes', 'recipe_lines'
  ] loop
    execute format('drop policy if exists dev_open_access on %I', t);

    -- Read: any member of the owning organization.
    execute format(
      'create policy tenant_read on %I for select to authenticated '
      'using (org_id in (select public.auth_org_ids()))', t);

    -- Write: members whose role allows it. WITH CHECK re-verifies the row
    -- lands in an organization the caller may write to, which is what stops a
    -- tampered client from moving rows between tenants.
    execute format(
      'create policy tenant_insert on %I for insert to authenticated '
      'with check (public.auth_can_write(org_id))', t);
    execute format(
      'create policy tenant_update on %I for update to authenticated '
      'using (public.auth_can_write(org_id)) '
      'with check (public.auth_can_write(org_id))', t);
    execute format(
      'create policy tenant_delete on %I for delete to authenticated '
      'using (public.auth_can_write(org_id))', t);
  end loop;
end;
$$;

-- The anon role keeps its schema access (needed to reach the auth endpoints)
-- but loses all data access: every policy above is scoped to `authenticated`,
-- and revoking here means an unauthenticated request cannot read a single row
-- even if a future policy is written carelessly.
revoke select, insert, update, delete on
  products, sub_recipes, sub_recipe_lines, recipes, recipe_lines
  from anon;

grant select, insert, update, delete on
  products, sub_recipes, sub_recipe_lines, recipes, recipe_lines
  to authenticated;

grant select on organizations, organization_members to authenticated;
grant update on organizations to authenticated;
