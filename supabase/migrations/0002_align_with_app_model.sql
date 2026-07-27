-- CulinaryCoreOS — align the initial schema with the application data model.
--
-- Three gaps found when wiring persistence against `packages/shared` types:
--   1. `allergens` had no column anywhere, so the field would be silently
--      dropped on every write.
--   2. Per-unit costs are stored to 5 decimal places by the cost engine
--      (UNIT_COST_DP), but the columns were numeric(14,4) and would truncate.
--      In IDR a per-gram cost like 806.25000 matters.
--   3. Currency defaulted to AED; the app now defaults to IDR with PPN 11%.
--
-- Also adds the updated_at triggers the app relies on for audit ordering.

-- ---------------------------------------------------------------------------
-- 1. Allergens
-- ---------------------------------------------------------------------------
-- Stored as a text array for now. A dedicated allergen table with the EU 14 /
-- US 9 union is still on the backlog (SRS 4.x); this keeps the data rather
-- than losing it in the meantime.
alter table products    add column if not exists allergens text[] not null default '{}';
alter table sub_recipes add column if not exists allergens text[] not null default '{}';
alter table recipes     add column if not exists allergens text[] not null default '{}';

-- ---------------------------------------------------------------------------
-- 2. Money precision
-- ---------------------------------------------------------------------------
-- Totals stay at 2dp of real money but need headroom for IDR magnitudes
-- (a pack of beef is ~1.600.000). Per-unit costs need 5dp.
alter table products
  alter column buying_price_per_pack type numeric(18, 5),
  alter column buying_price_per_unit type numeric(18, 5),
  alter column gross_price_per_unit  type numeric(18, 5),
  alter column nett_price_per_unit   type numeric(18, 5);

alter table sub_recipes
  alter column total_cost    type numeric(18, 5),
  alter column cost_per_unit type numeric(18, 5);

alter table sub_recipe_lines
  alter column cost_per_unit type numeric(18, 5),
  alter column line_cost     type numeric(18, 5);

alter table recipes
  alter column price_incl_vat            type numeric(18, 5),
  alter column price_excl_vat            type numeric(18, 5),
  alter column total_cost                type numeric(18, 5),
  alter column total_cost_with_margin    type numeric(18, 5),
  alter column gross_contribution_margin type numeric(18, 5);

alter table recipe_lines
  alter column cost_per_unit type numeric(18, 5),
  alter column line_cost     type numeric(18, 5);

-- ---------------------------------------------------------------------------
-- 3. Currency default
-- ---------------------------------------------------------------------------
alter table recipes alter column currency set default 'IDR';

-- ---------------------------------------------------------------------------
-- 4. updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on products;
create trigger products_set_updated_at
  before update on products
  for each row execute function set_updated_at();

drop trigger if exists sub_recipes_set_updated_at on sub_recipes;
create trigger sub_recipes_set_updated_at
  before update on sub_recipes
  for each row execute function set_updated_at();

drop trigger if exists recipes_set_updated_at on recipes;
create trigger recipes_set_updated_at
  before update on recipes
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Line ordering
-- ---------------------------------------------------------------------------
-- Ingredient lines are always read back in workbook order.
create unique index if not exists idx_sub_recipe_lines_order
  on sub_recipe_lines(sub_recipe_id, line_number);
create unique index if not exists idx_recipe_lines_order
  on recipe_lines(recipe_id, line_number);
create index if not exists idx_recipe_lines_sub_recipe_id
  on recipe_lines(sub_recipe_id);
create index if not exists idx_sub_recipe_lines_child
  on sub_recipe_lines(child_sub_recipe_id);
