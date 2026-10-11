-- ---------------------------------------------------------------------------
-- Selling a dish consumes stock
-- ---------------------------------------------------------------------------
-- `sales_lines` had seven columns — period, recipe, units sold, net sales —
-- and selling a dish moved no stock at all. So there was no theoretical
-- consumption, and with no theoretical consumption there is no
-- theoretical-versus-actual variance, which both gap briefs call the most
-- valuable report in the list. 0091 supplied the actual side; this is the
-- other half.
--
-- Three parts.
--
-- 1 · The columns the brief asks for. A business date distinct from the
--     period, the POS item code that a future adapter maps on, covers,
--     discount, service charge, tax and gross — so a line can carry what a
--     till actually prints rather than a net figure somebody derived.
--
-- 2 · What a dish is made of, all the way down. `production_usage_theoretical`
--     answers this for a preparation, but only one level: it joins
--     `sub_recipe_lines` directly and a sub-recipe inside a sub-recipe is
--     silently dropped. A dish is usually two or three deep — a burger uses a
--     sauce that uses a stock — so this expands recursively and scales each
--     level by how much of the child's batch the parent takes.
--
-- 3 · Posting. One `USAGE` movement per product per period, negative,
--     dated at the end of the period.
--
-- Deliberately theoretical, and the name says so. This is what the recipes
-- say should have been used. What was actually used is the stocktake. The
-- gap between them is the number worth looking at, and it only exists
-- because the two are computed from different evidence — so nothing here
-- may ever be reconciled against a count.
-- ---------------------------------------------------------------------------

alter table sales_lines
  add column if not exists business_date date,
  add column if not exists pos_item_code text,
  add column if not exists covers integer,
  add column if not exists gross_amount numeric(18,5),
  add column if not exists discount_amount numeric(18,5),
  add column if not exists service_charge numeric(18,5),
  add column if not exists tax_amount numeric(18,5);

comment on column sales_lines.pos_item_code is
  'The till''s own code. Nothing maps it yet; it is here so an adapter has somewhere to land. See 0092.';
comment on column sales_lines.business_date is
  'The trading day, which is not the calendar day: a service that ends at 02:00 belongs to the night before.';

alter table sales_periods
  add column if not exists consumption_posted_at timestamptz;

/*
 * A sales line may now have no recipe.
 *
 * It was `not null`, which quietly made the brief's import impossible: a
 * till sends every item it rang up, and on day one none of those codes are
 * mapped to anything. With the constraint in place the only options are to
 * refuse the file or to drop the unmatched rows, and `AGENTS.md` §10 forbids
 * the second — "report what will not import, by line number and reason;
 * never silently drop a row". You cannot report on a row you were unable to
 * store.
 *
 * So an unmapped line lands, carries its `pos_item_code`, and shows up in
 * `sales_usage_theoretical` with null quantities until somebody maps it.
 * Everything downstream treats null as unmapped rather than as zero — which
 * is the same distinction the count sheet makes between a blank and a zero.
 */
alter table sales_lines alter column recipe_id drop not null;

create index if not exists idx_sales_lines_date on sales_lines(org_id, business_date);

/*
 * What one portion of a dish is made of, expanded through every level.
 *
 * The recursion scales as it descends. A recipe line asking for 200 g of a
 * sauce whose batch yields 1000 g takes a fifth of that batch, so each of
 * the sauce's own lines contributes a fifth of its quantity — and if the
 * sauce uses a stock, the same again.
 *
 * `depth` is carried and capped. A sub-recipe that contains itself, directly
 * or through a chain, would otherwise recurse until the server gives up;
 * the catalogue has a dependency graph and nothing in the schema forbids a
 * cycle. Ten is far past any real dish and the cap is a guard, not a limit
 * anybody should meet.
 */
create or replace view recipe_product_requirements
with (security_invoker = true) as
  with recursive expand as (
    select
      rl.org_id,
      rl.recipe_id,
      rl.product_id,
      rl.sub_recipe_id,
      coalesce(rl.gross_qty, 0)::numeric as qty,
      rl.gross_unit as unit,
      1 as depth
    from public.recipe_lines rl

    union all

    select
      e.org_id,
      e.recipe_id,
      sl.product_id,
      sl.child_sub_recipe_id as sub_recipe_id,
      coalesce(sl.gross_qty, 0)
        * (e.qty / nullif(s.batch_yield_qty, 0)) as qty,
      sl.gross_unit as unit,
      e.depth + 1
    from expand e
    join public.sub_recipes s      on s.id = e.sub_recipe_id
    join public.sub_recipe_lines sl on sl.sub_recipe_id = e.sub_recipe_id
    where e.sub_recipe_id is not null
      and e.depth < 10
      and s.batch_yield_qty is not null
      and s.batch_yield_qty <> 0
  )
  select
    org_id,
    recipe_id,
    product_id,
    unit,
    sum(qty)::numeric(18,5) as qty_per_portion,
    max(depth)              as deepest_level
  from expand
  where product_id is not null
    and qty is not null
    and qty <> 0
  group by org_id, recipe_id, product_id, unit;

