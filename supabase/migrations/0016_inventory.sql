-- ---------------------------------------------------------------------------
-- Inventory — SRS 4.10
-- ---------------------------------------------------------------------------
-- Stock is a ledger, not a number.
--
-- The obvious design is a `quantity` column on products that goes up and down.
-- It is also the one that cannot answer "why is this 4 kg short" a week later,
-- and that loses the answer permanently the moment two people adjust at once.
-- Every movement is recorded instead, and the level is their sum — which makes
-- a count, a delivery and a spillage the same kind of fact, differing only in
-- reason.
--
-- Quantities are held in the product's own stock unit, which is its purchase
-- unit. Converting at write time would bake a conversion into history that a
-- later correction could not undo.
-- ---------------------------------------------------------------------------

create type stock_movement_kind as enum (
  'RECEIPT',      -- a delivery arrived
  'WASTE',        -- spoilage, damage, expiry, overproduction
  'USAGE',        -- consumed by production
  'COUNT',        -- a physical count corrected the books
  'TRANSFER',     -- moved elsewhere
  'RETURN'        -- sent back to the supplier
);

create table if not exists stock_movements (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,

  kind stock_movement_kind not null,
  -- Signed. A receipt is positive, waste negative; a count adjustment is
  -- whichever direction reconciles the books, which is why this is not two
  -- columns of "in" and "out".
  quantity numeric(18,5) not null,
  unit text not null,

  -- The price at the time, captured rather than looked up later: valuing last
  -- month's waste at today's price is a different number and a wrong one.
  unit_cost numeric(18,5),

  reason text,
  note text,
  actor_id uuid,
  actor_email text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_stock_movements_product
  on stock_movements(product_id, occurred_at desc);
create index if not exists idx_stock_movements_kind
  on stock_movements(org_id, kind, occurred_at desc);

-- Par levels live on the product: they are a property of what we buy, and
-- splitting them into their own table would buy nothing until locations exist.
alter table products
  add column if not exists par_level numeric(18,5),
  add column if not exists reorder_point numeric(18,5),
  add column if not exists stock_unit text;

comment on column products.par_level is
  'Target quantity to hold, in stock units. Null means not stock-managed.';
comment on column products.reorder_point is
  'Level at which reordering is suggested. Null falls back to half of par.';

-- ── Tenancy ─────────────────────────────────────────────────────────────────

create trigger stock_movements_set_org
  before insert on stock_movements
  for each row execute function public.set_org_id();

alter table stock_movements enable row level security;

create policy stock_movements_read on stock_movements
  for select to authenticated
  using (org_id in (select public.auth_org_ids()));

create policy stock_movements_insert on stock_movements
  for insert to authenticated
  with check (public.auth_can_write(org_id));

-- No update or delete policy, and no grant for either. A stock ledger that can
-- be edited after the fact cannot be reconciled against anything; a mistake is
-- corrected by recording its reversal, which is what a stock book does.
grant select, insert on stock_movements to authenticated;

comment on table stock_movements is
  'Append-only stock ledger. Current level is the sum of a product''s movements.';

-- ---------------------------------------------------------------------------
-- Current levels, as a view.
--
-- Derived rather than cached: a cached level is a second source of truth that
-- goes wrong silently, and summing a few thousand rows is not the bottleneck
-- in a kitchen.
-- ---------------------------------------------------------------------------
create or replace view product_stock as
  select
    p.id as product_id,
    p.org_id,
    coalesce(sum(m.quantity), 0) as on_hand,
    max(m.occurred_at) as last_movement_at
  from products p
  left join stock_movements m on m.product_id = p.id
  group by p.id, p.org_id;

grant select on product_stock to authenticated;
