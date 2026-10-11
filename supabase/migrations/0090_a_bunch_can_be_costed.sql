-- ---------------------------------------------------------------------------
-- A bunch of coriander can be costed
-- ---------------------------------------------------------------------------
-- Costing has never reconciled units. `calculateLineCost` takes a quantity
-- and a cost per unit and multiplies them, and nothing anywhere compares the
-- recipe line's unit against the unit its product is priced in.
--
-- Two consequences, and the second is the one the gap briefs ask about.
--
--   A line reading "0.2 kg" against a product priced per gram costs a
--   thousandth of the truth, silently. That has not produced a wrong figure
--   in this database yet — every one of the 21 existing recipe lines carries
--   its product's own unit, because the import writes it there — so it is
--   latent rather than harmless. It goes wrong the first time somebody types
--   a unit by hand.
--
--   And a line reading "1 bunch" cannot be costed at all, by anybody, ever,
--   because no general rule says what a bunch weighs. That is a fact about
--   the product, and this is where a venue records it.
--
-- The resolution order lives in `apps/web/src/engine/unit-conversion.ts` with
-- its own tests: identical unit, then physics, then these rows, then density.
-- Physics first so that a venue typing "1 kg = 100 g" into its own table
-- cannot thereby redefine the kilogram.
--
-- Note for the next person reading the briefs: Part 1 §3.1 says this logic
-- belongs in `packages/shared`. `AGENTS.md` puts pure business logic in
-- `apps/web/src/engine/`, and `packages/shared/src/costing/engine.ts` is a
-- stub that still says "implementation pending". The repository's own
-- convention wins; the conflict is recorded in
-- `docs/programme/GAP_RECONCILIATION.md`.
--
-- Not yet wired into costing. The table and the resolver exist and are
-- tested; changing what `recalculateLine` does to every recipe in every
-- venue is a separate change with its own proof, and bundling it here would
-- mean one migration nobody can review.
-- ---------------------------------------------------------------------------

create table if not exists product_unit_conversions (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,

  /*
   * Stored as written, not folded to a canonical spelling.
   *
   * The engine normalises "Gr" and "grams" to "g" when it looks a row up, so
   * folding here as well would gain nothing and lose what somebody typed —
   * and a venue that writes "punnet" should see "punnet" back.
   */
  from_unit text not null,
  to_unit text not null,

  -- How many `to_unit` in one `from_unit`. One row answers both directions;
  -- the engine inverts it, because making somebody record the reverse too is
  -- how the two end up disagreeing.
  factor numeric(18,6) not null,

  -- Why it is that number: "weighed 5 bunches, averaged", "supplier's spec
  -- sheet". A factor with no provenance is one nobody dares correct.
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint product_unit_conversions_unique
    unique (product_id, from_unit, to_unit),
  -- Zero would cost every line at nothing; negative is not a quantity. The
  -- engine skips such a row defensively as well, because a constraint added
  -- later does not clean what is already there.
  constraint product_unit_conversions_factor check (factor > 0),
  -- A unit does not convert to itself for a factor other than 1, and
  -- recording that it does is a trap for whoever reads it next.
  constraint product_unit_conversions_distinct
    check (lower(btrim(from_unit)) <> lower(btrim(to_unit))),
  constraint product_unit_conversions_named
    check (btrim(from_unit) <> '' and btrim(to_unit) <> '')
);

create index if not exists idx_product_unit_conversions_product
  on product_unit_conversions(org_id, product_id);

drop trigger if exists product_unit_conversions_set_org on product_unit_conversions;
create trigger product_unit_conversions_set_org
  before insert on product_unit_conversions
  for each row execute function public.set_org_id();

drop trigger if exists product_unit_conversions_touch on product_unit_conversions;
create trigger product_unit_conversions_touch
  before update on product_unit_conversions
  for each row execute function public.set_updated_at();

alter table product_unit_conversions enable row level security;

drop policy if exists product_unit_conversions_read on product_unit_conversions;
create policy product_unit_conversions_read on product_unit_conversions
  for select to authenticated
  using (org_id in (select public.auth_org_ids()));
drop policy if exists product_unit_conversions_insert on product_unit_conversions;
create policy product_unit_conversions_insert on product_unit_conversions
  for insert to authenticated
  with check (public.auth_can_write(org_id));
drop policy if exists product_unit_conversions_update on product_unit_conversions;
create policy product_unit_conversions_update on product_unit_conversions
  for update to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));
drop policy if exists product_unit_conversions_delete on product_unit_conversions;
create policy product_unit_conversions_delete on product_unit_conversions
  for delete to authenticated
  using (public.auth_can_write(org_id));

grant select, insert, update, delete on product_unit_conversions to authenticated;

/*
 * RECIPES, because that is the section `products` itself is guarded by.
 *
 * The first draft of this said 'PRODUCTS', which reads correctly and is not
 * a section that exists — `app_sections` has RECIPES, INVENTORY, MENU and
 * sixteen others, and the catalogue lives under RECIPES. `require_section_write`
 * of a section nobody holds refuses everybody, so the table was writable by
 * no one at all. Five checks in 32_unit_conversions.sql went red.
 */
