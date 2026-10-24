-- ---------------------------------------------------------------------------
-- A merge keeps the history and the name
-- ---------------------------------------------------------------------------
-- Two things, found together because looking at the first exposed the
-- second.
--
-- 1 · Aliases. Merging two duplicate products throws away the losing name,
--     so the next price list, the next import and the next search for it
--     create the duplicate again. `merge_products` has existed since 0011
--     and the catalogue still accumulates them.
--
-- 2 · The merge destroys the stock ledger, which is a defect and not a
--     design. `merge_products` repoints `recipe_lines` and
--     `sub_recipe_lines` and then deletes the loser — and eight tables
--     cascade on a product delete:
--
--       stock_movements, stock_lots, product_suppliers, contract_prices,
--       product_pour, product_unit_conversions, housekeeping_consumables,
--       stocktake_lines
--
--     So merging two duplicates silently deleted one of them's entire stock
--     history and its lot traceability. `AGENTS.md` §4 says those ledgers
--     append and have no delete grant; a cascade is a delete that got in
--     through the side door. 178/2002 Article 18 is the law the lot history
--     exists to satisfy.
--
--     It now repoints every table that references a product, then deletes a
--     row nothing points at any more. Where a unique constraint would
--     collide — two rows for the same supplier, the same pour measure, the
--     same conversion — the survivor's row wins and the loser's is dropped,
--     because they describe the same product and keeping both would be
--     ambiguous rather than safe.
--
-- `pg_trgm` is enabled for the alias and name search both briefs ask for:
-- an import matching "Tom. Vine Rip." to "Tomato (Vine-Ripened)" needs
-- similarity, not equality.
-- ---------------------------------------------------------------------------

/*
 * Into `extensions`, not `public`.
 *
 * The first draft put it in `public` and 23_exposure.sql went red within
 * the minute: installing an extension there makes its thirty-odd functions
 * executable by PUBLIC, the role everybody has, and that file exists to
 * assert nothing in `public` is. Supabase keeps extensions in their own
 * schema for exactly this reason.
 *
 * Everything below therefore qualifies `extensions.similarity` and
 * `extensions.gin_trgm_ops`, because these functions run with
 * `search_path = ''` and can name nothing they do not spell out.
 */
create schema if not exists extensions;

-- Moved rather than dropped and recreated: a drop takes the trigram indexes
-- with it, and on a database that already has them that is a rebuild of
-- every index for no reason. `set schema` carries the operator classes too,
-- so existing indexes stay valid.
do $$
begin
  if exists (
    select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
     where e.extname = 'pg_trgm' and n.nspname <> 'extensions'
  ) then
    execute 'alter extension pg_trgm set schema extensions';
  end if;
end $$;

create extension if not exists pg_trgm with schema extensions;

create table if not exists product_aliases (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,

  alias text not null,
  /* manual, merge, import or supplier — where the name came from. */
  source text not null default 'manual',
  note text,
  created_at timestamptz not null default now(),

  constraint product_aliases_named check (btrim(alias) <> ''),
  constraint product_aliases_source
    check (source in ('manual', 'merge', 'import', 'supplier'))
);

create unique index if not exists idx_product_aliases_unique
  on product_aliases(org_id, lower(btrim(alias)));
create index if not exists idx_product_aliases_trgm
  on product_aliases using gin (alias extensions.gin_trgm_ops);
create index if not exists idx_products_name_trgm
  on products using gin (name extensions.gin_trgm_ops);

create or replace function public.set_alias_org()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent_org uuid;
begin
  select p.org_id into parent_org from public.products p where p.id = new.product_id;
  if parent_org is null then raise exception 'no such product'; end if;
  new.org_id := parent_org;
  return new;
end $$;

drop trigger if exists product_aliases_set_org on product_aliases;
create trigger product_aliases_set_org before insert on product_aliases
  for each row execute function public.set_alias_org();

/*
 * Find a product by name or by anything it has ever been called.
 *
 * Similarity rather than equality, because the names on a supplier's price
 * list are not the names in the catalogue and never will be. The threshold
 * is a parameter of the call rather than a constant: an import wants to be
 * generous and offer candidates, a background match wants to be strict.
 */
create or replace function public.find_products(
  p_org uuid, p_text text, p_threshold real default 0.3
)
returns table (product_id uuid, name text, matched text, score real)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.name, m.matched, m.score
    from public.products p
    join lateral (
      select x.matched, x.score
        from (
          select p.name as matched, extensions.similarity(p.name, p_text) as score
          union all
          select a.alias, extensions.similarity(a.alias, p_text)
            from public.product_aliases a where a.product_id = p.id
        ) x
       order by x.score desc
       limit 1
    ) m on true
   where p.org_id = p_org
     and m.score >= p_threshold
   order by m.score desc, p.name
   limit 25;
$$;

/*
 * The merge, rewritten.
 *
 * Every reference is repointed before anything is deleted, so no cascade
 * ever fires on a row that still matters. The loser's name becomes an
 * alias, which is the whole point: a duplicate that is merged and forgotten
 * comes back on the next import.
 *
 * Kept as `merge_products` with its original signature, because the
 * duplicates screen calls it and this is a correction to what it does
 * rather than a different thing.
 */
