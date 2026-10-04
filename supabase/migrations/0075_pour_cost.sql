-- ---------------------------------------------------------------------------
-- A bottle is not an ingredient
-- ---------------------------------------------------------------------------
-- Gap 23: "a bottle is costed like an ingredient. The gap between 28 measures
-- and what the till says is the whole of beverage control."
--
-- The platform already costs a bottle correctly as a quantity of liquid — a
-- 700 ml bottle at a price per millilitre, cascading into a recipe like any
-- other product. What it cannot say is the thing a bar manager asks every
-- week: *this bottle should have poured twenty-eight measures and the till
-- recorded twenty-two.*
--
-- That difference is not waste in the kitchen sense and does not appear as
-- waste. It is over-pouring, spillage, staff drinks, a tap left running and
-- theft — four of which are management problems and one of which is a crime,
-- and none of which shows up anywhere in this schema today.
--
-- ## A second cost basis, not a second product
--
-- The roadmap says "add a second cost basis. Same calculation as #11, built
-- once." That is the design: `product_pour` is one row per product that is
-- poured, saying how big a measure is and how much is lost getting it into the
-- glass. Everything else is derived. A product with no row is costed exactly
-- as it was, which is every product in every venue today.
--
-- ## Expected loss is a number a venue sets, not one this file invents
--
-- Every bottle loses something — the last measure that will not come out, the
-- drip tray, the overpour a free pour costs against a jigger. A venue that
-- pours free loses more than one that measures, and the honest figure is the
-- venue's own. The default is zero, so a venue that has not thought about it
-- gets a variance that is too harsh rather than one that is quietly forgiving:
-- a flattering default is how a control stops being read.
--
-- ## The variance is the same shape as the kitchen's
--
-- `production_variance` (0060) sets what the recipes say should have been used
-- against what the ledger says was. `pour_variance` does the same for the bar,
-- with the till's measures standing in for the production record's batches —
-- so a venue reading one already knows how to read the other, and the two
-- cannot drift into different definitions of "should".
-- ---------------------------------------------------------------------------

create table if not exists product_pour (
  product_id uuid primary key references products(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,

  /*
   * The measure, in the product's own stock unit. Millilitres for a spirit,
   * and the column does not assume so: a venue selling olives by the piece
   * from a 500-piece tub has the same question.
   */
  measure_size numeric(18,5) not null check (measure_size > 0),

  /*
   * What never reaches a glass, as a percentage of the container.
   *
   * Zero by default, deliberately. A venue that has not set it gets a variance
   * that is too harsh rather than one that is quietly forgiving — a flattering
   * default is how a control stops being read, and "we always lose about four
   * per cent" is a sentence a bar manager can say and a migration cannot.
   */
  expected_loss_percent numeric(6,3) not null default 0
    check (expected_loss_percent >= 0 and expected_loss_percent < 100),

  note text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_product_pour_org on product_pour(org_id);

/*
 * The venue comes from the product, never the client — the same rule as every
 * other inherited organisation in this schema.
 */
create or replace function public.set_product_pour_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare owner_org uuid;
begin
  select p.org_id into owner_org from public.products p where p.id = new.product_id;
  if owner_org is null then
    raise exception 'there is no such product to pour';
  end if;
  new.org_id := owner_org;
  new.updated_at := now();
  return new;
end;
$$;

create trigger product_pour_org
  before insert or update on product_pour
  for each row execute function public.set_product_pour_org();

alter table product_pour enable row level security;

create policy product_pour_read on product_pour
  for select to authenticated using (org_id in (select public.auth_org_ids()));
create policy product_pour_write on product_pour
  for all to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));

grant select, insert, update, delete on product_pour to authenticated;

create trigger product_pour_section_guard
  before insert or update or delete on product_pour
  for each row execute function public.require_section_write('RECIPES');

-- ── What a measure costs ────────────────────────────────────────────────────

/*
 * The second cost basis.
 *
 * `measures_per_container` is what the bottle *should* yield after the venue's
 * own loss, and `cost_per_measure` is what one of them cost — which is the
 * number that goes on a drinks menu and the number a pour cost percentage is
 * calculated from.
 *
 * Null rather than a guess wherever the product has no price or no stock unit.
 * A cost per measure derived from a missing price is a number that looks like
 * money and is not, and a drinks menu priced off it is wrong in a way nobody
 * can see from the menu.
 */
