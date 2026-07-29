-- CulinaryCoreOS — per-entity tax, waste and inflation.
--
-- Modelled on the venue's own costing workbook (COGS V5), whose figures the
-- cost engine now reproduces exactly:
--
--   inflation   = cost * inflation%          (4% of cost of sales, dish level)
--   waste       = cost * waste%              (5% when costing a batch)
--   COG         = cost + waste + inflation   (both taken on raw cost, not compounded)
--   guest price = menu_price * (1 + tax%)    (21% = 11% PPN + 10% service)
--   food cost % = COG / menu_price           (menu price EXCLUDES tax)
--
-- These were previously hard-coded constants — a 5% "security margin" and an
-- 11% VAT rate — which suited neither this venue nor any other. They are now
-- columns on both sub_recipes and recipes so each record can carry its own,
-- editable in the UI.
--
-- Defaults reproduce the workbook rather than applying the same number
-- everywhere: waste belongs to batch production, inflation to dish pricing.
-- Applying both at both levels would double-count on any dish built from a
-- sub-recipe. Both remain editable in either direction.

-- ---------------------------------------------------------------------------
-- Sub-recipes
-- ---------------------------------------------------------------------------
alter table sub_recipes
  add column if not exists waste_percent     numeric(6,3) not null default 5,
  add column if not exists inflation_percent numeric(6,3) not null default 0,
  add column if not exists tax_percent       numeric(6,3) not null default 21;

-- Carry over whatever the old single buffer was set to.
update sub_recipes
   set waste_percent = security_margin_percent
 where security_margin_percent is not null
   and waste_percent = 5
   and security_margin_percent <> 5;

-- ---------------------------------------------------------------------------
-- Recipes
-- ---------------------------------------------------------------------------
alter table recipes
  add column if not exists waste_percent     numeric(6,3) not null default 0,
  add column if not exists inflation_percent numeric(6,3) not null default 4,
  add column if not exists tax_percent       numeric(6,3) not null default 21;

-- Menu price excluding tax, plus the derived guest-facing figure. The old
-- columns held the opposite convention: a tax-inclusive price that was stripped
-- back. price_excl_vat already holds the excluding-tax value, so it seeds
-- menu_price directly.
alter table recipes
  add column if not exists menu_price       numeric(18,5),
  add column if not exists price_incl_tax   numeric(18,5),
  add column if not exists waste_amount     numeric(18,5) not null default 0,
  add column if not exists inflation_amount numeric(18,5) not null default 0,
  add column if not exists total_cog        numeric(18,5) not null default 0,
  add column if not exists gross_profit     numeric(18,5) not null default 0,
  add column if not exists gross_profit_percent numeric(6,3) not null default 0;

update recipes
   set menu_price = coalesce(menu_price, price_excl_vat, 0)
 where menu_price is null;

update recipes
   set price_incl_tax = round(coalesce(menu_price, 0) * (1 + tax_percent / 100), 5)
 where price_incl_tax is null;

-- Recompute the COG chain from whatever cost is already stored, so existing
-- rows are consistent with the new columns immediately rather than only after
-- their next save.
update recipes
   set waste_amount     = round(coalesce(total_cost, 0) * waste_percent / 100, 5),
       inflation_amount = round(coalesce(total_cost, 0) * inflation_percent / 100, 5);

update recipes
   set total_cog = coalesce(total_cost, 0) + waste_amount + inflation_amount;

update recipes
   set gross_profit = coalesce(menu_price, 0) - total_cog,
       gross_profit_percent = case
         when coalesce(menu_price, 0) > 0
           then round(((menu_price - total_cog) / menu_price) * 100, 3)
         else 0
       end,
       food_cost_percent = case
         when coalesce(menu_price, 0) > 0
           then round((total_cog / menu_price) * 100, 3)
         else 0
       end;

alter table recipes alter column menu_price set not null;
alter table recipes alter column menu_price set default 0;
alter table recipes alter column price_incl_tax set not null;
alter table recipes alter column price_incl_tax set default 0;

-- ---------------------------------------------------------------------------
-- Guard rails
-- ---------------------------------------------------------------------------
-- Percentages are percentages. A negative buffer or a tax over 100% is a data
-- entry slip, and silently costing on it would be worse than refusing it.
alter table sub_recipes
  add constraint sub_recipes_percents_sane check (
    waste_percent between 0 and 100
    and inflation_percent between 0 and 100
    and tax_percent between 0 and 100
  );

alter table recipes
  add constraint recipes_percents_sane check (
    waste_percent between 0 and 100
    and inflation_percent between 0 and 100
    and tax_percent between 0 and 100
  );
