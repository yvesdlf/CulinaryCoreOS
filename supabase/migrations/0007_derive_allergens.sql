-- ---------------------------------------------------------------------------
-- Inherited allergens
-- ---------------------------------------------------------------------------
-- Allergens are declared on products and inherited by everything built on them.
-- The app derives them in the cascade, but that only fires when something
-- changes: the 1.106 products / 112 sub-recipes / 115 recipes imported from
-- COGS V5 were written with empty arrays and would stay empty until a human
-- opened and saved each of 227 pages.
--
-- This backfills them, and leaves the function in place so the derivation can
-- be re-run after any bulk import without going through the UI.
--
-- The sub-recipe pass iterates to a fixed point rather than recursing. Nothing
-- in the schema prevents two sub-recipes referencing each other (0001 only
-- blocks direct self-reference), and a recursive CTE over a cycle would not
-- terminate. Iterating bounded by the row count cannot.
-- ---------------------------------------------------------------------------

create or replace function derive_allergens()
returns table (sub_recipes_updated int, recipes_updated int)
language plpgsql
as $$
declare
  passes  int := 0;
  guard   int;
  touched int;
  subs    int := 0;
  recs    int := 0;
begin
  -- One pass propagates one level of nesting. A chain can be at most as long
  -- as there are sub-recipes, so that is the ceiling; a cycle simply stops
  -- producing changes and exits early.
  select count(*) into guard from sub_recipes;

  loop
    passes := passes + 1;

    with derived as (
      select
        s.id,
        coalesce(
          (select array_agg(distinct a order by a)
             from sub_recipe_lines l
             left join products    p on p.id = l.product_id
             left join sub_recipes c on c.id = l.child_sub_recipe_id
             cross join lateral unnest(
               coalesce(p.allergens, '{}') || coalesce(c.allergens, '{}')
             ) as a
            where l.sub_recipe_id = s.id),
          '{}'
        ) as allergens
      from sub_recipes s
    )
    update sub_recipes s
       set allergens = d.allergens
      from derived d
     where d.id = s.id
       -- Comparing sorted arrays, so this is a genuine change, not a reorder.
       and d.allergens is distinct from s.allergens;

    get diagnostics touched = row_count;
    subs := subs + touched;

    exit when touched = 0 or passes > guard;
  end loop;

  -- Recipes are leaves: nothing is built on a recipe, so one pass is enough.
  with derived as (
    select
      r.id,
      coalesce(
        (select array_agg(distinct a order by a)
           from recipe_lines l
           left join products    p on p.id = l.product_id
           left join sub_recipes s on s.id = l.sub_recipe_id
           cross join lateral unnest(
             coalesce(p.allergens, '{}') || coalesce(s.allergens, '{}')
           ) as a
          where l.recipe_id = r.id),
        '{}'
      ) as allergens
    from recipes r
  )
  update recipes r
     set allergens = d.allergens
    from derived d
   where d.id = r.id
     and d.allergens is distinct from r.allergens;

  get diagnostics recs = row_count;

  -- The free-from booleans are claims about the allergen list, so they are
  -- derived from it rather than stored independently and allowed to drift.
  -- Vegetarian and vegan are not touched: no allergen list implies them.
  --
  -- An unrecognised declaration fails every claim closed. "Free from" asserts
  -- an absence, and an allergen we cannot identify is exactly the case where
  -- absence has not been established.
  update recipes r
     set gluten_free =
           not exists (select 1 from unnest(r.allergens) a
                        where a = 'EU14_GLUTEN_CEREALS' or a <> all (known.ids)),
         dairy_free =
           not exists (select 1 from unnest(r.allergens) a
                        where a = 'EU14_MILK' or a <> all (known.ids)),
         nuts_free =
           not exists (select 1 from unnest(r.allergens) a
                        where a in ('EU14_TREE_NUTS', 'EU14_PEANUTS')
                           or a <> all (known.ids)),
         soy_free =
           not exists (select 1 from unnest(r.allergens) a
                        where a = 'EU14_SOYBEANS' or a <> all (known.ids)),
         sulfites_free =
           not exists (select 1 from unnest(r.allergens) a
                        where a = 'EU14_SULPHITES' or a <> all (known.ids))
    from (select array[
            'EU14_CELERY', 'EU14_GLUTEN_CEREALS', 'EU14_CRUSTACEANS',
            'EU14_EGGS', 'EU14_FISH', 'EU14_LUPIN', 'EU14_MILK',
            'EU14_MOLLUSCS', 'EU14_MUSTARD', 'EU14_PEANUTS', 'EU14_SESAME',
            'EU14_SOYBEANS', 'EU14_SULPHITES', 'EU14_TREE_NUTS'
          ] as ids) known
   where true;

  return query select subs, recs;
end;
$$;

comment on function derive_allergens() is
  'Recompute inherited allergens for every sub-recipe and recipe from product '
  'declarations. Safe to re-run; run after any bulk import.';

select * from derive_allergens();
