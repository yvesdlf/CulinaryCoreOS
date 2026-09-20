-- ---------------------------------------------------------------------------
-- One number, one supplier, from request to payment
-- ---------------------------------------------------------------------------
--   REQ-KIT-260809-003   the kitchen asks
--   PR-KIT-260809-003    approved
--   PO-KIT-260809-003    ordered from that supplier
--   GRN-KIT-260809-003   what arrived
--   INV-KIT-260809-003   what they billed
--
-- The last three digits belong to one transaction with one supplier and stay
-- with it until the invoice is paid and archived. Somebody holding a delivery
-- note can say what it was ordered against; somebody holding an invoice can say
-- what arrived — without opening the app.
--
-- ── One request per supplier ───────────────────────────────────────────────
--
-- This is the rule that makes the rest work, and it is a business rule rather
-- than a numbering one. A request goes to one supplier, so it becomes exactly
-- one order, one delivery and one invoice. There is no split, and therefore no
-- need for a scheme to number the pieces of one.
--
-- The previous migration allocated fresh numbers to the second and third orders
-- of a split requisition. That is now a fallback for data that should not
-- exist, not a designed path: the app groups a requisition by supplier and
-- raises one requisition each before anything is approved.
--
-- ── Why the whole chain and not just the order ─────────────────────────────
--
-- Because the questions that get asked are about the chain. "We are being
-- chased for INV-KIT-260809-003 — what was that?" is answered instantly if the
-- goods receipt and the order carry the same number, and is a three-table join
-- otherwise. Matching an invoice to a delivery to an order is the single most
-- common piece of purchasing admin there is.
-- ---------------------------------------------------------------------------

alter table goods_receipts add column if not exists reference_stem text;
alter table supplier_invoices add column if not exists reference_stem text;

create index if not exists idx_goods_receipts_stem
  on goods_receipts(org_id, reference_stem);
create index if not exists idx_supplier_invoices_stem
  on supplier_invoices(org_id, reference_stem);

/*
 * A delivery is named after the order it settles.
 *
 * Not given its own number: a goods receipt without an order behind it is
 * unusual enough that it should be visibly different, and it falls through to
 * its own number below.
 */
create or replace function public.assign_receipt_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stem text;
  unit text;
begin
  if new.reference is not null
     and new.reference ~ '^[A-Z]{2,4}-[A-Z0-9]{2,4}-[0-9]{6}-[0-9]{3,}$'
  then
    new.reference_stem := substring(new.reference from '^[A-Z]{2,4}-(.+)$');
    return new;
  end if;

  if new.purchase_order_id is not null then
    select po.reference_stem into stem
      from public.purchase_orders po where po.id = new.purchase_order_id;
  end if;

  if stem is null or btrim(stem) = '' then
    -- A delivery nobody ordered. It still needs a number; it takes the unit's
    -- next, and the fact that it does not match an order is the point.
    select public.unit_code(c.code) into unit
      from public.purchase_orders po
      left join public.cost_centres c on c.id = po.cost_centre_id
     where po.id = new.purchase_order_id;
    stem := public.next_reference_stem(coalesce(unit, 'GEN'), new.org_id);
  end if;

  new.reference_stem := stem;
  new.reference := 'GRN-' || stem;
  return new;
end;
$$;

drop trigger if exists goods_receipts_assign_reference on goods_receipts;
create trigger goods_receipts_assign_reference
  before insert on goods_receipts
  for each row execute function public.assign_receipt_reference();

/*
 * An invoice is named after the order it bills for.
 *
 * The supplier's own invoice number is a separate field and stays exactly as
 * they wrote it — this is the venue's reference for the same transaction, and
 * both are needed when a query goes back to them.
 */
create or replace function public.assign_invoice_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stem text;
begin
  if new.reference_stem is not null and btrim(new.reference_stem) <> '' then
    return new;
  end if;

  if new.purchase_order_id is not null then
    select po.reference_stem into stem
      from public.purchase_orders po where po.id = new.purchase_order_id;
  end if;

  -- An invoice with no order behind it is exactly what three-way matching
  -- exists to catch, so it gets a number of its own rather than borrowing one.
  if stem is null or btrim(stem) = '' then
    stem := public.next_reference_stem('GEN', new.org_id);
  end if;

  new.reference_stem := stem;
  return new;
end;
$$;

drop trigger if exists supplier_invoices_assign_reference on supplier_invoices;
create trigger supplier_invoices_assign_reference
  before insert on supplier_invoices
  for each row execute function public.assign_invoice_reference();

-- ── Backfill ────────────────────────────────────────────────────────────────

update goods_receipts g
   set reference_stem = coalesce(
     nullif(substring(g.reference from '^[A-Z]{2,4}-([A-Z0-9]{2,4}-[0-9]{6}-[0-9]{3,})$'), ''),
     (select po.reference_stem from purchase_orders po where po.id = g.purchase_order_id))
 where g.reference_stem is null;

update supplier_invoices i
   set reference_stem = (
     select po.reference_stem from purchase_orders po where po.id = i.purchase_order_id)
 where i.reference_stem is null;

/*
 * The whole life of one transaction, in one row.
 *
 * What somebody actually wants when they are holding a piece of paper with a
 * number on it and need to know what else exists against it.
 */
create or replace view purchasing_chain as
  select
    r.org_id,
    r.reference_stem,
    r.id as requisition_id,
    r.reference as requisition_reference,
    r.status as requisition_status,
    po.id as purchase_order_id,
    po.reference as order_reference,
    po.supplier_id,
    s.name as supplier_name,
    g.id as goods_receipt_id,
    g.reference as receipt_reference,
    inv.id as invoice_id,
    inv.invoice_number as supplier_invoice_number,
    inv.status as invoice_status
  from public.requisitions r
  left join public.purchase_orders po on po.requisition_id = r.id
  left join public.suppliers s on s.id = po.supplier_id
  left join public.goods_receipts g on g.purchase_order_id = po.id
  left join public.supplier_invoices inv on inv.purchase_order_id = po.id
  where r.org_id in (select public.auth_org_ids())
    and r.reference_stem is not null;

grant select on purchasing_chain to authenticated;

comment on view purchasing_chain is
  'One transaction end to end. Every document on a stem shares the last three digits.';
comment on column goods_receipts.reference_stem is
  'Taken from the order being received. The number follows the transaction to payment.';