create or replace function public.merge_products(p_survivor uuid, p_losers uuid[])
returns table (recipe_lines_moved int, sub_recipe_lines_moved int, products_removed int)
language plpgsql security definer set search_path = ''
as $$
declare r int; s int; d int;
begin
  if p_survivor = any(p_losers) then
    raise exception 'the survivor cannot also be a loser'
      using errcode = 'invalid_parameter_value';
  end if;

  if not exists (select 1 from public.products where id = p_survivor) then
    raise exception 'survivor % not found or not writable', p_survivor
      using errcode = 'insufficient_privilege';
  end if;

  -- The losing names, kept. Conflicts are ignored: if the survivor already
  -- answers to that name there is nothing to add.
  insert into public.product_aliases (product_id, alias, source, note)
  select p_survivor, p.name, 'merge',
         'Merged into ' || (select name from public.products where id = p_survivor)
    from public.products p
   where p.id = any(p_losers) and btrim(p.name) <> ''
  on conflict do nothing;

  insert into public.product_aliases (product_id, alias, source, note)
  select p_survivor, a.alias, a.source, a.note
    from public.product_aliases a
   where a.product_id = any(p_losers)
  on conflict do nothing;

  /*
   * Ledgers and documents: repointed, never cascaded.
   *
   * These are the eight that used to be deleted silently. stock_movements
   * and stock_lots are the ones that matter most — the second is what
   * 178/2002 Article 18 traceability is built on.
   */
  update public.stock_movements set product_id = p_survivor where product_id = any(p_losers);
  update public.stock_lots set product_id = p_survivor where product_id = any(p_losers);
  update public.goods_receipt_lines set product_id = p_survivor where product_id = any(p_losers);
  update public.purchase_order_lines set product_id = p_survivor where product_id = any(p_losers);
  update public.requisition_lines set product_id = p_survivor where product_id = any(p_losers);
  update public.supplier_invoice_lines set product_id = p_survivor where product_id = any(p_losers);
  update public.supplier_return_lines set product_id = p_survivor where product_id = any(p_losers);
  update public.rfq_lines set product_id = p_survivor where product_id = any(p_losers);
  update public.menu_item_modifiers set product_id = p_survivor where product_id = any(p_losers);
  update public.contract_prices set product_id = p_survivor where product_id = any(p_losers);

  /*
   * Where a unique constraint would collide the survivor's row wins.
   *
   * They describe the same product, so keeping both would be ambiguous
   * rather than safe — two "preferred supplier" rows, two pour measures,
   * two answers to what a bunch weighs.
   */
  delete from public.product_suppliers l
   where l.product_id = any(p_losers)
     and exists (select 1 from public.product_suppliers k
                  where k.product_id = p_survivor and k.supplier_id = l.supplier_id);
  update public.product_suppliers set product_id = p_survivor where product_id = any(p_losers);

  delete from public.product_unit_conversions l
   where l.product_id = any(p_losers)
     and exists (select 1 from public.product_unit_conversions k
                  where k.product_id = p_survivor
                    and k.from_unit = l.from_unit and k.to_unit = l.to_unit);
  update public.product_unit_conversions set product_id = p_survivor where product_id = any(p_losers);

  delete from public.product_pour l
   where l.product_id = any(p_losers)
     and exists (select 1 from public.product_pour k where k.product_id = p_survivor);
  update public.product_pour set product_id = p_survivor where product_id = any(p_losers);

  delete from public.housekeeping_consumables l
   where l.product_id = any(p_losers)
     and exists (select 1 from public.housekeeping_consumables k
                  where k.product_id = p_survivor
                    and k.room_type_id is not distinct from l.room_type_id
                    and k.kind is not distinct from l.kind);
  update public.housekeeping_consumables set product_id = p_survivor where product_id = any(p_losers);

  delete from public.stocktake_lines l
   where l.product_id = any(p_losers)
     and exists (select 1 from public.stocktake_lines k
                  where k.stocktake_id = l.stocktake_id and k.product_id = p_survivor);
  update public.stocktake_lines set product_id = p_survivor where product_id = any(p_losers);

  update public.recipe_lines set product_id = p_survivor where product_id = any(p_losers);
  get diagnostics r = row_count;
  update public.sub_recipe_lines set product_id = p_survivor where product_id = any(p_losers);
  get diagnostics s = row_count;

  -- Nothing points at them now, so nothing cascades.
  delete from public.products where id = any(p_losers);
  get diagnostics d = row_count;

  return query select r, s, d;
end;
$$;

alter table product_aliases enable row level security;

drop policy if exists product_aliases_read on product_aliases;
create policy product_aliases_read on product_aliases for select to authenticated
  using (org_id in (select public.auth_org_ids()));
drop policy if exists product_aliases_write on product_aliases;
create policy product_aliases_write on product_aliases for insert to authenticated
  with check (public.auth_can_write(org_id));
drop policy if exists product_aliases_delete on product_aliases;
create policy product_aliases_delete on product_aliases for delete to authenticated
  using (public.auth_can_write(org_id));

grant select, insert, delete on product_aliases to authenticated;

drop trigger if exists product_aliases_section_guard on product_aliases;
create trigger product_aliases_section_guard
  before insert or update or delete on product_aliases
  for each row execute function public.require_section_write('RECIPES');

delete from public.section_read_rules where table_name = 'product_aliases';
insert into public.section_read_rules (table_name, section_code, shared_because)
values ('product_aliases', null,
        'what a product has ever been called, needed wherever one is matched by name');

comment on table product_aliases is
  'Every name a product has answered to. A merged duplicate keeps its name here or it comes back on the next import. See 0103.';
comment on function public.merge_products(uuid, uuid[]) is
  'Repoints every reference before deleting, so a merge no longer cascades away the stock ledger and lot history. See 0103.';
