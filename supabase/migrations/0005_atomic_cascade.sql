-- CulinaryCoreOS — apply a cost cascade in a single transaction.
--
-- A product price change re-costs every dependent sub-recipe and recipe. The
-- client was sending that as a fan-out of independent PostgREST calls: one
-- UPDATE per entity, each followed by a DELETE and re-INSERT of its ingredient
-- lines. A failure part-way through left Postgres half-updated while the UI
-- showed the complete, consistent result — precisely the state a costing
-- system must never be in.
--
-- A function body is a single transaction, so everything here commits or none
-- of it does.
--
-- SECURITY INVOKER (the default) is deliberate: the statements below run as the
-- caller, so the tenant policies from 0004 still apply. Marking this SECURITY
-- DEFINER would hand any signed-in user a way to write across tenants.

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
       set price_excl_vat            = (item ->> 'price_excl_vat')::numeric,
           total_cost                = (item ->> 'total_cost')::numeric,
           total_cost_with_margin    = (item ->> 'total_cost_with_margin')::numeric,
           gross_contribution_margin = (item ->> 'gross_contribution_margin')::numeric,
           food_cost_percent         = (item ->> 'food_cost_percent')::numeric,
           version                   = r.version + 1
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
