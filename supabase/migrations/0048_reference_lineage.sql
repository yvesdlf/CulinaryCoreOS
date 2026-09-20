-- ---------------------------------------------------------------------------
-- One document, one number, three names
-- ---------------------------------------------------------------------------
--   REQ-KIT-260809-001   raised by the kitchen
--   PR-KIT-260809-001    the same document, once approved
--   PO-KIT-260809-001    the same document again, once the PR is approved
--
-- The stem — KIT-260809-001 — belongs to the document for its whole life. Only
-- the prefix moves, and it moves because the document's standing has changed,
-- not because a new number was issued.
--
-- That is the point of the scheme, and it is worth being explicit about why it
-- beats three unrelated numbers. When a supplier queries an invoice, or an
-- auditor asks what authorised a payment, the chain from request to order has
-- to be walked. Three independent sequences make that a lookup through two join
-- tables. A shared stem makes it a string comparison anybody can do by eye, on
-- a printed sheet, over the phone.
--
-- Implementation: the stem is stored, and `reference` is derived from it and
-- kept current by trigger. Deriving it in a view instead would have been
-- cleaner, but `reference` is selected, searched, printed and exported in
-- dozens of places, and a column that silently became a view column would
-- break all of them. This way every existing query keeps working and simply
-- starts seeing the right prefix.
--
-- ── The case the scheme does not cover ─────────────────────────────────────
--
-- A requisition splits into one purchase order per supplier. A kitchen
-- requisition for fish, cheese and dry goods from three vendors becomes three
-- orders, and they cannot all be PO-KIT-260809-001 — the unique index refuses
-- it, and so does anybody trying to pay two invoices against one number.
--
-- One supplier gives exactly PO-KIT-260809-001, which is the common case and
-- the one described. Where a requisition splits, the orders take -1, -2, -3:
--
--   PO-KIT-260809-001-1   the fish
--   PO-KIT-260809-001-2   the cheese
--
-- The stem still ties them to the requisition they came from, which is the
-- property worth keeping.
-- ---------------------------------------------------------------------------

alter table requisitions add column if not exists reference_stem text;
alter table purchase_orders add column if not exists reference_stem text;

create index if not exists idx_requisitions_stem on requisitions(org_id, reference_stem);
create index if not exists idx_purchase_orders_stem on purchase_orders(org_id, reference_stem);

/*
 * What a requisition is called right now.
 *
 * REQ while it is being written or waiting for a decision. PR once somebody
 * approved it — at that moment it stops being a request from a kitchen and
 * becomes an authorised purchase request. A rejected or cancelled one stays a
 * REQ, because it never became anything else.
 */
create or replace function public.requisition_prefix(p_status public.purchase_status)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'DRAFT' then 'REQ'
    when 'SUBMITTED' then 'REQ'
    when 'REJECTED' then 'REQ'
    when 'CANCELLED' then 'REQ'
    else 'PR'
  end;
$$;

/*
 * Keep `reference` showing the document's current standing.
 *
 * Fires on the status change, so approving a requisition renames it from
 * REQ-KIT-260809-001 to PR-KIT-260809-001 without anybody typing anything.
 *
 * A row with no stem is one raised before this migration. Left exactly as it
 * is: those references are on paperwork suppliers already hold, and renaming
 * them retrospectively would break the match.
 */
create or replace function public.sync_requisition_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reference_stem is null or btrim(new.reference_stem) = '' then
    return new;
  end if;
  new.reference := public.requisition_prefix(new.status) || '-' || new.reference_stem;
  return new;
end;
$$;

drop trigger if exists requisitions_sync_reference on requisitions;
create trigger requisitions_sync_reference
  before insert or update on requisitions
  for each row execute function public.sync_requisition_reference();

/*
 * Allocate a stem.
 *
 * The same lock as next_document_reference, and deliberately the same counter:
 * a stem and a reference are the same allocation seen from either end, and two
 * counters would eventually disagree about which 001 was which.
 *
 * The counter is keyed on 'REQ' whatever the document becomes later, because
 * the stem is issued once, at the start of the document's life.
 */
create or replace function public.next_reference_stem(
  p_unit text,
  p_org uuid default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_org uuid := coalesce(p_org, public.auth_default_org_id());
  code text := public.unit_code(p_unit);
  seq integer;
begin
  if target_org is null then
    raise exception 'no organization for the current user';
  end if;

  insert into public.document_sequences (org_id, doc_type, unit_code, day, last_seq)
  values (target_org, 'REQ', code, current_date, 1)
  on conflict (org_id, doc_type, unit_code, day)
  do update set last_seq = public.document_sequences.last_seq + 1
  returning last_seq into seq;

  return code || '-' || to_char(current_date, 'YYMMDD') || '-' ||
         lpad(seq::text, 3, '0');
end;
$$;

grant execute on function public.next_reference_stem(text, uuid) to authenticated;
grant execute on function public.requisition_prefix(public.purchase_status) to authenticated;

/*
 * The order inherits its requisition's stem.
 *
 * This is what makes PO-KIT-260809-001 the same document as the
 * REQ-KIT-260809-001 it came from, rather than a coincidence of two counters
 * happening to be at the same number.
 *
 * Where a requisition splits across suppliers, the second and later orders take
 * -2, -3 and so on. The first keeps the bare stem, so the ordinary
 * one-supplier case reads exactly as specified.
 */
create or replace function public.assign_order_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stem text;
  siblings integer;
begin
  -- An order raised on its own, with no requisition behind it, keeps whatever
  -- reference it was given.
  if new.requisition_id is null then
    return new;
  end if;
  if new.reference_stem is not null and btrim(new.reference_stem) <> '' then
    return new;
  end if;

  select r.reference_stem into stem
    from public.requisitions r where r.id = new.requisition_id;

  if stem is null or btrim(stem) = '' then
    return new;                                   -- pre-migration requisition
  end if;

  select count(*) into siblings
    from public.purchase_orders po
   where po.requisition_id = new.requisition_id;

  new.reference_stem := stem;
  new.reference := 'PO-' || stem ||
    case when siblings > 0 then '-' || (siblings + 1)::text else '' end;
  return new;
end;
$$;

drop trigger if exists purchase_orders_assign_reference on purchase_orders;
create trigger purchase_orders_assign_reference
  before insert on purchase_orders
  for each row execute function public.assign_order_reference();

-- ── Backfill ────────────────────────────────────────────────────────────────
/*
 * Only for references already in the new shape.
 *
 * A REQ-2026-0001 has no unit and no day, so there is no stem to recover. Those
 * keep the reference they have and are simply never renamed — see the note on
 * the sync trigger.
 */
update requisitions
   set reference_stem = substring(reference from '^[A-Z]{2,4}-(.+)$')
 where reference_stem is null
   and reference ~ '^[A-Z]{2,4}-[A-Z0-9]{2,4}-[0-9]{6}-[0-9]{3,}$';

update purchase_orders
   set reference_stem = substring(reference from '^[A-Z]{2,4}-(.+)$')
 where reference_stem is null
   and reference ~ '^[A-Z]{2,4}-[A-Z0-9]{2,4}-[0-9]{6}-[0-9]{3,}$';

comment on column requisitions.reference_stem is
  'KIT-260809-001. Stable for the document''s life; the prefix in `reference` tracks its status.';
comment on function public.requisition_prefix(public.purchase_status) is
  'REQ while requested, PR once approved. The document becomes a purchase request on approval.';
