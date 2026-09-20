-- ---------------------------------------------------------------------------
-- The order keeps the number the request was given
-- ---------------------------------------------------------------------------
--   REQ-KIT-260809-003  ->  PR-KIT-260809-003  ->  PO-KIT-260809-003
--   PR-BAR-260809-012   ->  PO-BAR-260809-012
--
-- The number is issued once, when the request is raised, and every document
-- after it in the chain carries the same three digits until the invoice is
-- paid and archived.
--
-- 0049 gave the order its own sequence, which was wrong. It came from trying to
-- number the pieces of a requisition split across several suppliers — and the
-- answer to that was never a numbering scheme. It is that a request goes to one
-- supplier, so there is nothing to split.
--
-- With that rule in place the order does not need a number of its own. It has
-- one already: the number of the request that authorised it.
--
-- ── The fallback, and why it is visible ────────────────────────────────────
--
-- A requisition can still end up with two orders — imported data, or a venue
-- that raised one before the app enforced the rule. The second order takes the
-- next number in its unit's sequence rather than colliding.
--
-- That is a fallback for data that should not exist, not a designed path. It
-- leaves the chain visibly broken: the order's number will not match its
-- request's, which is exactly the signal somebody needs.
-- ---------------------------------------------------------------------------

create or replace function public.assign_order_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stem text;
  taken integer;
  unit text;
begin
  -- An order given a well-formed reference by an import or a migration keeps it.
  if new.reference is not null
     and new.reference ~ '^[A-Z]{2,4}-[A-Z0-9]{2,4}-[0-9]{6}-[0-9]{3,}$'
  then
    new.reference_stem := substring(new.reference from '^[A-Z]{2,4}-(.+)$');
    return new;
  end if;

  if new.requisition_id is not null then
    select r.reference_stem into stem
      from public.requisitions r where r.id = new.requisition_id;

    -- Already an order against this request. One request, one supplier, one
    -- order — so this is data that should not exist, and it gets its own
    -- number so the mismatch is visible rather than a duplicate key.
    select count(*) into taken
      from public.purchase_orders po
     where po.requisition_id = new.requisition_id;

    if taken > 0 then
      stem := null;
    end if;
  end if;

  if stem is null or btrim(stem) = '' then
    select public.unit_code(c.code) into unit
      from public.cost_centres c where c.id = new.cost_centre_id;

    if unit is null and new.requisition_id is not null then
      select public.unit_code(c.code) into unit
        from public.requisitions r
        left join public.cost_centres c on c.id = r.cost_centre_id
       where r.id = new.requisition_id;
    end if;

    stem := public.next_reference_stem(coalesce(unit, 'GEN'), new.org_id);
  end if;

  new.reference_stem := stem;
  new.reference := 'PO-' || stem;
  return new;
end;
$$;

drop trigger if exists purchase_orders_assign_reference on purchase_orders;
create trigger purchase_orders_assign_reference
  before insert on purchase_orders
  for each row execute function public.assign_order_reference();

comment on function public.assign_order_reference() is
  'An order carries its request''s number. A second order on one request is a fallback, numbered separately so the break is visible.';