create or replace view pour_cost with (security_invoker = true) as
  select
    p.id as product_id,
    p.org_id,
    p.name as product_name,
    p.stock_unit,
    pp.measure_size,
    pp.expected_loss_percent,
    p.nett_price_per_unit as cost_per_stock_unit,
    /*
     * A container is the product's own pack, in stock units. `units_per_pack`
     * times `pack_qty` is how the catalogue already states it, and reusing
     * that rather than adding a bottle size keeps one answer to "how big is
     * it" instead of two that drift.
     */
    (p.pack_qty * p.units_per_pack) as container_size,
    case when pp.measure_size > 0 and p.pack_qty is not null and p.units_per_pack is not null
         then floor((p.pack_qty * p.units_per_pack)
                    * (1 - pp.expected_loss_percent / 100.0) / pp.measure_size)
         end as measures_per_container,
    case when p.nett_price_per_unit is not null
         then round(p.nett_price_per_unit * pp.measure_size
                    / greatest(1 - pp.expected_loss_percent / 100.0, 0.000001), 5)
         end as cost_per_measure
  from public.product_pour pp
  join public.products p on p.id = pp.product_id;

grant select on pour_cost to authenticated;

-- ── What should have been poured, against what went ─────────────────────────

/*
 * The bar's version of `production_variance`, and deliberately the same shape.
 *
 * `measures_sold` comes from the sales mix — a dish on the menu that uses this
 * product, times how many of it sold — so the "should" side is the till's, and
 * the "did" side is the stock ledger's, exactly as it is for the kitchen.
 *
 * Nulls are carried as nulls. "Nobody recorded any sales" and "none were
 * poured" are different statements, and a variance report that reads the first
 * as the second accuses a bar of pouring away its entire stock.
 */
create or replace function public.pour_variance(
  p_from date,
  p_to date)
returns table (
  product_id uuid,
  product_name text,
  measure_size numeric,
  measures_sold numeric,
  expected_quantity numeric,
  actual_quantity numeric,
  variance_quantity numeric,
  variance_measures numeric,
  variance_cost numeric,
  comparable boolean,
  why_not text
)
language sql
stable
security definer
set search_path = ''
as $$
  with sold as (
    /*
     * `gross_qty`, not `nett_qty`. The gross figure is what leaves the bottle;
     * the nett is what reaches the glass after the allowance the recipe makes.
     * Setting a nett figure against the stock ledger would report every venue
     * as over-pouring by exactly its own allowance, every week, for ever.
     */
    select rl.product_id,
           sum(sl.units_sold * coalesce(rl.gross_qty, rl.nett_qty)) as expected_quantity
      from public.sales_lines sl
      join public.sales_periods sp on sp.id = sl.period_id
      join public.recipe_lines rl on rl.recipe_id = sl.recipe_id
     where sp.starts_on >= p_from and sp.ends_on <= p_to
       and rl.product_id is not null
     group by rl.product_id
  ),
  used as (
    select m.product_id, sum(-m.quantity) as actual_quantity
      from public.stock_movements m
     where m.kind in ('USAGE', 'WASTE')
       and m.quantity < 0
       and (m.occurred_at at time zone 'UTC')::date between p_from and p_to
     group by m.product_id
  )
  select
    c.product_id,
    c.product_name,
    c.measure_size,
    case when c.measure_size > 0 and s.expected_quantity is not null
         then round(s.expected_quantity / c.measure_size, 2) end as measures_sold,
    s.expected_quantity,
    u.actual_quantity,
    case when s.expected_quantity is not null and u.actual_quantity is not null
         then round(u.actual_quantity - s.expected_quantity, 5) end as variance_quantity,
    case when s.expected_quantity is not null and u.actual_quantity is not null
              and c.measure_size > 0
         then round((u.actual_quantity - s.expected_quantity) / c.measure_size, 2)
         end as variance_measures,
    case when s.expected_quantity is not null and u.actual_quantity is not null
              and c.cost_per_stock_unit is not null
         then round((u.actual_quantity - s.expected_quantity) * c.cost_per_stock_unit, 5)
         end as variance_cost,
    (s.expected_quantity is not null and u.actual_quantity is not null) as comparable,
    case
      when s.expected_quantity is null and u.actual_quantity is null
        then 'nothing sold and nothing poured in this period'
      when s.expected_quantity is null
        then 'stock went out and no sales were recorded against it'
      when u.actual_quantity is null
        then 'sales were recorded and nothing came off the shelf'
      when c.cost_per_stock_unit is null
        then 'the difference is known and has no price to put on it'
    end as why_not
  from public.pour_cost c
  left join sold s on s.product_id = c.product_id
  left join used u on u.product_id = c.product_id;
$$;

grant execute on function public.pour_variance(date, date) to authenticated;

comment on table product_pour is
  'One row per product that is poured. A product with no row is costed exactly as it was.';
comment on column product_pour.expected_loss_percent is
  'What never reaches a glass. Zero by default on purpose: a flattering default is how a control stops being read.';
comment on view pour_cost is
  'What a measure costs, and how many a container should yield. Null rather than a guess where there is no price.';
comment on function public.pour_variance(date, date) is
  'What the till says was sold against what came off the shelf. The same shape as production_variance, for the bar.';
