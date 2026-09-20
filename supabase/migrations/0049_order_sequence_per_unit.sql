-- ---------------------------------------------------------------------------
-- A purchase order takes the next number for its unit, that day
-- ---------------------------------------------------------------------------
-- A requisition that splits across three suppliers becomes three orders, and
-- they are numbered in sequence rather than sharing one number with a suffix:
--
--   PO-KIT-260809-001   the fish, from supplier A
--   PO-KIT-260809-002   the cheese, from supplier B
--   PO-KIT-260809-003   the dry goods, from supplier C
--
-- 0048 gave the second and third orders -2 and -3 hanging off the requisition's
-- stem. That is replaced. The last three digits are the order's own sequence,
-- which gives each unit 999 orders a day — Kitchen, Bar and Front of House each
-- counting independently, as they each place their own orders.
--
-- What this costs, stated plainly because it is a real trade-off and not an
-- oversight: a purchase order number no longer tells you by eye which
-- requisition authorised it. PO-KIT-260809-003 might have come from
-- PR-KIT-260809-001. The link is `requisition_id`, which every screen that
-- shows an order already joins on, and the receiving and invoice-matching flows
-- follow it rather than parsing a string.
--
-- What is kept: REQ becomes PR on approval, on the same number, because that is
-- one document changing standing rather than two documents.
-- ---------------------------------------------------------------------------

/*
 * Give the order the next number for its unit, today.
 *
 * From the same counter table as everything else, keyed on 'PO' — so the
 * kitchen's purchase orders count independently of its requisitions, and of
 * the bar's orders. The upsert holds the row lock, so three orders raised from
 * one requisition in a single loop get 001, 002 and 003 even if two people do
 * it at once.
 */
create or replace function public.assign_order_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  unit text;
begin
  -- An order given an explicit reference by an import or a migration keeps it.
  if new.reference is not null
     and new.reference <> ''
     and new.reference !~ '^(x|placeholder)$'
     and new.reference ~ '^[A-Z]{2,4}-[A-Z0-9]{2,4}-[0-9]{6}-[0-9]{3,}$'
  then
    new.reference_stem := substring(new.reference from '^[A-Z]{2,4}-(.+)$');
    return new;
  end if;

  /*
   * The unit is the order's own cost centre, falling back to the requisition's.
   * An order raised directly, with no requisition behind it, still belongs to
   * whichever part of the venue is spending the money.
   */
  select public.unit_code(c.code) into unit
    from public.cost_centres c where c.id = new.cost_centre_id;

  if unit is null and new.requisition_id is not null then
    select public.unit_code(c.code) into unit
      from public.requisitions r
      left join public.cost_centres c on c.id = r.cost_centre_id
     where r.id = new.requisition_id;
  end if;

  new.reference := public.next_document_reference('PO', coalesce(unit, 'GEN'), new.org_id);
  new.reference_stem := substring(new.reference from '^[A-Z]{2,4}-(.+)$');
  return new;
end;
$$;

drop trigger if exists purchase_orders_assign_reference on purchase_orders;
create trigger purchase_orders_assign_reference
  before insert on purchase_orders
  for each row execute function public.assign_order_reference();

comment on function public.assign_order_reference() is
  'Numbers an order from its unit''s daily PO sequence. 999 per unit per day.';
comment on column purchase_orders.reference_stem is
  'KIT-260809-001 from this order''s own number. The requisition link is requisition_id.';
