-- ---------------------------------------------------------------------------
-- Merging duplicates
-- ---------------------------------------------------------------------------
-- A catalogue built from spreadsheets carries the same ingredient twice —
-- "Shallot" and "Shallots" at the same price from the same supplier. Two rows
-- for one ingredient means two prices to keep current, and whichever a recipe
-- happens to point at is the one it costs from.
--
-- Merging is repointing, not deleting-and-hoping: every line that referenced
-- the losing row is moved to the survivor first, and only then is the loser
-- removed. Done as one function so it is one transaction — a merge that
-- repointed half the lines and then failed would leave dishes costing from a
-- row that no longer exists.
--
-- SECURITY INVOKER, like apply_cascade: the statements run as the caller, so
-- the tenant policies still decide what can be touched.
-- ---------------------------------------------------------------------------

create or replace function public.merge_products(
  p_survivor uuid,
  p_losers   uuid[]
)
returns table (recipe_lines_moved int, sub_recipe_lines_moved int, products_removed int)
language plpgsql
as $$
declare
  r int; s int; d int;
begin
  if p_survivor = any(p_losers) then
    raise exception 'the survivor cannot also be a loser'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Fail before touching anything if the survivor is not visible to us; a
  -- merge into a row we cannot write would move lines to a dead end.
  if not exists (select 1 from public.products where id = p_survivor) then
    raise exception 'survivor % not found or not writable', p_survivor
      using errcode = 'insufficient_privilege';
  end if;

  update public.recipe_lines set product_id = p_survivor
   where product_id = any(p_losers);
  get diagnostics r = row_count;

  update public.sub_recipe_lines set product_id = p_survivor
   where product_id = any(p_losers);
  get diagnostics s = row_count;

  delete from public.products where id = any(p_losers);
  get diagnostics d = row_count;

  return query select r, s, d;
end;
$$;

comment on function public.merge_products(uuid, uuid[]) is
  'Repoint every ingredient line from the losing products onto the survivor, '
  'then remove them. One transaction.';

grant execute on function public.merge_products(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Supplier names are a string on many rows rather than a reference, so
-- standardising a spelling is a rewrite rather than a repoint.
-- ---------------------------------------------------------------------------

create or replace function public.merge_supplier_names(
  p_survivor text,
  p_losers   text[]
)
returns int
language plpgsql
as $$
declare
  n int;
begin
  update public.products set supplier = p_survivor
   where supplier = any(p_losers) and supplier is distinct from p_survivor;
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.merge_supplier_names(text, text[]) is
  'Rewrite alternative spellings of a supplier onto one name.';

grant execute on function public.merge_supplier_names(text, text[]) to authenticated;
