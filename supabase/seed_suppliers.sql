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
  select id into org from public.organizations order by created_at limit 1;
  if org is null then
    raise notice 'no organization; run seed.sql first';
    return;
  end if;

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

  raise notice 'created % suppliers, linked % products (% suppliers in total)',
    made, linked, (select count(*) from public.suppliers where org_id = org);
end $$;
