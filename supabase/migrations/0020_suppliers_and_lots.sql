-- ---------------------------------------------------------------------------
-- Suppliers and stock lots — EU food law
-- ---------------------------------------------------------------------------
-- Three obligations drive this migration, and none of them are satisfiable
-- with a free-text supplier name and a stock quantity:
--
--   Regulation 178/2002 Article 18 — traceability. A food business must be
--   able to identify who supplied any food, and to whom its own food went,
--   and make that available to authorities on demand. "One step back, one
--   step forward." A supplier written as text on a product cannot answer it:
--   it says who usually sells the ingredient, not who delivered the box that
--   went into Tuesday's service.
--
--   Regulation 178/2002 Article 19 — withdrawal and recall. When food is
--   unsafe it has to be withdrawn, which means knowing which deliveries are
--   affected and stopping them being used. That needs an identifiable lot and
--   a way to block it.
--
--   Regulation 852/2004 — hygiene and HACCP. Cold-chain control is a critical
--   control point for chilled and frozen goods, and the check is worth
--   nothing unless the reading is recorded against the delivery it describes.
--
-- Date marking follows from the same place: use-by is a safety limit, best
-- before is a quality one, and conflating them means either throwing away
-- good food or serving unsafe food. They are stored as a kind, not a guess.
-- ---------------------------------------------------------------------------

create type supplier_status as enum ('ACTIVE', 'BLOCKED', 'ARCHIVED');

create table if not exists suppliers (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  -- What the kitchen calls them, and what a contract would call them.
  name text not null,
  legal_name text,

  -- EU VAT identification number, VIES format: country prefix then the
  -- national number, e.g. NL123456789B01. Stored as given; validating it
  -- against VIES is a network call and a later job.
  vat_number text,
  -- Establishment approval number for suppliers of products of animal origin
  -- under Regulation 853/2004 — the oval health mark, e.g. "NL 1234 EC".
  -- Null for everyone else, which is most of a dry goods list.
  approval_number text,

  country_code text,
  address text,
  contact_name text,
  email text,
  phone text,

  payment_terms_days integer,
  lead_time_days integer,
  minimum_order_value numeric(18,5),

  status supplier_status not null default 'ACTIVE',
  notes text,

  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Two suppliers with the same name in one organisation is the duplication this
-- table exists to end.
create unique index if not exists idx_suppliers_org_name
  on suppliers(org_id, lower(name));

/*
 * Certificates, with expiry.
 *
 * An expired HACCP or organic certificate is the same problem as an expired
 * ingredient: it is fine until the day it is not, and nobody notices without
 * a date to check against.
 */
create table if not exists supplier_certificates (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,

  kind text not null,          -- HACCP, BRC, IFS, ORGANIC, MSC, HALAL, ...
  reference text,
  issued_on date,
  expires_on date,
  document_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_supplier_certificates_expiry
  on supplier_certificates(org_id, expires_on);

-- Products point at a supplier rather than naming one. The old text column is
-- kept in step for now: dropping it would break every read at once, and it is
-- removed in a later migration once nothing reads it.
alter table products
  add column if not exists supplier_id uuid references suppliers(id) on delete set null;

create index if not exists idx_products_supplier on products(supplier_id);

-- ── Lots ────────────────────────────────────────────────────────────────────

create type lot_status as enum (
  'OK',         -- usable
  'BLOCKED',    -- held pending a decision; not usable
  'RECALLED',   -- supplier or authority recall
  'WITHDRAWN'   -- removed from sale/use by us
);

create type expiry_kind as enum (
  'USE_BY',      -- a safety limit. Past it, the food is unsafe.
  'BEST_BEFORE'  -- a quality limit. Past it, the food is legal to use.
);

create table if not exists stock_lots (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,

  -- The supplier's own lot or batch code, as printed. This is the identifier
  -- a recall notice will quote, so it is stored as given rather than
  -- normalised.
  lot_code text not null,
  supplier_id uuid references suppliers(id) on delete set null,
  -- Delivery note or invoice reference, for matching against a recall.
  delivery_reference text,

  received_on date not null default current_date,
  expires_on date,
  expiry_kind expiry_kind,

  -- Cold-chain evidence at the point of receipt (Regulation 852/2004 HACCP).
  receipt_temperature_c numeric(6,2),

  status lot_status not null default 'OK',
  status_reason text,
  status_changed_at timestamptz,
  status_changed_by text,

  created_at timestamptz not null default now()
);

create unique index if not exists idx_stock_lots_unique
  on stock_lots(product_id, lot_code, received_on);
create index if not exists idx_stock_lots_expiry
  on stock_lots(org_id, expires_on) where status = 'OK';
create index if not exists idx_stock_lots_supplier on stock_lots(supplier_id);

-- Movements carry the lot they affected. Nullable, because a count adjustment
-- or a historical movement may not be attributable to one.
alter table stock_movements
  add column if not exists lot_id uuid references stock_lots(id) on delete set null;

create index if not exists idx_stock_movements_lot on stock_movements(lot_id);

/*
 * A blocked or recalled lot cannot be consumed — enforced here, not in the UI.
 *
 * Article 19 requires unsafe food to be withdrawn from use. A disabled button
 * is not a withdrawal: it stops one screen, not an import, a script, or the
 * next client anyone writes. Removals are refused; corrections and returns
 * are not, because getting a recalled lot off the shelf and back to the
 * supplier is the whole point of blocking it.
 */
create or replace function public.refuse_movement_on_blocked_lot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lot record;
begin
  if new.lot_id is null then
    return new;
  end if;
  select status, lot_code into lot from public.stock_lots where id = new.lot_id;
  if lot is null then
    return new;
  end if;
  if lot.status <> 'OK'
     and new.kind in ('USAGE', 'TRANSFER')
  then
    raise exception
      'lot % is % and cannot be used or transferred', lot.lot_code, lot.status
      using hint = 'Record a RETURN or WASTE movement to clear it instead.';
  end if;
  return new;
end;
$$;

create trigger stock_movements_block_recalled_lot
  before insert on stock_movements
  for each row execute function public.refuse_movement_on_blocked_lot();

-- ── Tenancy ─────────────────────────────────────────────────────────────────

create trigger suppliers_set_org
  before insert on suppliers
  for each row execute function public.set_org_id();
create trigger stock_lots_set_org
  before insert on stock_lots
  for each row execute function public.set_org_id();

create or replace function public.set_certificate_org_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_org uuid;
begin
  select s.org_id into parent_org from public.suppliers s where s.id = new.supplier_id;
  if parent_org is null then
    raise exception 'supplier not found for certificate';
  end if;
  new.org_id := parent_org;
  return new;
end;
$$;

create trigger supplier_certificates_set_org
  before insert on supplier_certificates
  for each row execute function public.set_certificate_org_id();

alter table suppliers enable row level security;
alter table supplier_certificates enable row level security;
alter table stock_lots enable row level security;

create policy suppliers_read on suppliers
  for select to authenticated using (org_id in (select public.auth_org_ids()));
create policy suppliers_insert on suppliers
  for insert to authenticated with check (public.auth_can_write(org_id));
create policy suppliers_update on suppliers
  for update to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));
