-- ---------------------------------------------------------------------------
-- apply_cascade: write the columns the app actually derives
-- ---------------------------------------------------------------------------
-- 0005 was written before 0006 reshaped recipe pricing around menu_price /
-- total_cog. It still wrote price_excl_vat, total_cost_with_margin and
-- gross_contribution_margin, which are now the deprecated names, and the
-- client had already stopped sending them — those keys resolve to undefined,
-- so every cascade quietly wrote NULL over the three of them while reporting
-- success. It also never touched waste_amount, inflation_amount, total_cog,
-- gross_profit, price_incl_tax, or the inherited allergens and free-from
-- flags, so those went stale the moment a price moved.
--
-- Legacy columns are kept in step rather than dropped: nothing has migrated
-- off them yet, and a cascade that leaves two representations disagreeing is
-- worse than one that maintains both.
-- ---------------------------------------------------------------------------

create or replace function public.apply_cascade(
  p_sub_recipes jsonb default '[]'::jsonb,
  p_recipes     jsonb default '[]'::jsonb
)
returns void
language plpgsql
as $$
declare
  item jsonb;
  line jsonb;
  n int;
begin
  -- ── Sub-recipes ──────────────────────────────────────────────────────────
  for item in select * from jsonb_array_elements(p_sub_recipes)
  loop
    update public.sub_recipes s
       set total_cost    = (item ->> 'total_cost')::numeric,
           cost_per_unit = (item ->> 'cost_per_unit')::numeric,
           -- Inherited, so it travels with the cost that shares its edges.
           allergens     = coalesce(
                             (select array_agg(value::text)
                                from jsonb_array_elements_text(item -> 'allergens')),
                             s.allergens
                           ),
           version       = s.version + 1
     where s.id = (item ->> 'id')::uuid;

    -- Row invisible or not writable under RLS: fail loudly rather than
    -- silently skipping part of the cascade.
    get diagnostics n = row_count;
    if n = 0 then
      raise exception 'sub_recipe % not writable', item ->> 'id'
        using errcode = 'insufficient_privilege';
    end if;

    delete from public.sub_recipe_lines
     where sub_recipe_id = (item ->> 'id')::uuid;

    for line in select * from jsonb_array_elements(coalesce(item -> 'lines', '[]'::jsonb))
    loop
      insert into public.sub_recipe_lines (
        sub_recipe_id, line_number, product_id, child_sub_recipe_id,
        nett_qty, nett_unit, ref_percent, gross_qty, gross_unit,
        cost_per_unit, line_cost
      ) values (
        (item ->> 'id')::uuid,
        (line ->> 'line_number')::int,
        nullif(line ->> 'product_id', '')::uuid,
        nullif(line ->> 'sub_recipe_id', '')::uuid,
        (line ->> 'nett_qty')::numeric,
        line ->> 'nett_unit',
        (line ->> 'ref_percent')::numeric,
        (line ->> 'gross_qty')::numeric,
        line ->> 'gross_unit',
        (line ->> 'cost_per_unit')::numeric,
        (line ->> 'line_cost')::numeric
      );
    end loop;
  end loop;

  -- ── Recipes ──────────────────────────────────────────────────────────────
  for item in select * from jsonb_array_elements(p_recipes)
  loop
    update public.recipes r
       set menu_price        = coalesce((item ->> 'menu_price')::numeric, r.menu_price),
           price_incl_tax    = (item ->> 'price_incl_tax')::numeric,
           total_cost        = (item ->> 'total_cost')::numeric,
           waste_amount      = (item ->> 'waste_amount')::numeric,
           inflation_amount  = (item ->> 'inflation_amount')::numeric,
           total_cog         = (item ->> 'total_cog')::numeric,
           gross_profit      = (item ->> 'gross_profit')::numeric,
           gross_profit_percent = (item ->> 'gross_profit_percent')::numeric,
           food_cost_percent = (item ->> 'food_cost_percent')::numeric,

           -- Kept in step until something migrates off them.
           price_excl_vat            = coalesce((item ->> 'menu_price')::numeric, r.menu_price),
           total_cost_with_margin    = (item ->> 'total_cog')::numeric,
           gross_contribution_margin = (item ->> 'gross_profit')::numeric,

           allergens = coalesce(
                         (select array_agg(value::text)
                            from jsonb_array_elements_text(item -> 'allergens')),
                         r.allergens
                       ),
           -- Free-from claims are assertions about the allergen list, so they
           -- are only ever written together with it.
           gluten_free   = coalesce((item ->> 'gluten_free')::boolean,   r.gluten_free),
           dairy_free    = coalesce((item ->> 'dairy_free')::boolean,    r.dairy_free),
           nuts_free     = coalesce((item ->> 'nuts_free')::boolean,     r.nuts_free),
           soy_free      = coalesce((item ->> 'soy_free')::boolean,      r.soy_free),
           sulfites_free = coalesce((item ->> 'sulfites_free')::boolean, r.sulfites_free),

           version = r.version + 1
     where r.id = (item ->> 'id')::uuid;

    get diagnostics n = row_count;
    if n = 0 then
      raise exception 'recipe % not writable', item ->> 'id'
        using errcode = 'insufficient_privilege';
    end if;

    delete from public.recipe_lines where recipe_id = (item ->> 'id')::uuid;

    for line in select * from jsonb_array_elements(coalesce(item -> 'lines', '[]'::jsonb))
    loop
      insert into public.recipe_lines (
        recipe_id, line_number, product_id, sub_recipe_id,
        nett_qty, nett_unit, ref_percent, gross_qty, gross_unit,
        cost_per_unit, line_cost
      ) values (
        (item ->> 'id')::uuid,
        (line ->> 'line_number')::int,
        nullif(line ->> 'product_id', '')::uuid,
        nullif(line ->> 'sub_recipe_id', '')::uuid,
        (line ->> 'nett_qty')::numeric,
        line ->> 'nett_unit',
        (line ->> 'ref_percent')::numeric,
        (line ->> 'gross_qty')::numeric,
        line ->> 'gross_unit',
        (line ->> 'cost_per_unit')::numeric,
        (line ->> 'line_cost')::numeric
      );
    end loop;
  end loop;
end;
$$;

grant execute on function public.apply_cascade(jsonb, jsonb) to authenticated;
