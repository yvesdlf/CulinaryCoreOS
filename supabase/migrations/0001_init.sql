-- CulinaryCoreOS (CCOS) — initial schema
-- Covers: products, sub-recipes, recipes, and their ingredient lines.
-- Does NOT yet cover: allergens (dedicated table), suppliers, purchasing,
-- inventory, production planning, RBAC/multi-tenant, audit log. See
-- docs/PROGRESS.md backlog — this is a first pass to unblock development.

create extension if not exists "uuid-ossp";

create type product_status as enum ('ACTIVE', 'INACTIVE', 'PENDING', 'DISCONTINUED');
create type recipe_status as enum ('NEW', 'ACTUAL', 'PENDING', 'UPDATE', 'DISCONTINUED');

-- ---------------------------------------------------------------------------
-- Products (raw ingredients) — from Product List sheet
-- ---------------------------------------------------------------------------
create table products (
  id uuid primary key default uuid_generate_v4(),
  category text not null,
  supplier text,
  name text not null,
  brand text,

  pack_qty numeric not null default 1,
  pack_unit text not null,
  units_per_pack numeric not null default 1,
  units_per_pack_unit text,
  total_qty numeric,
  total_unit text,

  buying_price_per_pack numeric(14, 4),
  buying_price_per_unit numeric(14, 4),
  gross_price_per_unit numeric(14, 4),
  nett_price_per_unit numeric(14, 4),

  gross_qty numeric,
  gross_unit text,
  waste_qty numeric default 0,
  waste_unit text,
  nett_qty numeric,
  nett_unit text,
  ref_percent numeric(5, 2) default 0,   -- waste/trim %
  yield_percent numeric(5, 2) default 100,

  status product_status not null default 'ACTIVE',

  -- nutrition per 100g
  fat_g numeric(10, 4) default 0,
  carbs_g numeric(10, 4) default 0,
  protein_g numeric(10, 4) default 0,
  vit_a_mg numeric(10, 4) default 0,
  vit_c_mg numeric(10, 4) default 0,
  calcium_mg numeric(10, 4) default 0,
  iron_mg numeric(10, 4) default 0,
  sodium_mg numeric(10, 4) default 0,
  kcal numeric(10, 4) default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Sub-Recipes — reusable intermediate components (sauces, marinades, bases...)
-- ---------------------------------------------------------------------------
create table sub_recipes (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  category text,
  status recipe_status not null default 'NEW',

  batch_yield_qty numeric,
  batch_yield_unit text,

  total_cost numeric(14, 4) default 0,
  cost_per_unit numeric(14, 4) default 0,
  security_margin_percent numeric(5, 2) not null default 5,

  fat_g numeric(10, 4) default 0,
  carbs_g numeric(10, 4) default 0,
  protein_g numeric(10, 4) default 0,
  vit_a_mg numeric(10, 4) default 0,
  vit_c_mg numeric(10, 4) default 0,
  calcium_mg numeric(10, 4) default 0,
  iron_mg numeric(10, 4) default 0,
  sodium_mg numeric(10, 4) default 0,
  kcal numeric(10, 4) default 0,

  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Sub-Recipe ingredient lines. A line references EITHER a product OR another
-- sub-recipe (unlimited nesting depth — enforced in application logic, not
-- here, since Postgres check constraints can't easily prevent cycles).
create table sub_recipe_lines (
  id uuid primary key default uuid_generate_v4(),
  sub_recipe_id uuid not null references sub_recipes(id) on delete cascade,
  line_number int not null,

  product_id uuid references products(id),
  child_sub_recipe_id uuid references sub_recipes(id),

  nett_qty numeric not null,
  nett_unit text not null,
  ref_percent numeric(5, 2) default 0,
  gross_qty numeric,
  gross_unit text,

  cost_per_unit numeric(14, 4),
  line_cost numeric(14, 4),

  constraint sub_recipe_line_references_one_source check (
    (product_id is not null and child_sub_recipe_id is null) or
    (product_id is null and child_sub_recipe_id is not null)
  ),
  constraint sub_recipe_no_self_reference check (
    child_sub_recipe_id is null or child_sub_recipe_id <> sub_recipe_id
  )
);

-- ---------------------------------------------------------------------------
-- Recipes — sellable/servable menu items
-- ---------------------------------------------------------------------------
create table recipes (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  category text,
  status recipe_status not null default 'NEW',

  yield_qty numeric default 1,
  yield_unit text default 'por',

  price_incl_vat numeric(14, 4),
  price_excl_vat numeric(14, 4),
  total_cost numeric(14, 4) default 0,
  total_cost_with_margin numeric(14, 4) default 0,
  gross_contribution_margin numeric(14, 4) default 0,
  food_cost_percent numeric(6, 3) default 0,
  currency text not null default 'AED',

  fat_g numeric(10, 4) default 0,
  carbs_g numeric(10, 4) default 0,
  protein_g numeric(10, 4) default 0,
  vit_a_mg numeric(10, 4) default 0,
  vit_c_mg numeric(10, 4) default 0,
  calcium_mg numeric(10, 4) default 0,
  iron_mg numeric(10, 4) default 0,
  sodium_mg numeric(10, 4) default 0,
  kcal numeric(10, 4) default 0,

  gluten_free boolean default false,
  dairy_free boolean default false,
  vegetarian boolean default false,
  vegan boolean default false,
  nuts_free boolean default false,
  soy_free boolean default false,
  sulfites_free boolean default false,

  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table recipe_lines (
  id uuid primary key default uuid_generate_v4(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  line_number int not null,

  product_id uuid references products(id),
  sub_recipe_id uuid references sub_recipes(id),

  nett_qty numeric not null,
  nett_unit text not null,
  ref_percent numeric(5, 2) default 0,
  gross_qty numeric,
  gross_unit text,

  cost_per_unit numeric(14, 4),
  line_cost numeric(14, 4),

  constraint recipe_line_references_one_source check (
    (product_id is not null and sub_recipe_id is null) or
    (product_id is null and sub_recipe_id is not null)
  )
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index idx_sub_recipe_lines_sub_recipe_id on sub_recipe_lines(sub_recipe_id);
create index idx_sub_recipe_lines_product_id on sub_recipe_lines(product_id);
create index idx_recipe_lines_recipe_id on recipe_lines(recipe_id);
create index idx_recipe_lines_product_id on recipe_lines(product_id);
create index idx_products_category on products(category);
create index idx_products_status on products(status);

-- ---------------------------------------------------------------------------
-- NOTE: Row Level Security is NOT yet enabled. Multi-tenant RBAC (SRS 4.15)
-- needs an organizations/tenants table + policies before this goes anywhere
-- near production. Tracked in docs/PROGRESS.md.
-- ---------------------------------------------------------------------------
