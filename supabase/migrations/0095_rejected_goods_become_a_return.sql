-- ---------------------------------------------------------------------------
-- Rejected goods become a return, and a return becomes a credit
-- ---------------------------------------------------------------------------
-- `goods_receipt_lines` has carried `quantity_rejected` and
-- `rejection_reason` since 0021, and the `RETURN` stock movement kind has
-- existed since 0016 with not one row ever written to it. So a delivery
-- could be refused at the door and the refusal recorded — and then nothing.
-- No document went back to the supplier, nothing tracked whether the credit
-- ever arrived, and the invoice was matched against the full delivery.
--
-- Which is the expensive direction for the error to run: a venue that
-- rejects goods and is billed for them pays for food it sent back, and the
-- only trace is a column nobody reports on.
--
-- Two documents, continuing the chain. 0048–0052 built one human-readable
-- number per supplier chain — the requisition's stem carries through to the
-- order, the receipt and the invoice — and a return and its credit note join
-- it rather than starting again. `RET-KIT-260809-001` is visibly the same
-- conversation as `GRN-KIT-260809-001`.
--
-- The distinction that decides whether stock moves: goods refused at the
-- door never entered the ledger, so returning them must not take them out
-- again. Goods accepted and found bad later did enter, and must. The line
-- records which it is rather than inferring it, because the inference is
-- wrong the moment somebody raises a return against a receipt for stock they
-- had already put away.
-- ---------------------------------------------------------------------------

