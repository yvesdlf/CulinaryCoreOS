-- ---------------------------------------------------------------------------
-- A recipe is not a menu item
-- ---------------------------------------------------------------------------
-- Until now it was. `recipes` carries `menu_price`, `price_incl_vat`,
-- `price_excl_vat` and `tax_percent`, so a dish had exactly one price
-- everywhere, forever.
--
-- That holds for one venue with one card. It fails the moment there are two,
-- which is the customer both gap briefs are written for:
--
--   * The same burger is 95,000 in the restaurant and 120,000 by the pool.
--   * A dish appears on the all-day menu and the banquet menu at different
--     portions.
--   * A menu runs for a season and then stops, and last year's prices still
--     have to be readable against last year's sales.
--   * The till has its own code for each button, and nothing in this schema
--     had anywhere to put it. 0092 added `pos_item_code` to `sales_lines` so
--     an import could at least land; this is the other end of that mapping.
--
-- `recipes.menu_price` is deliberately left alone. It is what every existing
-- screen reads and removing it would be a rewrite of the costing surface in
-- a migration about menus. It becomes the fallback: a dish with no menu item
-- is still priced, and `menu_item_pricing` says which of the two answered.
-- Retiring it is its own change, once something writes menu items.
--
-- Modifiers adjust both sides. "Add avocado" is money on the price and
-- avocado out of the store, and a modifier that moved only the first would
-- quietly understate theoretical consumption — which is the number 0092
-- exists to produce.
-- ---------------------------------------------------------------------------

create table if not exists menus (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  business_unit_id uuid references business_units(id) on delete cascade,

  code text,
  name text not null,

  /*
   * A menu is a period, not a flag. "Which menu was running on the 4th of
   * March" has to be answerable a year later, against sales recorded then,
   * so an ended menu is dated rather than deleted.
   */
  active_from date,
  active_to date,

  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint menus_named check (btrim(name) <> ''),
  constraint menus_period check (active_to is null or active_from is null
                                 or active_to >= active_from)
);

create table if not exists menu_items (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  menu_id uuid not null references menus(id) on delete cascade,
  recipe_id uuid references recipes(id) on delete restrict,

  -- What the guest reads, where it differs from the kitchen's name for it.
  display_name text,
  category text,

  selling_price numeric(18,5),
  tax_rate_id uuid references tax_rates(id) on delete set null,

  -- The till's own button. This is the join 0092's import needs.
  pos_item_code text,

  is_available boolean not null default true,
  sort_order integer,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint menu_items_price check (selling_price is null or selling_price >= 0)
);

/*
 * One code per menu, and only where there is one.
 *
 * A partial index rather than a plain unique constraint: most items have no
 * code until somebody maps the till, and a plain constraint would allow
 * exactly one uncoded item per menu.
 */
create unique index if not exists idx_menu_items_code
  on menu_items(menu_id, lower(btrim(pos_item_code)))
  where pos_item_code is not null and btrim(pos_item_code) <> '';

create index if not exists idx_menu_items_menu on menu_items(org_id, menu_id);
create index if not exists idx_menus_unit on menus(org_id, business_unit_id);

create table if not exists menu_item_modifiers (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  menu_item_id uuid not null references menu_items(id) on delete cascade,

  name text not null,

  -- What it adds, if anything: a product straight from the store, or a
  -- preparation. Both may be null for a modifier that only changes the price
  -- ("large"), and both being set is refused below.
  product_id uuid references products(id) on delete restrict,
  sub_recipe_id uuid references sub_recipes(id) on delete restrict,
  quantity numeric(18,5),
  quantity_unit text,

  -- Signed. "No onion" is a negative price delta as readily as a positive.
  price_delta numeric(18,5) not null default 0,

  created_at timestamptz not null default now(),

  constraint menu_item_modifiers_named check (btrim(name) <> ''),
  constraint menu_item_modifiers_one_source
    check (product_id is null or sub_recipe_id is null),
  constraint menu_item_modifiers_quantified
    check ((product_id is null and sub_recipe_id is null)
           or (quantity is not null and quantity > 0 and quantity_unit is not null))
);