create policy suppliers_delete on suppliers
  for delete to authenticated using (public.auth_can_write(org_id));

create policy supplier_certificates_read on supplier_certificates
  for select to authenticated using (org_id in (select public.auth_org_ids()));
create policy supplier_certificates_insert on supplier_certificates
  for insert to authenticated with check (public.auth_can_write(org_id));
create policy supplier_certificates_update on supplier_certificates
  for update to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));
create policy supplier_certificates_delete on supplier_certificates
  for delete to authenticated using (public.auth_can_write(org_id));

create policy stock_lots_read on stock_lots
  for select to authenticated using (org_id in (select public.auth_org_ids()));
create policy stock_lots_insert on stock_lots
  for insert to authenticated with check (public.auth_can_write(org_id));
-- Updatable so a lot can be blocked, recalled and released again. The status
-- history that Article 19 evidence needs is a later, separate ledger.
create policy stock_lots_update on stock_lots
  for update to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));

grant select, insert, update, delete on suppliers to authenticated;
grant select, insert, update, delete on supplier_certificates to authenticated;
grant select, insert, update on stock_lots to authenticated;

-- Deliberately no delete on stock_lots. A lot that was received happened, and
-- deleting it removes the traceability record for everything built from it.

comment on table suppliers is
  'Supplier master. Required for Regulation 178/2002 Article 18 one-step-back traceability.';
comment on table stock_lots is
  'Received batches with lot code, expiry and cold-chain evidence. The unit of recall.';
comment on column stock_lots.expiry_kind is
  'USE_BY is a safety limit; BEST_BEFORE is a quality one. Never inferred.';

-- ---------------------------------------------------------------------------
-- Migrate the free-text supplier names into records.
--
-- Names are folded case-insensitively: the catalogue carries both
-- "UD Astungkara Lancar" and "UD Astungkara lancar", which are one company
-- typed twice. The surviving spelling is the one used by more products.
-- "Various" is not a supplier and becomes no link at all.
-- ---------------------------------------------------------------------------
insert into suppliers (org_id, name, status)
select p.org_id,
       (array_agg(p.supplier order by cnt desc, p.supplier))[1] as name,
       'ACTIVE'
from (
  select org_id, supplier, count(*) over (partition by org_id, supplier) as cnt
  from products
  where supplier is not null
    and btrim(supplier) <> ''
    and lower(btrim(supplier)) <> 'various'
) p
group by p.org_id, lower(btrim(p.supplier))
on conflict do nothing;

update products p
   set supplier_id = s.id
  from suppliers s
 where s.org_id = p.org_id
   and lower(btrim(p.supplier)) = lower(s.name)
   and p.supplier_id is null;
