-- ---------------------------------------------------------------------------
-- Orders, deliveries, and what they cost to get here
-- ---------------------------------------------------------------------------
-- Purchasing has eight tabs and the demo venue has never had a single
-- purchase order, so Orders, Receiving, Returns and Landed cost have only
-- ever been seen as empty states. The same gap the takings seed closed on the
-- revenue side.
--
-- Three deliveries, because one is not enough to show what the screens are
-- for:
--
--   One arrives complete and carries a freight charge spread by weight. That
--   is the ordinary case and the one that demonstrates an uplift.
--
--   One arrives with a line rejected, which drafts a supplier return by
--   itself (0095) and — the point worth seeing — carries none of the
--   delivery's handling charge on the crate that went back.
--
--   One has no charges at all, so the landed cost equals the supplier price
--   and the screen shows what "no uplift" looks like beside the others.
--
-- Prices come off the order lines through the trigger in 0109 rather than
-- being written on the receipt, which is both the ordinary path and the one
-- worth exercising.
--
-- Marked `Sample` in `notes`, and safe to re-run.
-- ---------------------------------------------------------------------------

do $$
declare
  org uuid;
  supplier uuid;
  po uuid;
  grn uuid;
  prod record;
  n integer := 0;
  line_no integer;
  weights numeric[] := array[25, 40, 12];
  prices numeric[];
begin
  select id into org from public.organizations where name = 'Demo Kitchen' limit 1;
  if org is null then
    raise notice 'No Demo Kitchen; nothing seeded.';
    return;
  end if;

  delete from public.goods_receipts where notes = 'Sample delivery';
  delete from public.purchase_orders where notes = 'Sample order';

  select id into supplier from public.suppliers
   where org_id = org order by name limit 1;
  if supplier is null then
    raise notice 'No suppliers; run seed_suppliers.sql first.';
    return;
  end if;

  for n in 1 .. 3 loop
    insert into public.purchase_orders
      (org_id, supplier_id, status, ordered_on, expected_on, notes,
       created_by_email)
    values (org, supplier, 'ORDERED',
            current_date - (10 - n * 3), current_date - (8 - n * 3),
            'Sample order', 'demo@culinarycore.local')
    returning id into po;

    insert into public.goods_receipts
      (org_id, supplier_id, purchase_order_id, received_on, notes,
       received_by_email, vehicle_temperature_c)
    values (org, supplier, po, current_date - (8 - n * 3), 'Sample delivery',
            'demo@culinarycore.local',
            -- Within the default chilled limit, so this seed does not
            -- manufacture a food-safety breach for the sake of a screenshot.
            case when n = 2 then 4.5 else null end)
    returning id into grn;

    line_no := 0;
    /*
     * Three stock-tracked products per order, chosen by name so the same
     * three come back on every run. `seed_stock` is what makes a product
     * tracked, so these are ingredients the venue actually counts.
     */
    for prod in
      /*
       * The unit falls back through `total_unit` and `pack_unit`. The Manuza
       * catalogue leaves `stock_unit` empty and carries the measure in
       * `total_unit`, so keying on `stock_unit` alone matched nothing at all
       * — and an empty loop here is silent: three receipts were created with
       * no lines on them, and the only thing that said so was the freight
       * charge refusing to spread over a delivery that weighed nothing.
       */
      select p.id, p.name,
             coalesce(p.stock_unit, p.total_unit, p.pack_unit) as stock_unit,
             p.gross_price_per_unit
        from public.products p
       where p.org_id = org
         and coalesce(p.stock_unit, p.total_unit, p.pack_unit) is not null
         and coalesce(p.gross_price_per_unit, 0) > 0
         -- A par level is what makes a product stock-tracked (seed_stock),
         -- so these are ingredients the venue actually counts rather than
         -- three arbitrary rows out of eleven hundred.
         and coalesce(p.par_level, 0) > 0
       order by p.name
       offset (n - 1) * 3 limit 3
    loop
      line_no := line_no + 1;

      insert into public.purchase_order_lines
        (org_id, purchase_order_id, product_id, quantity, unit, unit_price,
         line_number)
      values (org, po, prod.id, 20 * line_no, prod.stock_unit,
              prod.gross_price_per_unit, line_no);

      insert into public.goods_receipt_lines
        (org_id, goods_receipt_id, purchase_order_line_id, product_id,
         quantity_received, quantity_rejected, rejection_reason, unit,
         line_weight_kg, line_number)
      select org, grn, l.id, prod.id,
             20 * line_no,
             -- The second delivery has its first line refused.
             case when n = 2 and line_no = 1 then 20 * line_no else 0 end,
             case when n = 2 and line_no = 1 then 'arrived warm' end,
             prod.stock_unit,
             weights[line_no],
             line_no
        from public.purchase_order_lines l
       where l.purchase_order_id = po and l.line_number = line_no;
    end loop;
  end loop;
