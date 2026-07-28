-- CulinaryCoreOS — table privileges and Row Level Security.
--
-- Tables created inside a migration are owned by `postgres` and do not pick up
-- the default grants Supabase applies to objects made through its own tooling,
-- so PostgREST answered every request with:
--   42501: permission denied for table products
--
-- Two separate things are needed and it is easy to confuse them:
--   * GRANT controls whether the role may touch the table at all.
--   * RLS policies then filter which rows it may see or change.
-- A grant without RLS is an open table; RLS without a grant is a closed one.
--
-- ============================================================================
-- WARNING — THE POLICIES BELOW ARE DELIBERATELY WIDE OPEN.
--
-- `using (true)` means any holder of the anon key can read and write every
-- row. That is acceptable only for a local, single-tenant development database
-- with no real data in it. Do NOT deploy this to a hosted project.
--
-- Closing it needs the tenancy model first (SRS 4.15): an organizations table,
-- an org_id column on each table below, and policies that compare org_id to
-- the caller's JWT claim. Tracked in docs/PROGRESS.md.
--
-- RLS is switched on here anyway, rather than left off with bare grants,
-- because tightening an existing policy is a much smaller and safer change
-- than remembering to enable RLS on a table that never had it.
-- ============================================================================

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on
  products, sub_recipes, sub_recipe_lines, recipes, recipe_lines
  to anon, authenticated;

alter table products         enable row level security;
alter table sub_recipes      enable row level security;
alter table sub_recipe_lines enable row level security;
alter table recipes          enable row level security;
alter table recipe_lines     enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'products', 'sub_recipes', 'sub_recipe_lines', 'recipes', 'recipe_lines'
  ] loop
    execute format('drop policy if exists dev_open_access on %I', t);
    -- Single FOR ALL policy: `using` gates read/update/delete, `with check`
    -- gates the rows insert/update may write.
    execute format(
      'create policy dev_open_access on %I for all to anon, authenticated '
      'using (true) with check (true)', t);
  end loop;
end;
$$;