grant select on recipe_product_requirements to authenticated;

comment on view recipe_product_requirements is
  'One portion of a dish, exploded to products through every level of sub-recipe. See 0092.';

/*
 * What a period of sales should have used.
 *
 * Left join from the sales line, so a dish with no recipe attached — which
 * is every line until somebody maps the till's codes — still appears, with
 * nulls. A report that silently omitted them would make the mapping look
 * finished.
 */
create or replace view sales_usage_theoretical
with (security_invoker = true) as
  select
    sl.org_id,
    sl.period_id,
    sl.id            as sales_line_id,
    sl.business_date,
    sl.recipe_id,
    r.name           as recipe_name,
    sl.units_sold,
    req.product_id,
    p.name           as product_name,
    req.unit,
    (req.qty_per_portion * sl.units_sold)::numeric(18,5) as qty
  from public.sales_lines sl
  left join public.recipes r on r.id = sl.recipe_id
  left join public.recipe_product_requirements req on req.recipe_id = sl.recipe_id
  left join public.products p on p.id = req.product_id;

grant select on sales_usage_theoretical to authenticated;

comment on view sales_usage_theoretical is
  'What the recipes say a period of sales should have consumed. Not what it did — that is the stocktake. See 0092.';

/*
 * Posting it to the ledger.
 *
 * Negative, because `product_stock.on_hand` is the signed sum of movements
 * and consumption takes stock away.
 *
 * One movement per product rather than per sales line. A busy service is
 * tens of thousands of lines and the ledger is read by people; the sales
 * line stays joinable through `sales_usage_theoretical` for anybody who
 * wants the detail.
 *
 * Dated at the end of the period so it cannot land after a stocktake that
 * was counted during it — which would make the count look wrong instead of
 * the recipes.
 */
create or replace function public.post_sales_consumption(p_period uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  per record;
  n integer := 0;
begin
  select * into per from public.sales_periods where id = p_period;
  if per is null then
    raise exception 'no such sales period';
  end if;
  if not public.can_write_section('INVENTORY', per.org_id) then
    raise exception 'you do not have edit access to INVENTORY' using errcode = '42501';
  end if;
  if per.consumption_posted_at is not null then
    raise exception 'this period has already been posted'
      using hint = 'Consumption is posted once. Correct it with a new movement.';
  end if;

  insert into public.stock_movements
    (org_id, product_id, kind, quantity, unit, reason, note,
     actor_id, actor_email, occurred_at)
  select per.org_id, u.product_id, 'USAGE',
         -sum(u.qty), u.unit,
         'sales',
         'Theoretical consumption, ' || coalesce(per.name, per.id::text),
         (select auth.uid()), auth.jwt() ->> 'email',
         (per.ends_on + time '23:59:59') at time zone 'UTC'
    from public.sales_usage_theoretical u
   where u.period_id = p_period
     and u.product_id is not null
     and u.qty is not null
     and u.qty <> 0
   group by u.product_id, u.unit;

  get diagnostics n = row_count;
  update public.sales_periods set consumption_posted_at = now() where id = p_period;
  return n;
end;
$$;

revoke all on function public.post_sales_consumption(uuid) from public;
grant execute on function public.post_sales_consumption(uuid) to authenticated;

/*
 * And the report both briefs are actually after.
 *
 * Theoretical from the recipes, actual from the counts, and the difference.
 * Only meaningful for a product that has been counted at least twice, so
 * the view says how many counts stand behind each row rather than
 * presenting a number built on one.
 */
create or replace view food_cost_variance
with (security_invoker = true) as
  select
    p.org_id,
    p.id                     as product_id,
    p.name                   as product_name,
    p.category,
    coalesce(theo.qty, 0)::numeric(18,5)     as theoretical_used,
    coalesce(cnt.adjustment, 0)::numeric(18,5) as count_adjustment,
    coalesce(cnt.counts, 0)                  as counts_behind_it,
    (coalesce(cnt.adjustment, 0) * coalesce(p.gross_price_per_unit, 0))::numeric(18,5)
                                             as adjustment_value
  from public.products p
  left join (
    select m.product_id, -sum(m.quantity) as qty
      from public.stock_movements m
     where m.kind = 'USAGE' and m.reason = 'sales'
     group by m.product_id
  ) theo on theo.product_id = p.id
  left join (
    select m.product_id, sum(m.quantity) as adjustment, count(*) as counts
      from public.stock_movements m
     where m.kind = 'COUNT'
     group by m.product_id
  ) cnt on cnt.product_id = p.id
  where theo.qty is not null or cnt.adjustment is not null;

grant select on food_cost_variance to authenticated;

comment on view food_cost_variance is
  'Theoretical consumption against what the counts corrected, by product. A row standing on one count says so. See 0092.';
