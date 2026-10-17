-- ---------------------------------------------------------------------------
-- The variance has a value, and a caveat it has to carry
-- ---------------------------------------------------------------------------
-- 0092 built `food_cost_variance` as the two sides of food cost side by side:
-- what the recipes say went out, and what the counts corrected. Two things
-- were missing before a screen could be honest about it.
--
-- A value on the theoretical side. The count adjustment was already priced
-- and the theoretical quantity was not, so the two columns could not be
-- compared in money and the list could not be ranked by what matters. Four
-- hundred missing cocktail sticks and four hundred grams of missing saffron
-- sort identically by quantity.
--
-- And the caveat. The number this view produces is only as good as its
-- inputs, and both inputs are routinely incomplete in ways that are
-- invisible in the result:
--
--   A product that has never been counted has no actual side at all. Its
--   variance is not zero, it is unknown, and a zero in that column is the
--   single most misleading thing this view could print.
--
--   A product whose dishes are sold under a till code nobody has mapped has
--   an understated theoretical side, because 0092 posts consumption from the
--   recipe and an unmapped line has no recipe. Food cost looks better than
--   it is, which is the direction nobody questions.
--
-- Both are now columns rather than something a screen remembers to mention.
-- A caveat that lives in the interface is a caveat that is missing from the
-- export, the API and the next screen somebody builds.
-- ---------------------------------------------------------------------------

/*
 * Dropped and recreated rather than replaced: `create or replace view`
 * cannot insert a column into the middle of the list, and
 * `theoretical_value` belongs beside the quantity it prices rather than
 * tacked on the end where nobody reading the two side by side would find
 * it. Nothing depends on this view yet — it was created in 0092 and the
 * screen that reads it is being written now.
 */
drop view if exists food_cost_variance;
create view food_cost_variance
with (security_invoker = true) as
  select
    p.org_id,
    p.id                     as product_id,
    p.name                   as product_name,
    p.category,
    coalesce(theo.qty, 0)::numeric(18,5)       as theoretical_used,
    (coalesce(theo.qty, 0) * coalesce(p.gross_price_per_unit, 0))::numeric(18,5)
                                               as theoretical_value,
    coalesce(cnt.adjustment, 0)::numeric(18,5) as count_adjustment,
    coalesce(cnt.counts, 0)                    as counts_behind_it,
    (coalesce(cnt.adjustment, 0) * coalesce(p.gross_price_per_unit, 0))::numeric(18,5)
                                               as adjustment_value,
    cnt.last_counted_at,

    /*
     * Never counted, so there is no actual side.
     *
     * The adjustment reads 0 for this product and 0 is also what a perfect
     * count looks like. Without this flag the two are indistinguishable and
     * the most incomplete rows look like the best ones.
     */
    (cnt.adjustment is null)                   as never_counted,

    /*
     * Sold under a code nothing maps.
     *
     * 0092 posts consumption from the recipe, and a sales line with no
     * recipe posts none — so this product's theoretical usage is understated
     * by however much of it went out under an unmapped button. There is no
     * way to know how much, which is why this is a flag and not a number.
     */
    exists (
      select 1
        from public.sales_lines sl
       where sl.org_id = p.org_id
         and sl.recipe_id is null
         and sl.pos_item_code is not null
         and not exists (
           select 1 from public.menu_items mi
            where mi.org_id = sl.org_id
              and lower(btrim(mi.pos_item_code)) = lower(btrim(sl.pos_item_code))
         )
    )                                          as sales_partly_unmapped

  from public.products p
  left join (
    select m.product_id, -sum(m.quantity) as qty
      from public.stock_movements m
     where m.kind = 'USAGE' and m.reason = 'sales'
     group by m.product_id
  ) theo on theo.product_id = p.id
  left join (
    select m.product_id,
           sum(m.quantity) as adjustment,
           count(*)        as counts,
           max(m.occurred_at) as last_counted_at
      from public.stock_movements m
     where m.kind = 'COUNT'
     group by m.product_id
  ) cnt on cnt.product_id = p.id
  where theo.qty is not null or cnt.adjustment is not null;

grant select on food_cost_variance to authenticated;

comment on view food_cost_variance is
  'Theoretical consumption against what the counts corrected, priced, and carrying the two ways it can be incomplete. See 0097.';