end $$;

/*
 * The stock the deliveries put on the shelf.
 *
 * Posted from the receipt lines rather than written separately, at the price
 * the line ended up with — which is the point of 0109: before it, a receipt
 * booked stock in at no cost at all and `cost_of_goods_daily` counted every
 * one of them under `movements_with_no_cost`.
 */
insert into stock_movements
  (org_id, product_id, kind, quantity, unit, unit_cost, note, occurred_at)
select l.org_id, l.product_id, 'RECEIPT',
       l.quantity_received - l.quantity_rejected, l.unit, l.unit_price,
       'Receipt ' || r.reference, r.received_on
  from goods_receipt_lines l
  join goods_receipts r on r.id = l.goods_receipt_id
 where r.notes = 'Sample delivery'
   and l.product_id is not null
   and (l.quantity_received - l.quantity_rejected) > 0;

/*
 * And the charges, which allocate themselves on insert.
 *
 * The first delivery carries two: freight spread by weight, and duty spread
 * by value. Two on one delivery is deliberate — it is the case where the
 * basis visibly matters, because the heavy line and the valuable line are
 * not the same line and each charge lands somewhere different.
 *
 * Duty is set at a tenth of the goods, which is what makes the uplift
 * legible at all. Freight alone against half a billion rupiah of meat and
 * tea is a rounding error on the screen, and a demonstration where every
 * figure reads 0.04% teaches the opposite of what this is for.
 *
 * The second carries handling by value; the third carries none, so the
 * screen shows what no uplift looks like beside two that have one.
 */
do $$
declare
  org uuid;
  first_grn uuid;
  second_grn uuid;
begin
  select id into org from public.organizations where name = 'Demo Kitchen' limit 1;
  if org is null then return; end if;

  select id into first_grn from public.goods_receipts
   where org_id = org and notes = 'Sample delivery'
   order by received_on limit 1;
  select id into second_grn from public.goods_receipts
   where org_id = org and notes = 'Sample delivery'
   order by received_on offset 1 limit 1;

  -- The allocation trigger asks who is calling, per section.
  perform set_config('request.jwt.claims',
    json_build_object(
      'sub', '11111111-1111-4111-8111-111111111111',
      'email', 'demo@culinarycore.local',
      'role', 'authenticated')::text, true);

  if first_grn is not null then
    insert into public.receipt_charges
      (org_id, goods_receipt_id, kind, basis, amount, invoice_reference,
       created_by_email)
    values (org, first_grn, 'FREIGHT', 'WEIGHT', 850000, 'HAU-10471',
            'demo@culinarycore.local');

    insert into public.receipt_charges
      (org_id, goods_receipt_id, kind, basis, amount, invoice_reference,
       created_by_email)
    select org, first_grn, 'DUTY', 'VALUE',
           round(sum((l.quantity_received - l.quantity_rejected)
                     * l.unit_price) * 0.10),
           'BC-2.0-884213', 'demo@culinarycore.local'
      from public.goods_receipt_lines l
     where l.goods_receipt_id = first_grn;
  end if;

  if second_grn is not null then
    insert into public.receipt_charges
      (org_id, goods_receipt_id, kind, basis, amount, invoice_reference,
       created_by_email)
    values (org, second_grn, 'HANDLING', 'VALUE', 300000, 'HAU-10488',
            'demo@culinarycore.local');
  end if;

  perform set_config('request.jwt.claims', '', true);
end $$;
