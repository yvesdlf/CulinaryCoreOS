-- ---------------------------------------------------------------------------
-- The row that started the cascade goes in with it
-- ---------------------------------------------------------------------------
-- 0005 made the fan-out atomic: every sub-recipe and recipe a price change
-- touches is rewritten in one transaction, so a failure part-way can no
-- longer leave the database half re-costed while the screen shows the
-- finished result.
--
-- The row that *caused* the cascade was left outside it. Saving a product
-- fired two independent requests — `apply_cascade` for everything downstream,
-- and an UPDATE on the product itself — and both were dispatched without
-- waiting, so either could fail while the other committed.
--
-- Both failure directions are bad and they are bad in different ways:
--
--   The product update lands and the cascade does not. Every recipe using it
--   now costs from the old price. The figures are wrong and nothing says so,
--   because the product screen shows exactly what was saved.
--
--   The cascade lands and the product update does not. Worse, because it is
--   self-concealing: the recipes carry the new cost, the product still shows
--   the old price, and the arithmetic no longer reconciles — somebody
--   checking a dish against its ingredient finds a discrepancy with no edit
--   behind it.
--
-- So the primary row joins the transaction. Nothing about *what* is written
-- changes — the client sends the same mapped row it was sending to PostgREST,
-- and the optimistic-concurrency check behaves exactly as it did. Only the
-- number of transactions changes, from two to one.
--
-- The 2-argument version is dropped rather than left beside this one.
-- Postgres would keep both and a 2-argument call would then be ambiguous;
-- more to the point, leaving it would leave the old unsafe path callable,
-- and a safe route nobody is forced onto is a route somebody misses.
-- ---------------------------------------------------------------------------

drop function if exists public.apply_cascade(jsonb, jsonb);

/*
 * Apply one partial update, from jsonb, to one of two named tables.
 *
 * Built dynamically because the alternative is enumerating every column of
 * `products` and `sub_recipes` twice over — a list that is wrong the first
 * time somebody adds a column and silently drops that column's edits.
 *
 * It is injection-safe by construction rather than by inspection: the table
 * is matched against two literals, every key is checked against the column
 * catalogue for that table before it is used, and identifiers go through
 * `%I`. A key that is not a column of the table is ignored rather than
 * refused — PostgREST behaved that way too, and making this stricter would
 * change the behaviour of saves that work today.
 *
 * `jsonb_populate_record` does the type conversion per column, which is why
 * this can stay generic: a numeric column gets a numeric, a date gets a
 * date, and nothing is cast through text on the way.
 */
create or replace function public.apply_partial_update(
  p_table text, p_id uuid, p_row jsonb, p_expected_version integer
)
returns integer
language plpgsql
as $$
declare
  assignments text;
  affected integer;
begin
  if p_table not in ('products', 'sub_recipes') then
    raise exception 'apply_partial_update does not write %', p_table;
  end if;

  select string_agg(
           format('%I = (jsonb_populate_record(null::public.%I, $1)).%I',
                  k, p_table, k), ', ')
    into assignments
    from jsonb_object_keys(p_row) as k
   where exists (
     select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = p_table
        and c.column_name = k);

  -- Nothing recognised to write. Not an error: a caller that changed only
  -- the lines of a sub-recipe sends no row columns at all.
  if assignments is null then
    return 1;
  end if;

  if p_expected_version is null then
    execute format('update public.%I set %s where id = $2', p_table, assignments)
      using p_row, p_id;
  else
    execute format(
      'update public.%I set %s where id = $2 and version = $3',
      p_table, assignments)
      using p_row, p_id, p_expected_version;
  end if;

  get diagnostics affected = row_count;
  return affected;
end $$;

revoke all on function public.apply_partial_update(text, uuid, jsonb, integer)
  from public, anon;
/*
 * Callable by a signed-in user, because `apply_cascade` is `security
 * invoker` and could not otherwise reach it.
 *
 * That grants nothing new. This function is invoker too, so row-level
 * security, the section guards and every trigger on `products` and
 * `sub_recipes` apply exactly as they do to the UPDATE it replaces — which
 * the same client could already issue through PostgREST. The two tables it
 * will write are named in the function, not chosen by the caller.
 */
grant execute on function public.apply_partial_update(text, uuid, jsonb, integer)
  to authenticated;