do $$ begin
  create type return_status as enum ('DRAFT', 'POSTED', 'CREDITED', 'CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type credit_note_status as enum ('EXPECTED', 'RECEIVED', 'APPLIED', 'CANCELLED');
exception when duplicate_object then null; end $$;

create table if not exists supplier_returns (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete restrict,
  goods_receipt_id uuid references goods_receipts(id) on delete set null,

  reference text,
  reference_stem text,
  status return_status not null default 'DRAFT',
  currency text,

  reason text,
  note text,
  raised_by_email text,
  posted_at timestamptz,
  cancelled_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists supplier_return_lines (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  return_id uuid not null references supplier_returns(id) on delete cascade,
  product_id uuid not null references products(id) on delete restrict,
  goods_receipt_line_id uuid references goods_receipt_lines(id) on delete set null,
  lot_id uuid references stock_lots(id) on delete set null,

  quantity numeric(18,5) not null,
  unit text not null,
  unit_price numeric(18,5),
  line_total numeric(18,5),
  reason text,
  line_number integer,

  /*
   * Did this ever reach the shelf?
   *
   * False for goods refused at the door: they were never received, so there
   * is nothing to take out and a `RETURN` movement would invent a shortfall.
   * True for goods accepted and found bad afterwards. Recorded rather than
   * inferred from whether a receipt line is linked, because a late return
   * against an accepted delivery links one too.
   */
  from_stock boolean not null default true,

  created_at timestamptz not null default now(),

  constraint supplier_return_lines_qty check (quantity > 0)
);

create index if not exists idx_supplier_return_lines_return
  on supplier_return_lines(return_id);
create index if not exists idx_supplier_returns_supplier
  on supplier_returns(org_id, supplier_id, status);

create table if not exists supplier_credit_notes (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete restrict,
  return_id uuid references supplier_returns(id) on delete set null,

  reference text,
  reference_stem text,
  -- The supplier's own number, which is what they will quote on the phone.
  credit_number text,
  status credit_note_status not null default 'EXPECTED',

  amount numeric(18,5),
  currency text,
  issued_on date,
  received_on date,

  applied_to_invoice_id uuid references supplier_invoices(id) on delete set null,
  applied_at timestamptz,
  applied_by_email text,

  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint supplier_credit_notes_amount check (amount is null or amount >= 0)
);

create index if not exists idx_supplier_credit_notes_supplier
  on supplier_credit_notes(org_id, supplier_id, status);

/*
 * The same number as the delivery it came from.
 *
 * A return with no receipt still needs one — goods can go back weeks later —
 * and takes the next stem for its unit, exactly as 0048 has a delivery
 * nobody ordered do.
 */
create or replace function public.assign_return_reference()
returns trigger language plpgsql security definer set search_path = '' as $$
declare stem text;
begin
  if new.reference_stem is not null and btrim(new.reference_stem) <> '' then
    new.reference := coalesce(new.reference, 'RET-' || new.reference_stem);
    return new;
  end if;

  if new.goods_receipt_id is not null then
    select g.reference_stem into stem
      from public.goods_receipts g where g.id = new.goods_receipt_id;
  end if;

  if stem is null or btrim(stem) = '' then
    stem := public.next_reference_stem('GEN', new.org_id);
  end if;

  new.reference_stem := stem;
  new.reference := 'RET-' || stem;
  return new;
end $$;

create or replace function public.assign_credit_note_reference()
returns trigger language plpgsql security definer set search_path = '' as $$
declare stem text;
begin
  if new.reference_stem is not null and btrim(new.reference_stem) <> '' then
    new.reference := coalesce(new.reference, 'CN-' || new.reference_stem);
    return new;
  end if;

  if new.return_id is not null then
    select r.reference_stem into stem
      from public.supplier_returns r where r.id = new.return_id;
  end if;

  if stem is null or btrim(stem) = '' then
    stem := public.next_reference_stem('GEN', new.org_id);
  end if;

  new.reference_stem := stem;
  new.reference := 'CN-' || stem;
  return new;
end $$;

create or replace function public.set_return_child_org()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent_org uuid;
begin
  select r.org_id into parent_org
    from public.supplier_returns r where r.id = new.return_id;
  if parent_org is null then
    raise exception 'the return this line belongs to does not exist';
  end if;
  new.org_id := parent_org;
  return new;
end $$;

drop trigger if exists supplier_returns_set_org on supplier_returns;
create trigger supplier_returns_set_org before insert on supplier_returns
  for each row execute function public.set_org_id();
-- After set_org_id, which is why the name sorts later: the reference needs
-- org_id to allocate a stem. 0061 is the reminder that trigger order here is
-- alphabetical and load-bearing.
drop trigger if exists supplier_returns_zz_reference on supplier_returns;
create trigger supplier_returns_zz_reference before insert on supplier_returns
  for each row execute function public.assign_return_reference();
drop trigger if exists supplier_returns_touch on supplier_returns;
create trigger supplier_returns_touch before update on supplier_returns
  for each row execute function public.set_updated_at();

drop trigger if exists supplier_return_lines_set_org on supplier_return_lines;
create trigger supplier_return_lines_set_org before insert on supplier_return_lines
  for each row execute function public.set_return_child_org();

drop trigger if exists supplier_credit_notes_set_org on supplier_credit_notes;
create trigger supplier_credit_notes_set_org before insert on supplier_credit_notes
  for each row execute function public.set_org_id();
drop trigger if exists supplier_credit_notes_zz_reference on supplier_credit_notes;
create trigger supplier_credit_notes_zz_reference before insert on supplier_credit_notes
  for each row execute function public.assign_credit_note_reference();
drop trigger if exists supplier_credit_notes_touch on supplier_credit_notes;
create trigger supplier_credit_notes_touch before update on supplier_credit_notes
  for each row execute function public.set_updated_at();

/*
 * A rejection drafts the return.
 *
 * The brief asks for this and it is the only way the feature gets used: a
 * storeman refusing three crates at six in the morning is not going to open
 * a second screen. The draft is never sent anywhere on its own — somebody
 * reviews and posts it — which is the same position the auto-reorder takes.
 *
 * One return per receipt, built up line by line as the receipt is entered.
 */
create or replace function public.draft_return_for_rejection()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  rec record;
  ret_id uuid;
begin
  if coalesce(new.quantity_rejected, 0) <= 0 then
    return new;
  end if;

  select g.id, g.org_id, g.supplier_id, g.reference_stem
    into rec
    from public.goods_receipts g where g.id = new.goods_receipt_id;
  if rec.id is null or rec.supplier_id is null then
    return new;                       -- Nothing to return it to.
  end if;

  select r.id into ret_id
    from public.supplier_returns r
   where r.goods_receipt_id = rec.id and r.status = 'DRAFT'
   limit 1;

  if ret_id is null then
    insert into public.supplier_returns
      (org_id, supplier_id, goods_receipt_id, reference_stem, reason, note)
    values (rec.org_id, rec.supplier_id, rec.id, rec.reference_stem,
            'rejected on delivery',
            'Drafted from the delivery. Review before sending.')
    returning id into ret_id;
  end if;

  insert into public.supplier_return_lines
    (return_id, product_id, goods_receipt_line_id, lot_id,
     quantity, unit, reason, line_number, from_stock)
  values (ret_id, new.product_id, new.id, new.lot_id,
          new.quantity_rejected, new.unit,
          coalesce(new.rejection_reason, 'rejected on delivery'),
          new.line_number,
          -- Refused at the door: it never entered the ledger.
          false);

  return new;
end $$;

drop trigger if exists goods_receipt_lines_draft_return on goods_receipt_lines;
create trigger goods_receipt_lines_draft_return
  after insert on goods_receipt_lines
  for each row execute function public.draft_return_for_rejection();

/*
 * Posting a return.
 *
 * Only the lines that came off the shelf move stock, and they move negative
 * for the same reason everything else does — on hand is the signed sum of
 * the ledger. A credit note is raised as EXPECTED at the same time, because
 * the thing that actually goes wrong is not the return, it is nobody
 * noticing the credit never came.
 */
create or replace function public.post_supplier_return(p_return uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n integer := 0;
begin
  select * into r from public.supplier_returns where id = p_return;
  if r is null then
    raise exception 'no such return';
  end if;
  if not public.can_write_section('PURCHASING', r.org_id) then
    raise exception 'you do not have edit access to PURCHASING' using errcode = '42501';
  end if;
  if r.status <> 'DRAFT' then
    raise exception 'this return has already been posted';
  end if;
  if not exists (select 1 from public.supplier_return_lines l where l.return_id = p_return) then
    raise exception 'a return with no lines is not a return';
  end if;

  insert into public.stock_movements
    (org_id, product_id, kind, quantity, unit, reason, note,
     actor_id, actor_email, occurred_at, lot_id)
  select r.org_id, l.product_id, 'RETURN', -l.quantity, l.unit,
         'supplier return',
         'Return ' || coalesce(r.reference, r.id::text),
         (select auth.uid()), auth.jwt() ->> 'email', now(), l.lot_id
    from public.supplier_return_lines l
   where l.return_id = p_return
     and l.from_stock;

  get diagnostics n = row_count;

  insert into public.supplier_credit_notes
    (org_id, supplier_id, return_id, reference_stem, status, currency,
     amount, note)
  select r.org_id, r.supplier_id, r.id, r.reference_stem, 'EXPECTED', r.currency,
         nullif((select sum(coalesce(l.line_total,
                                     coalesce(l.unit_price, 0) * l.quantity))
                   from public.supplier_return_lines l where l.return_id = r.id), 0),
         'Raised when the return was posted. Chase it if it does not arrive.';

  update public.supplier_returns
     set status = 'POSTED', posted_at = now(),
         raised_by_email = coalesce(raised_by_email, auth.jwt() ->> 'email')
   where id = p_return;

  return n;
end $$;

revoke all on function public.post_supplier_return(uuid) from public;
grant execute on function public.post_supplier_return(uuid) to authenticated;

alter table supplier_returns enable row level security;
alter table supplier_return_lines enable row level security;
alter table supplier_credit_notes enable row level security;

drop policy if exists supplier_returns_read on supplier_returns;
create policy supplier_returns_read on supplier_returns for select to authenticated
  using (public.can_read_section('PURCHASING', org_id));
drop policy if exists supplier_returns_write on supplier_returns;
create policy supplier_returns_write on supplier_returns for insert to authenticated
  with check (public.auth_can_write(org_id));
drop policy if exists supplier_returns_update on supplier_returns;
create policy supplier_returns_update on supplier_returns for update to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));

drop policy if exists supplier_return_lines_read on supplier_return_lines;
create policy supplier_return_lines_read on supplier_return_lines for select to authenticated
  using (public.can_read_section('PURCHASING', org_id));
drop policy if exists supplier_return_lines_write on supplier_return_lines;
create policy supplier_return_lines_write on supplier_return_lines for insert to authenticated
  with check (public.auth_can_write(org_id));
drop policy if exists supplier_return_lines_update on supplier_return_lines;
create policy supplier_return_lines_update on supplier_return_lines for update to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));
drop policy if exists supplier_return_lines_delete on supplier_return_lines;
create policy supplier_return_lines_delete on supplier_return_lines for delete to authenticated
  using (public.auth_can_write(org_id));

