-- ---------------------------------------------------------------------------
-- The order keeps the number the request was given
-- ---------------------------------------------------------------------------
--   PR-KIT-260809-003  →  PO-KIT-260809-003
--   PR-BAR-260809-012  →  PO-BAR-260809-012
--
-- The number is issued once, when the requisition is raised, and the document
-- keeps it through approval and ordering. REQ, PR and PO are three names for
-- one thing at three points in its life, and it has one number throughout.
--
-- ── What this changes ──────────────────────────────────────────────────────
--
-- The counter was keyed on document type, so requisitions and orders each had
-- their own. That is what made an order's number independent of its request's,
-- and it is now wrong: with separate counters, PR-KIT-260809-012 becomes
-- whatever the kitchen's next PO happens to be, which is the opposite of the
-- rule.
--
-- One counter per unit per day now serves the whole purchasing chain. Kitchen
-- still gets 999 documents a day and the Bar counts separately, exactly as
-- before — but a number issued to a requisition is spent, and no order can be
-- issued it again.
--
-- Goods receipts, invoices and quotation requests keep their own counters. They
-- are separate documents rather than later names for the same one, and a GRN
-- consuming a number that a requisition would otherwise have had would waste
-- the unit's daily range for no reason.
--
-- ── The split, again ───────────────────────────────────────────────────────
--
-- One requisition can still become several orders — one per supplier — and
-- they cannot all be PO-KIT-260809-003.
--
-- The first takes the requisition's number, which is the rule as stated and
-- covers every ordinary case. Any further order takes the next number from the
-- same per-unit pool:
--
--   PR-KIT-260809-003  →  PO-KIT-260809-003   supplier A
--                         PO-KIT-260809-004   supplier B
--                         PO-KIT-260809-005   supplier C
--
-- So the numbers stay sequential within the unit and the day, nothing is
-- reused, and a requisition that goes to one supplier — which is most of them —
-- reads exactly as specified.
-- ---------------------------------------------------------------------------

/*
 * The shared counter key for the purchasing chain.
 *
 * A constant rather than the document type, so REQ, PR and PO draw from one
 * pool. Named rather than inlined at three call sites, because the three have
 * to agree and a typo in one of them would silently reintroduce the split
 * counters this migration exists to remove.
 */
create or replace function public.purchasing_sequence_key()
returns text
language sql
immutable
set search_path = ''
as $$ select 'PUR'::text $$;

/*
 * Carry any counters already issued into the shared one.
 *
 * Without this, a venue mid-day would have REQ at 7 and PO at 3, and the shared
 * counter would start from nothing and reissue numbers that are already on
 * paperwork. Takes the highest of whatever exists for that unit and day.
 */
insert into document_sequences (org_id, doc_type, unit_code, day, last_seq)
select org_id, public.purchasing_sequence_key(), unit_code, day, max(last_seq)
  from document_sequences
 where doc_type in ('REQ', 'PR', 'PO')
 group by org_id, unit_code, day
on conflict (org_id, doc_type, unit_code, day)
do update set last_seq = greatest(
  public.document_sequences.last_seq, excluded.last_seq);

/*
 * Issue a number for a new purchasing document.
 *
 * The requisition is the only thing that calls this — an order inherits rather
 * than allocates, except for the extra suppliers of a split.
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
  values (target_org, public.purchasing_sequence_key(), code, current_date, 1)
  on conflict (org_id, doc_type, unit_code, day)
  do update set last_seq = public.document_sequences.last_seq + 1
  returning last_seq into seq;

  return code || '-' || to_char(current_date, 'YYMMDD') || '-' ||
         lpad(seq::text, 3, '0');
end;
$$;

/*
 * The order takes its requisition's number.
 *
 * PR-KIT-260809-003 becomes PO-KIT-260809-003. The first order raised against a
 * requisition inherits its stem; a second or third, from a requisition split
 * across suppliers, takes the next number in the unit's own pool rather than
 * colliding with the first.
 *
 * An order raised with no requisition behind it allocates its own number, since
 * there is nothing to inherit from.
 */
create or replace function public.assign_order_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stem text;
  unit text;
  taken integer;
begin
  -- An explicit, well-formed reference from an import or a migration stands.
  if new.reference is not null
     and new.reference ~ '^[A-Z]{2,4}-[A-Z0-9]{2,4}-[0-9]{6}-[0-9]{3,}$'
  then
    new.reference_stem := substring(new.reference from '^[A-Z]{2,4}-(.+)$');
    return new;
  end if;

  if new.requisition_id is not null then
    select r.reference_stem into stem
      from public.requisitions r where r.id = new.requisition_id;

    if stem is not null and btrim(stem) <> '' then
      select count(*) into taken
        from public.purchase_orders po
       where po.requisition_id = new.requisition_id;

      if taken = 0 then
        -- The ordinary case: this order is the requisition, ordered.
        new.reference_stem := stem;
        new.reference := 'PO-' || stem;
        return new;
      end if;
      -- A further supplier on the same requisition. Its own number, from the
      -- same pool, so nothing is reused and the sequence stays readable.
      new.reference_stem := public.next_reference_stem(
        split_part(stem, '-', 1), new.org_id);
      new.reference := 'PO-' || new.reference_stem;
      return new;
    end if;
  end if;

  -- No requisition, or one raised before this scheme existed.
  select public.unit_code(c.code) into unit
    from public.cost_centres c where c.id = new.cost_centre_id;

  new.reference_stem := public.next_reference_stem(coalesce(unit, 'GEN'), new.org_id);
  new.reference := 'PO-' || new.reference_stem;
  return new;
end;
$$;

drop trigger if exists purchase_orders_assign_reference on purchase_orders;
create trigger purchase_orders_assign_reference
  before insert on purchase_orders
  for each row execute function public.assign_order_reference();

grant execute on function public.purchasing_sequence_key() to authenticated;

comment on function public.assign_order_reference() is
  'An order keeps its requisition''s number. Extra suppliers on a split take the next in the unit''s pool.';
comment on function public.purchasing_sequence_key() is
  'One counter per unit per day for REQ, PR and PO — they are one document, so they share a number.';