create or replace function public.apply_cascade(
  p_sub_recipes jsonb default '[]'::jsonb,
  p_recipes     jsonb default '[]'::jsonb,
  p_primary     jsonb default null
)
returns void
language plpgsql
as $$
declare
  item jsonb;
  line jsonb;
  n int;
  primary_table text;
  primary_id uuid;
  expected_version integer;
begin
  /*
   * The row that started it, first.
   *
   * Order does not change any value — every figure in this call was computed
   * on the client before it was sent — but writing the cause before its
   * effects is the order somebody reading the log will expect.
   */
  if p_primary is not null then
    primary_table := case p_primary ->> 'entity'
                       when 'product' then 'products'
                       when 'sub_recipe' then 'sub_recipes'
                     end;
    if primary_table is null then
      raise exception 'a cascade cannot be started by a %', p_primary ->> 'entity';
    end if;

    primary_id := (p_primary ->> 'id')::uuid;
    expected_version := nullif(p_primary ->> 'expected_version', '')::integer;

    n := public.apply_partial_update(
           primary_table, primary_id,
           coalesce(p_primary -> 'row', '{}'::jsonb), expected_version);

    if n = 0 then
      /*
       * Two different failures, told apart, because the screen says
       * different things about them. With a version predicate the row moved
       * on under the editor and the save should offer to reload; without
       * one, the row is invisible or not writable and reloading changes
       * nothing. 0005 made the same distinction for the cascaded rows.
       */
      if expected_version is not null then
        raise exception 'this % was changed by somebody else',
          replace(p_primary ->> 'entity', '_', ' ')
          using errcode = '40001';
      end if;
      raise exception '% % not writable', p_primary ->> 'entity', primary_id
        using errcode = 'insufficient_privilege';
    end if;

    /*
     * A sub-recipe's own lines travel with it. The cascade below rewrites
     * the lines of everything *downstream*, and the edited sub-recipe is not
     * downstream of itself — `getDependents` starts its frontier at the
     * entity and collects what uses it — so without this the one set of
     * lines the person actually edited would be the one left outside the
     * transaction.
     */
    if primary_table = 'sub_recipes' and p_primary ? 'lines' then
      delete from public.sub_recipe_lines where sub_recipe_id = primary_id;

      for line in select * from jsonb_array_elements(coalesce(p_primary -> 'lines', '[]'::jsonb))
      loop
        insert into public.sub_recipe_lines (
          sub_recipe_id, line_number, product_id, child_sub_recipe_id,
          nett_qty, nett_unit, ref_percent, gross_qty, gross_unit,
          cost_per_unit, line_cost
        ) values (
          primary_id,
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
    end if;
  end if;

  -- ── Sub-recipes ──────────────────────────────────────────────────────────
  for item in select * from jsonb_array_elements(p_sub_recipes)
  loop
    update public.sub_recipes s
       set total_cost    = (item ->> 'total_cost')::numeric,
           cost_per_unit = (item ->> 'cost_per_unit')::numeric,
           allergens     = coalesce(
                             (select array_agg(value::text)
                                from jsonb_array_elements_text(item -> 'allergens')),
                             s.allergens
                           ),
           version       = s.version + 1
     where s.id = (item ->> 'id')::uuid;

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
       set menu_price           = (item ->> 'menu_price')::numeric,
           price_incl_tax       = (item ->> 'price_incl_tax')::numeric,
           total_cost           = (item ->> 'total_cost')::numeric,
           waste_amount         = (item ->> 'waste_amount')::numeric,
           inflation_amount     = (item ->> 'inflation_amount')::numeric,
           total_cog            = (item ->> 'total_cog')::numeric,
           gross_profit         = (item ->> 'gross_profit')::numeric,
           gross_profit_percent = (item ->> 'gross_profit_percent')::numeric,
           food_cost_percent    = (item ->> 'food_cost_percent')::numeric,
           allergens            = coalesce(
                                    (select array_agg(value::text)
                                       from jsonb_array_elements_text(item -> 'allergens')),
                                    r.allergens
                                  ),
           version              = r.version + 1
     where r.id = (item ->> 'id')::uuid;

    get diagnostics n = row_count;
    if n = 0 then
      raise exception 'recipe % not writable', item ->> 'id'
        using errcode = 'insufficient_privilege';
    end if;

    delete from public.recipe_lines
     where recipe_id = (item ->> 'id')::uuid;

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
end $$;

comment on function public.apply_cascade(jsonb, jsonb, jsonb) is
  'One transaction for a price change and everything it re-costs, including the row that caused it. Before 0117 the primary row was a separate request and could commit or fail independently. See 0117.';
