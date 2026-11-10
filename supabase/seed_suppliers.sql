-- ---------------------------------------------------------------------------
-- Suppliers, from the names the catalogue already carries
-- ---------------------------------------------------------------------------
-- `products.supplier` is a legacy free-text column: the name somebody typed in
-- the workbook. `products.supplier_id` is the real reference and nothing has
-- ever filled it in, so every supplier-shaped feature — ordering from a
-- supplier, contract prices, the vendor portal, spend by supplier — had no data
-- to work on.
--
-- This promotes the text into records and links the products back.
--
-- Folded case-insensitively, because the workbook contains both "UD Astungkara
-- Lancar" and "UD Astungkara lancar" and they are one company with one delivery
-- day and one invoice. Taking them as two would split their spend in half in
-- every report and is exactly the kind of duplicate the app has a whole page
-- for finding.
--
-- The longest spelling wins, on the theory that "UD Astungkara Lancar" is the
-- one somebody typed carefully and the variants are what happened afterwards.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

do $$
declare
  org uuid;
  made integer;
  linked integer;
begin
  /*
   * `into strict`, and the same rule in every seed file.
   *
   * Three of these picked `order by created_at limit 1` — the oldest
   * organisation — and three picked the one named 'Demo Kitchen'. On a
   * laptop with a single venue the two rules agree by accident, which is why
   * it never showed. On a database with two they split: seeding a hosted
   * staging project put the suppliers, the stock and twelve employees into an
   * empty organisation left over from an earlier session, and the takings
   * into the real one, where there were then no outlets to attribute revenue
   * to. Neither half complained.
   *
   * `strict` because the failure to avoid is not "no venue" — it is picking
   * the wrong one silently.
   */
  begin
    select id into strict org from public.organizations where name = 'Demo Kitchen';
  exception
    when no_data_found then
      raise exception 'no organisation called "Demo Kitchen"'
        using hint = 'Run seed.sql first, or rename the venue you want seeded.';
    when too_many_rows then
      raise exception 'more than one organisation is called "Demo Kitchen"'
        using hint = 'The seeds cannot tell which venue you mean. Rename all but one.';
  end;

  with named as (
    select
      lower(btrim(p.supplier)) as folded,
      btrim(p.supplier) as spelling,
      count(*) as lines
    from public.products p
    where p.org_id = org
      and p.supplier is not null
      and btrim(p.supplier) <> ''
    group by 1, 2
  ),
  best as (
    select distinct on (folded)
      folded,
      spelling
    from named
    -- The most carefully typed spelling: longest, then the most used.
    order by folded, length(spelling) desc, lines desc
  )
  insert into public.suppliers (org_id, name, status, lead_time_days, payment_terms_days)
  select
    org,
    best.spelling,
    'ACTIVE'::public.supplier_status,
    -- Plausible defaults so lead time and terms are not null everywhere; a
    -- buyer corrects them on the supplier page as they come up.
    3,
    30
  from best
  where not exists (
    select 1 from public.suppliers s
     where s.org_id = org and lower(s.name) = best.folded
  );

  get diagnostics made = row_count;

  update public.products p
     set supplier_id = s.id
    from public.suppliers s
   where p.org_id = org
     and s.org_id = org
     and p.supplier_id is null
     and p.supplier is not null
     and lower(btrim(p.supplier)) = lower(s.name);

  get diagnostics linked = row_count;

  /*
   * And the link rows behind that column.
   *
   * 0046 backfills product_suppliers from products.supplier_id, but a database
   * rebuilt from its own migrations runs that before any product exists — so
   * the backfill finds nothing and this seed then sets supplier_id without the
   * link row that is supposed to be its source. The result was 730 products
   * with a supplier and an empty link table, which is precisely the drift the
   * mirrored column is meant to be incapable of.
   *
   * Preferred, because it is the only supplier on record. The price comes from
   * what the venue currently pays, which is what that supplier charges.
   */
  insert into public.product_suppliers
    (org_id, product_id, supplier_id, pack_qty, pack_unit, pack_price, is_preferred)
  select p.org_id, p.id, p.supplier_id,
         nullif(p.pack_qty, 0), p.pack_unit, nullif(p.buying_price_per_pack, 0), true
    from public.products p
   where p.org_id = org and p.supplier_id is not null
  on conflict (product_id, supplier_id) do nothing;

  raise notice 'created % suppliers, linked % products, % link rows (% suppliers in total)',
    made, linked,
    (select count(*) from public.product_suppliers where org_id = org),
    (select count(*) from public.suppliers where org_id = org);
end $$;
