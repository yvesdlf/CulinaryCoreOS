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
  /*
   * A lot per opening balance, so traceability has something to trace.
   *
   * Without these the venue has eighty stock movements and no lots at all,
   * which makes the Traceability screen and the Article 18 report (0129) both
   * empty — and an empty traceability report is indistinguishable from a
   * venue that keeps no records. Seeded data should demonstrate the feature,
   * not hide it.
   *
   * Deliberately uneven, for the same reason the opening quantities are: one
   * in eight carries no lot code and one in five a date with no kind. Those
   * are the lines the report exists to surface, and a demo where every lot is
   * perfect demonstrates none of them.
   *
   * The missing suppliers are not manufactured — only 28 of the 72 tracked
   * products carry one, because `seed_suppliers` can only link a product that
   * names a supplier in the catalogue. That gap is real and the report is
   * right to report it.
   */
  insert into public.stock_lots
    (org_id, product_id, lot_code, supplier_id, delivery_reference,
     received_on, expires_on, expiry_kind)
  select
    org,
    p.id,
    case when (hashtext(p.id::text) & 7) = 0 then ''
         else 'OPEN-' || upper(substr(md5(p.id::text), 1, 6)) end,
    p.supplier_id,
    'Opening stock',
    (now() - interval '3 days')::date,
    case when (hashtext(p.id::text) & 15) = 0 then null
         else (now() + interval '1 day' * (7 + (hashtext(p.id::text) & 63)))::date end,
    case when (hashtext(p.id::text) & 15) = 0 then null
         when (hashtext(p.id::text) & 4) = 0 then null
         when (hashtext(p.id::text) & 1) = 0 then 'USE_BY'::public.expiry_kind
         else 'BEST_BEFORE'::public.expiry_kind end
  from public.products p
  where p.org_id = org
    and p.par_level is not null
    and not exists (
      select 1 from public.stock_lots l
       where l.product_id = p.id and l.delivery_reference = 'Opening stock'
    );

  insert into public.stock_movements
    (org_id, product_id, kind, quantity, unit, unit_cost, reason, note,
     occurred_at, lot_id)
  select
    org,
    p.id,
    'RECEIPT'::public.stock_movement_kind,
    round((p.par_level * (0.25 + ((hashtext(p.id::text) & 255) / 255.0) * 0.85))::numeric, 2),
    coalesce(p.stock_unit, p.total_unit, 'EA'),
    p.gross_price_per_unit,
    'Opening stock',
    'Seeded opening balance',
    now() - interval '3 days',
    (select l.id from public.stock_lots l
      where l.product_id = p.id and l.delivery_reference = 'Opening stock'
      limit 1)
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
