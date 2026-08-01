-- ---------------------------------------------------------------------------
-- Recipe collections
-- ---------------------------------------------------------------------------
-- A named set of dishes that get printed and handed out together: a prep pack
-- for a section, a tasting menu for a briefing, the sheets a new commis needs
-- in week one. The venue's answer to a folder of printouts, except the costs
-- and allergens on them are current.
--
-- A collection holds references, not copies. Copying a recipe into a folder is
-- how a kitchen ends up with two versions of a dish and no idea which is
-- cooked — the whole reason for costing software is that there is one dish and
-- everything points at it.
--
-- Tenancy follows every other table: org_id stamped by trigger, policies from
-- 0004 deciding visibility.
-- ---------------------------------------------------------------------------

create table if not exists collections (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists collection_recipes (
  collection_id uuid not null references collections(id) on delete cascade,
  recipe_id uuid not null references recipes(id) on delete cascade,
  -- Order is meaningful: a prep pack reads in the order the section works.
  position int not null default 0,
  primary key (collection_id, recipe_id)
);

create index if not exists idx_collection_recipes_collection
  on collection_recipes(collection_id);

-- ── Tenancy ─────────────────────────────────────────────────────────────────

create trigger collections_set_org
  before insert on collections
  for each row execute function public.set_org_id();

create trigger collections_touch
  before update on collections
  for each row execute function set_updated_at();

alter table collections enable row level security;
alter table collection_recipes enable row level security;

create policy collections_read on collections
  for select to authenticated
  using (org_id in (select public.auth_org_ids()));

create policy collections_write on collections
  for all to authenticated
  using (public.auth_can_write(org_id))
  with check (public.auth_can_write(org_id));

-- The join table carries no org_id of its own; it inherits the collection's,
-- which keeps one source of truth for who may see a membership row.
create policy collection_recipes_read on collection_recipes
  for select to authenticated
  using (
    collection_id in (
      select c.id from collections c
       where c.org_id in (select public.auth_org_ids())
    )
  );

create policy collection_recipes_write on collection_recipes
  for all to authenticated
  using (
    collection_id in (
      select c.id from collections c where public.auth_can_write(c.org_id)
    )
  )
  with check (
    collection_id in (
      select c.id from collections c where public.auth_can_write(c.org_id)
    )
  );

grant select, insert, update, delete on collections to authenticated;
grant select, insert, update, delete on collection_recipes to authenticated;
