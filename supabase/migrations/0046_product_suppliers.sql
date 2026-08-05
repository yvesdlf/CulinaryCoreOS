-- ---------------------------------------------------------------------------
-- A product can be bought from more than one supplier
-- ---------------------------------------------------------------------------
-- `products.supplier_id` is a single reference, which says a kitchen buys each
-- thing from exactly one company. No kitchen works that way. Butter comes from
-- whoever has it, tuna from whichever boat landed, and the whole point of
-- having three vendors for the same product is that on the morning one of them
-- is out of stock — or has put its price up — there is somewhere else to go.
--
-- The single column made three things impossible: comparing what the same
-- ingredient costs from each supplier, ordering from the second one without
-- editing the product, and answering "who else sells this" when a delivery
-- fails.
--
-- So a link table, carrying what actually differs between suppliers for the
-- same product: their code for it, their pack size, their price, their lead
-- time and their minimum order.
--
-- `products.supplier_id` is kept, and kept correct. It now means "the preferred
-- supplier" and is maintained by trigger from whichever link row is marked
-- preferred. Every existing query, filter, report and the whole purchasing
-- module go on working unchanged, and nothing has to be migrated in one go —
-- which is the only reason this can be added to a system already carrying
-- eleven hundred products and their order history.
--
-- Exactly one preferred per product, enforced by a partial unique index rather
-- than by hope: two preferred suppliers is the state where the denormalised
-- column silently disagrees with the table it is derived from.
-- ---------------------------------------------------------------------------

create table if not exists product_suppliers (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  product_id uuid not null references products(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,

  -- What this supplier calls it. The number a buyer quotes down the phone and
  -- the one printed on their invoice, which is rarely the venue's own name.
  supplier_sku text,
  supplier_name_for_product text,

  -- How this supplier sells it. Two vendors quoting "butter" may mean a 250 g
  -- block and a 5 kg box, and comparing their prices without this is comparing
  -- nothing.
  pack_qty numeric(18,5),
  pack_unit text,

  -- Their price for one pack, in the venue's currency.
  pack_price numeric(18,5),
  -- Derived on write from the two above, so the comparison a buyer actually
  -- wants — cost per kilo — does not have to be done in their head.
  price_per_unit numeric(18,5),
  price_updated_on date,

  lead_time_days integer,
  minimum_order_qty numeric(18,5),

  /*
   * Where the order goes unless somebody says otherwise. Exactly one per
   * product; the index below is what makes that true.
   */
  is_preferred boolean not null default false,
  -- A supplier can be kept on the list without being orderable — delisted for
  -- a failed audit, or out of season — without losing their price history.
  active boolean not null default true,
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint product_suppliers_unique unique (product_id, supplier_id),
  constraint product_suppliers_pack check (pack_qty is null or pack_qty > 0)
);

create index if not exists idx_product_suppliers_product
  on product_suppliers(product_id, is_preferred desc);
create index if not exists idx_product_suppliers_supplier
  on product_suppliers(supplier_id, active);

-- One preferred supplier per product. Partial, so the many non-preferred rows
-- do not collide with each other.
create unique index if not exists idx_product_suppliers_one_preferred
  on product_suppliers(product_id) where is_preferred;

/*
 * Keep the derived figures honest.
 *
 * price_per_unit is computed here rather than trusted from the client, because
 * it is the number a buyer compares suppliers on and a client that computed it
 * differently — or not at all — would make one vendor look cheaper than they
 * are.
 */
create or replace function public.derive_product_supplier_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.pack_price is not null and new.pack_qty is not null and new.pack_qty > 0 then
    new.price_per_unit := round(new.pack_price / new.pack_qty, 5);
  else
    new.price_per_unit := null;
  end if;

  if tg_op = 'UPDATE' and new.pack_price is distinct from old.pack_price then
    new.price_updated_on := current_date;
  elsif tg_op = 'INSERT' and new.pack_price is not null and new.price_updated_on is null then
    new.price_updated_on := current_date;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists product_suppliers_derive on product_suppliers;
create trigger product_suppliers_derive
  before insert or update on product_suppliers
  for each row execute function public.derive_product_supplier_price();

/*
 * The preferred link is what products.supplier_id means.
 *
 * Maintained here so the column cannot drift from the table. Marking a new
 * supplier preferred also un-prefers the previous one — without that, the
 * partial unique index would simply refuse the write and the screen would
 * report a constraint violation for what is an ordinary act.
 *
 * AFTER, not BEFORE, because it updates sibling rows and the unique index has
 * to have settled first.
 */
create or replace function public.sync_preferred_supplier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_product uuid := coalesce(new.product_id, old.product_id);
  preferred uuid;
begin
  select ps.supplier_id into preferred
    from public.product_suppliers ps
   where ps.product_id = target_product and ps.is_preferred
   limit 1;

  /*
   * Nobody marked one: fall back to the cheapest live option, because a
   * product with one supplier should not need a decision made about it and a
   * buyer's default should be the cheapest.
   *
   * The fallback writes the flag rather than only products.supplier_id.
   * Leaving it implicit meant the product pointed at Le Marche while no row
   * was marked preferred, so a screen reading the flag and a screen reading
   * the column disagreed about the same fact.
   *
   * pg_trigger_depth() is what makes that safe. Choosing a new preferred
   * supplier first clears the old one, and that nested UPDATE fires this
   * trigger at a moment when no row is preferred — without the guard, the
   * fallback helpfully promoted the row that had just been demoted, and then
   * the row the user actually chose landed on top of it and broke the unique
   * index. Switching supplier failed with a constraint violation for what is
   * the most ordinary act in this table.
   *
   * At depth 1 this is a statement somebody ran. Deeper, it is the middle of
   * a cascade and the final state is not visible yet, so it leaves it alone.
   */
  if preferred is null and pg_trigger_depth() <= 1 then
    update public.product_suppliers ps
       set is_preferred = true
     where ps.id = (
       select ps2.id from public.product_suppliers ps2
        where ps2.product_id = target_product and ps2.active
        order by ps2.price_per_unit nulls last, ps2.created_at
        limit 1)
    returning ps.supplier_id into preferred;
  end if;

  update public.products p
     set supplier_id = preferred
   where p.id = target_product
     and p.supplier_id is distinct from preferred;

  return null;
end;
$$;

drop trigger if exists product_suppliers_sync_preferred on product_suppliers;
create trigger product_suppliers_sync_preferred
  after insert or update or delete on product_suppliers
  for each row execute function public.sync_preferred_supplier();

/*
 * Un-prefer the others when one is chosen.
 *
 * BEFORE the row lands, so the partial unique index never sees two.
 */
create or replace function public.clear_other_preferred_suppliers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_preferred then
    update public.product_suppliers ps
       set is_preferred = false
     where ps.product_id = new.product_id
       and ps.id <> new.id
       and ps.is_preferred;
  end if;
  return new;
end;
$$;

drop trigger if exists product_suppliers_single_preferred on product_suppliers;
create trigger product_suppliers_single_preferred
  before insert or update on product_suppliers
  for each row execute function public.clear_other_preferred_suppliers();

-- ── Backfill ────────────────────────────────────────────────────────────────
/*
 * Everything already linked becomes its product's preferred supplier.
 *
 * The price comes from the product's own buying price, which is what the venue
 * currently pays and therefore what that supplier charges. It is the only
 * price on record, and starting the comparison with one honest row beats
 * starting it empty.
 */
insert into product_suppliers
  (org_id, product_id, supplier_id, pack_qty, pack_unit, pack_price, is_preferred)
select
  p.org_id, p.id, p.supplier_id,
  nullif(p.pack_qty, 0),
  p.pack_unit,
  nullif(p.buying_price_per_pack, 0),
  true
from products p
where p.supplier_id is not null
on conflict (product_id, supplier_id) do nothing;

-- ── Tenancy ─────────────────────────────────────────────────────────────────

drop trigger if exists product_suppliers_set_org on product_suppliers;
create trigger product_suppliers_set_org before insert on product_suppliers
  for each row execute function public.set_org_id();

alter table product_suppliers enable row level security;

drop policy if exists product_suppliers_read on product_suppliers;
create policy product_suppliers_read on product_suppliers
  for select to authenticated
  using (org_id in (select public.auth_org_ids()));
drop policy if exists product_suppliers_insert on product_suppliers;
create policy product_suppliers_insert on product_suppliers
  for insert to authenticated
  with check (public.auth_can_write(org_id));
drop policy if exists product_suppliers_update on product_suppliers;
create policy product_suppliers_update on product_suppliers
  for update to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));
