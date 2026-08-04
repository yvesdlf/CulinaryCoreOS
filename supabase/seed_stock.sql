-- ---------------------------------------------------------------------------
-- Stock: what is counted, and what is on the shelf
-- ---------------------------------------------------------------------------
-- A par level is what makes an ingredient stock-tracked. Without one nothing
-- appears on the count sheet, the inventory page is empty, and neither the
-- reorder report nor the count import can be tried at all.
--
-- Not every ingredient is counted, and pretending otherwise is the mistake
-- that makes stock control collapse: a kitchen that counts eleven hundred
-- lines counts none of them properly. Tracked here are the ones worth the
-- time — the expensive, the perishable and the ones that run out — which is
-- roughly the top of each category by price plus the obvious staples.
--
-- Opening stock is posted as a movement rather than written as a balance,
-- because the ledger is the record and a balance that did not come from one is
-- a number nobody can explain.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

do $$
declare
  org uuid;
  tracked integer;
  opened integer;
begin
  select id into org from public.organizations order by created_at limit 1;
  if org is null then
    raise notice 'no organization; run seed.sql first';
    return;
  end if;

  /*
   * Par and reorder point, by category.
   *
   * The par is what a full shelf looks like and the reorder point is where
   * somebody should be ordering — set below par rather than at it, or every
   * ingredient is permanently "reorder" and the colour means nothing.
   */
  with ranked as (
    select
      p.id,
      p.category,
      row_number() over (
        partition by p.category
        order by p.gross_price_per_unit desc nulls last, p.name
      ) as rank
    from public.products p
    where p.org_id = org
      and p.status = 'ACTIVE'
      and p.category not in ('Sub Recipes', 'Out Source', 'Unmatched - review')
  ),
  chosen as (
    select id, category from ranked where rank <= 12
  )
  update public.products p
     set par_level = c.par,
         reorder_point = round(c.par * 0.4)
    from (
      select
        chosen.id,
        case chosen.category
          when 'Meat'               then 15
          when 'Seafood'            then 10
          when 'Dairy'              then 20
          when 'Fruit & Vegetables' then 25
          when 'Pastry'             then 12
          else 30                                  -- Dry Goods keep deeper cover
        end as par
      from chosen
    ) as c
   where p.id = c.id
     and p.par_level is null;

  get diagnostics tracked = row_count;

  /*
   * Opening stock.
   *
   * Deliberately not "full to par" for everything: a store room where every
   * line sits exactly at par is a store room nobody has cooked from, and it
   * would leave the reorder report and the count variance with nothing to
   * show. Roughly a third land below their reorder point.
   */
  insert into public.stock_movements
    (org_id, product_id, kind, quantity, unit, unit_cost, reason, note, occurred_at)
  select
    org,
    p.id,
    'RECEIPT'::public.stock_movement_kind,
    round((p.par_level * (0.25 + ((hashtext(p.id::text) & 255) / 255.0) * 0.85))::numeric, 2),
    coalesce(p.stock_unit, p.total_unit, 'EA'),
    p.gross_price_per_unit,
    'Opening stock',
    'Seeded opening balance',
    now() - interval '3 days'
  from public.products p
  where p.org_id = org
    and p.par_level is not null
    and not exists (
      select 1 from public.stock_movements m
       where m.product_id = p.id and m.reason = 'Opening stock'
    );

  get diagnostics opened = row_count;

  raise notice 'tracked % ingredients, opened % of them (% tracked in total)',
    tracked, opened,
    (select count(*) from public.products where org_id = org and par_level is not null);
end $$;