drop policy if exists supplier_credit_notes_read on supplier_credit_notes;
create policy supplier_credit_notes_read on supplier_credit_notes for select to authenticated
  using (public.can_read_section('PURCHASING', org_id));
drop policy if exists supplier_credit_notes_write on supplier_credit_notes;
create policy supplier_credit_notes_write on supplier_credit_notes for insert to authenticated
  with check (public.auth_can_write(org_id));
drop policy if exists supplier_credit_notes_update on supplier_credit_notes;
create policy supplier_credit_notes_update on supplier_credit_notes for update to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));

grant select, insert, update on supplier_returns to authenticated;
grant select, insert, update, delete on supplier_return_lines to authenticated;
grant select, insert, update on supplier_credit_notes to authenticated;

-- No delete on the headers. A return that was sent was sent; it is cancelled.

drop trigger if exists supplier_returns_section_guard on supplier_returns;
create trigger supplier_returns_section_guard
  before insert or update or delete on supplier_returns
  for each row execute function public.require_section_write('PURCHASING');
drop trigger if exists supplier_return_lines_section_guard on supplier_return_lines;
create trigger supplier_return_lines_section_guard
  before insert or update or delete on supplier_return_lines
  for each row execute function public.require_section_write('PURCHASING');
drop trigger if exists supplier_credit_notes_section_guard on supplier_credit_notes;
create trigger supplier_credit_notes_section_guard
  before insert or update or delete on supplier_credit_notes
  for each row execute function public.require_section_write('PURCHASING');