create index if not exists idx_menu_item_modifiers_item
  on menu_item_modifiers(menu_item_id);

-- Org from the parent, per table, as the rest of the schema does it.
create or replace function public.set_menu_child_org()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent_org uuid;
begin
  if tg_table_name = 'menu_items' then
    select m.org_id into parent_org from public.menus m where m.id = new.menu_id;
    if parent_org is null then raise exception 'the menu this item belongs to does not exist'; end if;
  else
    select i.org_id into parent_org from public.menu_items i where i.id = new.menu_item_id;
    if parent_org is null then raise exception 'the menu item this modifier belongs to does not exist'; end if;
  end if;
  new.org_id := parent_org;
  return new;
end $$;

drop trigger if exists menus_set_org on menus;
create trigger menus_set_org before insert on menus
  for each row execute function public.set_org_id();
drop trigger if exists menus_touch on menus;
create trigger menus_touch before update on menus
  for each row execute function public.set_updated_at();
drop trigger if exists menu_items_set_org on menu_items;
create trigger menu_items_set_org before insert on menu_items
  for each row execute function public.set_menu_child_org();
drop trigger if exists menu_items_touch on menu_items;
create trigger menu_items_touch before update on menu_items
  for each row execute function public.set_updated_at();
drop trigger if exists menu_item_modifiers_set_org on menu_item_modifiers;
create trigger menu_item_modifiers_set_org before insert on menu_item_modifiers
  for each row execute function public.set_menu_child_org();

/*
 * A menu belongs to one of this venue's own outlets.
 *
 * `business_unit_in_org` exists for exactly this and is used by the stock
 * ledger; without it a menu can be hung off another organisation's unit,
 * which is how a price list leaks.
 */
create or replace function public.enforce_menu_unit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.business_unit_id is not null
     and not public.business_unit_in_org(new.business_unit_id, new.org_id)
  then
    raise exception 'that department belongs to another organisation';
  end if;
  return new;
end $$;

drop trigger if exists menus_unit on menus;
create trigger menus_unit before insert or update on menus
  for each row execute function public.enforce_menu_unit();

alter table menus enable row level security;
alter table menu_items enable row level security;
alter table menu_item_modifiers enable row level security;

drop policy if exists menus_read on menus;
create policy menus_read on menus for select to authenticated
  using (public.can_read_section('MENU', org_id));
drop policy if exists menus_write on menus;
create policy menus_write on menus for insert to authenticated
  with check (public.auth_can_write(org_id));
drop policy if exists menus_update on menus;
create policy menus_update on menus for update to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));
drop policy if exists menus_delete on menus;
create policy menus_delete on menus for delete to authenticated
  using (public.auth_can_write(org_id));

drop policy if exists menu_items_read on menu_items;
create policy menu_items_read on menu_items for select to authenticated
  using (public.can_read_section('MENU', org_id));
drop policy if exists menu_items_write on menu_items;
create policy menu_items_write on menu_items for insert to authenticated
  with check (public.auth_can_write(org_id));
drop policy if exists menu_items_update on menu_items;
create policy menu_items_update on menu_items for update to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));
drop policy if exists menu_items_delete on menu_items;
create policy menu_items_delete on menu_items for delete to authenticated
  using (public.auth_can_write(org_id));

drop policy if exists menu_item_modifiers_read on menu_item_modifiers;
create policy menu_item_modifiers_read on menu_item_modifiers for select to authenticated
  using (public.can_read_section('MENU', org_id));
drop policy if exists menu_item_modifiers_write on menu_item_modifiers;
create policy menu_item_modifiers_write on menu_item_modifiers for insert to authenticated
  with check (public.auth_can_write(org_id));
drop policy if exists menu_item_modifiers_update on menu_item_modifiers;
create policy menu_item_modifiers_update on menu_item_modifiers for update to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));
drop policy if exists menu_item_modifiers_delete on menu_item_modifiers;
create policy menu_item_modifiers_delete on menu_item_modifiers for delete to authenticated
  using (public.auth_can_write(org_id));