drop trigger if exists product_unit_conversions_section_guard on product_unit_conversions;
create trigger product_unit_conversions_section_guard
  before insert or update or delete on product_unit_conversions
  for each row execute function public.require_section_write('RECIPES');

comment on table product_unit_conversions is
  'Per-product unit conversions, for units no general rule covers — a bunch, an egg, a punnet. See 0090.';

/*
 * Registered as shared rather than gated, which 0079 requires of every table
 * carrying a section guard.
 *
 * Not `section_code = 'RECIPES'`: writing one needs Recipes, but reading
 * one is needed anywhere a quantity is turned into money — costing,
 * production, a stocktake converting a count. That is the same position
 * `products`, `product_suppliers` and `product_pour` already take, and the
 * suite refuses a guarded table that declares neither.
 */
delete from public.section_read_rules where table_name = 'product_unit_conversions';
insert into public.section_read_rules (table_name, section_code, shared_because)
values ('product_unit_conversions', null,
        'what a bunch of this product weighs, needed anywhere a quantity is costed');

/*
 * Density, for crossing between mass and volume.
 *
 * On the product rather than in the table above because it is one number per
 * product, not a pair of units, and because it answers every mass/volume
 * question at once: recording it once gives ml to g, l to kg and back.
 *
 * Grams per millilitre, which is also kilograms per litre, so the figure a
 * supplier quotes needs no conversion before it is entered.
 */
alter table products
  add column if not exists density_g_per_ml numeric(10,4);

alter table products drop constraint if exists products_density_positive;
alter table products add constraint products_density_positive
  check (density_g_per_ml is null or density_g_per_ml > 0);

comment on column products.density_g_per_ml is
  'Grams per millilitre, for converting between mass and volume. Null where unknown — never guessed. See 0090.';

/*
 * Which lines cannot be costed.
 *
 * The brief asks for a "missing conversions" report and this is its query.
 * A view rather than a screen's SQL so that the recipe editor's warning and
 * the report cannot drift apart and disagree about which lines are broken.
 *
 * Deliberately invoker's rights: it reads recipes, products and conversions,
 * all three of which carry their own row-level policies, and an owner's
 * rights view here would hand every venue's catalogue to every caller. 0077
 * went through this table by table.
 */
create or replace view recipe_lines_needing_conversion
with (security_invoker = true) as
  select
    rl.org_id,
    rl.recipe_id,
    r.name           as recipe_name,
    rl.id            as recipe_line_id,
    rl.line_number,
    rl.product_id,
    p.name           as product_name,
    rl.nett_unit     as line_unit,
    p.gross_unit     as product_unit,
    p.density_g_per_ml
  from recipe_lines rl
  join recipes r  on r.id = rl.recipe_id
  join products p on p.id = rl.product_id
 where rl.product_id is not null
   -- Same unit: nothing to resolve.
   and lower(btrim(coalesce(rl.nett_unit, ''))) is distinct from
       lower(btrim(coalesce(p.gross_unit, '')))
   -- Physics covers it.
   and not (
     lower(btrim(coalesce(rl.nett_unit, ''))) in ('mg','g','gr','kg')
     and lower(btrim(coalesce(p.gross_unit, ''))) in ('mg','g','gr','kg')
   )
   and not (
     lower(btrim(coalesce(rl.nett_unit, ''))) in ('ml','cl','l','litre','liter')
     and lower(btrim(coalesce(p.gross_unit, ''))) in ('ml','cl','l','litre','liter')
   )
   -- The product says what a bunch is.
   and not exists (
     select 1 from product_unit_conversions c
      where c.product_id = rl.product_id
        and (
          (lower(btrim(c.from_unit)) = lower(btrim(rl.nett_unit))
           and lower(btrim(c.to_unit)) = lower(btrim(p.gross_unit)))
          or
          (lower(btrim(c.to_unit)) = lower(btrim(rl.nett_unit))
           and lower(btrim(c.from_unit)) = lower(btrim(p.gross_unit)))
        )
   )
   -- Or a density does, where one side is mass and the other volume.
   and not (
     p.density_g_per_ml is not null
     and (
       (lower(btrim(coalesce(rl.nett_unit, ''))) in ('ml','cl','l')
        and lower(btrim(coalesce(p.gross_unit, ''))) in ('mg','g','gr','kg'))
       or
       (lower(btrim(coalesce(rl.nett_unit, ''))) in ('mg','g','gr','kg')
        and lower(btrim(coalesce(p.gross_unit, ''))) in ('ml','cl','l'))
     )
   );

grant select on recipe_lines_needing_conversion to authenticated;

comment on view recipe_lines_needing_conversion is
  'Recipe lines whose unit cannot be reconciled with their product''s. The brief''s missing-conversions report. See 0090.';