delete from public.section_read_rules
 where table_name in ('supplier_returns', 'supplier_return_lines', 'supplier_credit_notes');
insert into public.section_read_rules (table_name, section_code) values
  ('supplier_returns', 'PURCHASING'),
  ('supplier_return_lines', 'PURCHASING'),
  ('supplier_credit_notes', 'PURCHASING');

/*
 * What a supplier still owes.
 *
 * The number nobody has today: goods went back, and the credit either
 * arrived or quietly did not. Aged, because a credit note outstanding for
 * ninety days is a different conversation from one raised yesterday.
 */
create or replace view credit_notes_outstanding
with (security_invoker = true) as
  select
    cn.org_id,
    cn.id            as credit_note_id,
    cn.reference,
    cn.credit_number,
    cn.supplier_id,
    s.name           as supplier_name,
    cn.status,
    cn.amount,
    cn.currency,
    cn.issued_on,
    cn.received_on,
    r.reference      as return_reference,
    r.posted_at      as returned_on,
    (current_date - coalesce(cn.issued_on, r.posted_at::date, cn.created_at::date))
                     as days_outstanding
  from public.supplier_credit_notes cn
  left join public.suppliers s        on s.id = cn.supplier_id
  left join public.supplier_returns r on r.id = cn.return_id
  where cn.status in ('EXPECTED', 'RECEIVED');

grant select on credit_notes_outstanding to authenticated;

comment on table supplier_returns is
  'Goods going back to a supplier. Drafted automatically from a rejected delivery line. See 0095.';
comment on column supplier_return_lines.from_stock is
  'False for goods refused at the door, which never entered the ledger and must not be taken out of it. See 0095.';
comment on view credit_notes_outstanding is
  'Credits a supplier owes and has not sent, aged. See 0095.';