grant select, insert, update, delete on menus to authenticated;
grant select, insert, update, delete on menu_items to authenticated;
grant select, insert, update, delete on menu_item_modifiers to authenticated;

drop trigger if exists menus_section_guard on menus;
create trigger menus_section_guard before insert or update or delete on menus
  for each row execute function public.require_section_write('MENU');
drop trigger if exists menu_items_section_guard on menu_items;
create trigger menu_items_section_guard before insert or update or delete on menu_items
  for each row execute function public.require_section_write('MENU');
drop trigger if exists menu_item_modifiers_section_guard on menu_item_modifiers;
create trigger menu_item_modifiers_section_guard
  before insert or update or delete on menu_item_modifiers
  for each row execute function public.require_section_write('MENU');

delete from public.section_read_rules
 where table_name in ('menus', 'menu_items', 'menu_item_modifiers');
insert into public.section_read_rules (table_name, section_code) values
  ('menus', 'MENU'),
  ('menu_items', 'MENU'),
  ('menu_item_modifiers', 'MENU');

/*
 * What each item costs and makes.
 *
 * The price falls back to `recipes.menu_price` where the item does not set
 * one, and `priced_by` says which answered — so nobody has to guess whether
 * a margin came from the menu or from the old single price on the recipe.
 */
create or replace view menu_item_pricing
with (security_invoker = true) as
  select
    mi.org_id,
    m.id                as menu_id,
    m.name              as menu_name,
    m.business_unit_id,
    m.active_from,
    m.active_to,
    mi.id               as menu_item_id,
    mi.pos_item_code,
    mi.is_available,
    mi.recipe_id,
    coalesce(mi.display_name, r.name)      as item_name,
    coalesce(mi.category, r.category)      as category,
    coalesce(mi.selling_price, r.menu_price)::numeric(18,5) as price,
    case when mi.selling_price is not null then 'menu item'
         when r.menu_price is not null     then 'recipe fallback'
         else 'unpriced' end               as priced_by,
    r.total_cost::numeric(18,5)            as recipe_cost,
    (coalesce(mi.selling_price, r.menu_price) - r.total_cost)::numeric(18,5)
                                           as contribution,
    case when coalesce(mi.selling_price, r.menu_price) > 0
         then round(r.total_cost / coalesce(mi.selling_price, r.menu_price) * 100, 1)
    end                                    as food_cost_percent
  from public.menu_items mi
  join public.menus m   on m.id = mi.menu_id
  left join public.recipes r on r.id = mi.recipe_id;

grant select on menu_item_pricing to authenticated;

/*
 * The till codes nothing answers to.
 *
 * 0092 lets an unmapped sales line land rather than refusing the file; this
 * is the list somebody works through afterwards. Without it the unmapped
 * rows are stored and invisible, which is only marginally better than
 * dropping them.
 */
create or replace view sales_codes_unmapped
with (security_invoker = true) as
  select
    sl.org_id,
    sl.pos_item_code,
    count(*)                       as lines,
    sum(sl.units_sold)             as units_sold,
    sum(sl.net_sales)::numeric(18,5) as net_sales,
    min(sl.business_date)          as first_seen,
    max(sl.business_date)          as last_seen
  from public.sales_lines sl
  where sl.recipe_id is null
    and sl.pos_item_code is not null
    and not exists (
      select 1 from public.menu_items mi
       where mi.org_id = sl.org_id
         and lower(btrim(mi.pos_item_code)) = lower(btrim(sl.pos_item_code))
    )
  group by sl.org_id, sl.pos_item_code;

grant select on sales_codes_unmapped to authenticated;

comment on table menus is
  'A priced card for an outlet over a period. A recipe can appear on several at different prices. See 0093.';
comment on view menu_item_pricing is
  'Price, cost and margin per menu item, saying whether the price came from the item or the recipe. See 0093.';
comment on view sales_codes_unmapped is
  'Till codes that reached sales_lines with nothing to map them to. The worklist for the POS import. See 0093.';
