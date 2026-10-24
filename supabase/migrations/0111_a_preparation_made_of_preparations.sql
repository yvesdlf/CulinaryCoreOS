-- ---------------------------------------------------------------------------
-- A preparation made of preparations
-- ---------------------------------------------------------------------------
-- `production_usage_theoretical` (0060) joined `sub_recipe_lines` once and
-- kept only the lines carrying a `product_id`. A line pointing at another
-- sub-recipe — a sauce built on a stock, a marinade built on a spice paste —
-- was dropped, silently, along with everything underneath it.
--
-- So the theoretical consumption of any nested preparation was understated,
-- and `production_variance()` reads the difference between theoretical and
-- actual as *waste*. A kitchen making a demi-glace from a veal stock looked
-- like it was throwing away the entire stock, every single batch. The figure
-- was plausible, nobody could explain it, and the usual conclusion from an
-- unexplainable variance is that the report is wrong — which it was, though
-- not in a way anybody could see.
--
-- 0092 already wrote the explosion correctly for recipes, in
-- `recipe_product_requirements`, and this is the same walk applied to the
-- thing that predates it. A child line asking for 200 ml of a stock whose
-- batch yields 500 ml takes two fifths of that batch, so each of the stock's
-- own lines contributes two fifths of its quantity, to a depth of ten.
--
-- Two things this changes about the view's shape, both deliberate:
--
--   The grain is now one row per record per product per unit, where it was
--   one row per *line*. A preparation listing flour twice used to produce two
--   rows, and `production_variance()` sums `batches` across them — so it
--   double-counted the batches of any recipe that mentioned an ingredient
--   more than once. Summing the quantities first fixes that too.
--
--   A child with no batch yield cannot be scaled, so the walk stops there and
--   its ingredients are still missing. That is unavoidable — dividing by a
--   yield nobody recorded would invent a figure — but it must not be silent,
--   which is what `production_expansion_gaps` below is for.
-- ---------------------------------------------------------------------------

/*
 * Dropped and recreated rather than replaced, because `create or replace
 * view` refuses to change a column's type and `qty` gains a cast below. It
 * fails loudly on its own — but a migration that runs it inside a script
 * whose output nobody reads fails quietly, which is how the cast appeared to
 * have been applied when it had not.
 *
 * No cascade: nothing else is built on this view. `production_variance()` is
 * a function and names it at call time, so it picks up the new definition
 * without a dependency to break.
 */
drop view if exists production_usage_theoretical;

create view production_usage_theoretical
with (security_invoker = true) as
  with recursive expand as (
    /*
     * One batch of the preparation that was made, times however many were
     * made. `child` is what the line points at next; `product_id` is what it
     * consumes directly, and a line has one or the other.
     */
    select
      r.org_id,
      r.id                      as production_record_id,
      r.occurred_at,
      r.sub_recipe_id,
      r.batches,
      r.recipe_changed_since,
      sl.product_id,
      sl.child_sub_recipe_id    as child,
      coalesce(sl.gross_qty, 0) * r.batches as qty,
      sl.gross_unit             as unit,
      1                         as depth
    from public.production_records_effective r
    join public.sub_recipe_lines sl on sl.sub_recipe_id = r.sub_recipe_id

    union all

    /*
     * Two fifths of a batch of the child means two fifths of each of the
     * child's own lines. `nullif` on the yield is what stops a division by
     * zero becoming an infinity that reads like a very hungry kitchen.
     */
    select
      e.org_id,
      e.production_record_id,
      e.occurred_at,
      e.sub_recipe_id,
      e.batches,
      e.recipe_changed_since,
      sl.product_id,
      sl.child_sub_recipe_id,
      coalesce(sl.gross_qty, 0) * (e.qty / nullif(s.batch_yield_qty, 0)),
      sl.gross_unit,
      e.depth + 1
    from expand e
    join public.sub_recipes s on s.id = e.child
    join public.sub_recipe_lines sl on sl.sub_recipe_id = e.child
    where e.child is not null
      and e.depth < 10
      and s.batch_yield_qty is not null
      and s.batch_yield_qty <> 0
  )
  select
    org_id,
    production_record_id,
    occurred_at,
    (occurred_at at time zone 'UTC')::date as used_on,
    sub_recipe_id,
    batches,
    recipe_changed_since,
    product_id,
    unit,
    /*
     * Cast, like the money columns elsewhere. Dividing through a batch yield
     * leaves unbounded numeric scale, and `4.00000000000000000000` printed
     * beside `4.00000` on the next report reads as two different figures —
     * METRICS.md §1.
     */
    sum(qty)::numeric(18,5) as qty,
    max(depth)              as deepest_level
  from expand
  where product_id is not null
    and qty is not null
    and qty <> 0
  group by org_id, production_record_id, occurred_at, sub_recipe_id,
           batches, recipe_changed_since, product_id, unit;

grant select on production_usage_theoretical to authenticated;

/*
 * Where the walk had to stop.
 *
 * A nested preparation with no batch yield cannot be scaled — two fifths of
 * an unknown quantity is not a number — so its ingredients are still missing
 * from the theoretical figure, and the variance for them still reads as
 * waste. The honest thing is not to guess but to say which records are
 * affected and which preparation is missing its yield, so somebody can fill
 * it in and the figure becomes real.
 *
 * Its own view rather than a flag on the rows above, because the records that
 * are wrong are exactly the ones that produce *no* row for the missing
 * ingredients — there is nothing to hang a flag on.
 */
create or replace view production_expansion_gaps
with (security_invoker = true) as
  with recursive walk as (
    select
      r.org_id,
      r.id                   as production_record_id,
      r.sub_recipe_id,
      sl.child_sub_recipe_id as child,
      1                      as depth
    from public.production_records_effective r
    join public.sub_recipe_lines sl on sl.sub_recipe_id = r.sub_recipe_id
    where sl.child_sub_recipe_id is not null

    union all

    select
      w.org_id, w.production_record_id, w.sub_recipe_id,
      sl.child_sub_recipe_id, w.depth + 1
    from walk w
    join public.sub_recipes s on s.id = w.child
    join public.sub_recipe_lines sl on sl.sub_recipe_id = w.child
    where sl.child_sub_recipe_id is not null
      and w.depth < 10
      and s.batch_yield_qty is not null
      and s.batch_yield_qty <> 0
  )
  select distinct
    w.org_id,
    w.production_record_id,
    w.sub_recipe_id,
    w.child            as unscalable_sub_recipe_id,
    s.name             as unscalable_name,
    w.depth
  from walk w
  join public.sub_recipes s on s.id = w.child
  where s.batch_yield_qty is null or s.batch_yield_qty = 0;

grant select on production_expansion_gaps to authenticated;

comment on view production_usage_theoretical is
  'What a production run should have consumed, exploded through every level of nested preparation to a depth of ten. 0060 expanded one level and silently dropped the rest, so every nested preparation read as pure waste. See 0111.';
comment on view production_expansion_gaps is
  'Production records whose explosion stopped at a preparation with no batch yield, so their theoretical figure is still short. Named rather than guessed at. See 0111.';