drop policy if exists product_suppliers_delete on product_suppliers;
create policy product_suppliers_delete on product_suppliers
  for delete to authenticated
  using (public.auth_can_write(org_id));

grant select, insert, update, delete on product_suppliers to authenticated;

-- Which supplier sells a product is a purchasing decision, not a recipe one.
drop trigger if exists product_suppliers_section_guard on product_suppliers;
create trigger product_suppliers_section_guard
  before insert or update or delete on product_suppliers
  for each row execute function public.require_section_write('SUPPLIERS');

/*
 * Who sells what, priced for comparison.
 *
 * The rank is what makes it useful: a buyer opening a product wants to see
 * immediately whether the one they are about to order from is the cheapest,
 * and "2 of 3" answers that without arithmetic.
 */
create or replace view product_supplier_options as
  select
    ps.id,
    ps.org_id,
    ps.product_id,
    p.name as product_name,
    ps.supplier_id,
    s.name as supplier_name,
    ps.supplier_sku,
    ps.pack_qty,
    ps.pack_unit,
    ps.pack_price,
    ps.price_per_unit,
    ps.price_updated_on,
    ps.lead_time_days,
    ps.minimum_order_qty,
    ps.is_preferred,
    ps.active,
    ps.note,
    rank() over (
      partition by ps.product_id
      order by ps.price_per_unit nulls last
    ) as price_rank,
    count(*) filter (where ps.active) over (partition by ps.product_id) as supplier_count
  from public.product_suppliers ps
  join public.products p on p.id = ps.product_id
  join public.suppliers s on s.id = ps.supplier_id
  where ps.org_id in (select public.auth_org_ids());

grant select on product_supplier_options to authenticated;

comment on table product_suppliers is
  'Who sells a product, at what pack size and price. One is preferred; products.supplier_id mirrors it.';
comment on column product_suppliers.price_per_unit is
  'Derived on write. The figure suppliers are actually compared on.';
comment on view product_supplier_options is
  'Suppliers for a product, ranked by unit price so the cheapest is visible without arithmetic.';
