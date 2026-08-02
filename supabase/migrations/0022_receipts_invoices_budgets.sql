-- ---------------------------------------------------------------------------
-- Receiving, invoices and budgets
-- ---------------------------------------------------------------------------
-- This closes the loop the purchasing module opened: an order becomes a
-- delivery, a delivery becomes stock and a lot, an invoice is checked against
-- both, and the money is counted against a budget before it is spent rather
-- than after.
--
-- The part worth care is the matching. Most of the value in accounts payable
-- is not in the invoices that agree — those could be paid by a script — but in
-- the ones that do not, and in refusing to pay them quietly. So an invoice
-- carries its exceptions as data, tolerances are configuration rather than
-- opinion, and an invoice that fails cannot be marked approved for payment.
--
-- Budget control is a commitment model, not a spend report. Money is committed
-- when an order is approved, because that is the moment the venue is on the
-- hook for it; reporting only what has been invoiced tells a kitchen it has
-- budget it has already promised away.
-- ---------------------------------------------------------------------------

-- ── Goods receipts ──────────────────────────────────────────────────────────

create table if not exists goods_receipts (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  reference text not null,
  purchase_order_id uuid references purchase_orders(id) on delete set null,
  supplier_id uuid references suppliers(id) on delete set null,

  received_on date not null default current_date,
  delivery_note text,
  -- Cold-chain evidence for the delivery as a whole; per-lot readings live on
  -- the lot, because a van can carry both chilled and ambient goods.
  vehicle_temperature_c numeric(6,2),

  received_by uuid,
  received_by_email text,
  notes text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_goods_receipts_reference
  on goods_receipts(org_id, reference);
create index if not exists idx_goods_receipts_po on goods_receipts(purchase_order_id);

create table if not exists goods_receipt_lines (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  goods_receipt_id uuid not null references goods_receipts(id) on delete cascade,
  purchase_order_line_id uuid references purchase_order_lines(id) on delete set null,
  product_id uuid references products(id) on delete set null,

  quantity_received numeric(18,5) not null,
  unit text not null,
  -- The lot this delivery created, so receiving and traceability are the same
  -- act rather than two things somebody has to remember to do twice.
  lot_id uuid references stock_lots(id) on delete set null,

  -- What arrived wrong. Recorded on the line because a delivery is rarely
  -- wholly good or wholly bad.
  quantity_rejected numeric(18,5) not null default 0,
  rejection_reason text,
  condition_note text,

  line_number integer not null default 1,
  created_at timestamptz not null default now(),

  constraint goods_receipt_lines_positive check (quantity_received >= 0)
);

create index if not exists idx_goods_receipt_lines_receipt
  on goods_receipt_lines(goods_receipt_id);
create index if not exists idx_goods_receipt_lines_po_line
  on goods_receipt_lines(purchase_order_line_id);

/*
 * Keep the order line's received quantity in step.
 *
 * Denormalised so "what is still outstanding" is one read. Rejected quantity
 * is deliberately not counted as received: it arrived, it was refused, and the
 * supplier still owes it.
 */
create or replace function public.refresh_po_line_received()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare pol uuid;
begin
  pol := coalesce(new.purchase_order_line_id, old.purchase_order_line_id);
  if pol is null then return null; end if;
  update public.purchase_order_lines l
     set quantity_received = coalesce(
           (select sum(g.quantity_received - g.quantity_rejected)
              from public.goods_receipt_lines g
             where g.purchase_order_line_id = pol), 0)
   where l.id = pol;

  -- Derive the order's status from what has actually arrived.
  update public.purchase_orders p
     set status = case
           when p.status in ('CANCELLED','CLOSED') then p.status
           when not exists (
             select 1 from public.purchase_order_lines l2
              where l2.purchase_order_id = p.id
                and l2.quantity_received < l2.quantity) then 'RECEIVED'::public.purchase_status
           when exists (
             select 1 from public.purchase_order_lines l3
              where l3.purchase_order_id = p.id
                and l3.quantity_received > 0) then 'PARTIALLY_RECEIVED'::public.purchase_status
           else p.status end,
         updated_at = now()
   where p.id = (select l4.purchase_order_id from public.purchase_order_lines l4 where l4.id = pol);
  return null;
end;
$$;

create trigger goods_receipt_lines_progress
  after insert or update or delete on goods_receipt_lines
  for each row execute function public.refresh_po_line_received();

-- ── Supplier invoices ───────────────────────────────────────────────────────

create type invoice_status as enum (
  'DRAFT',
  'MATCHING',            -- being checked against order and receipt
  'EXCEPTION',           -- something does not agree; cannot be paid
  'APPROVED_FOR_PAYMENT',
  'DISPUTED',
  'PAID',                -- recorded as paid by the AP provider, not by us
  'CANCELLED'
);

create table if not exists supplier_invoices (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  -- The supplier's own number. The unique index below is the duplicate check:
  -- paying the same invoice twice is the single most expensive AP mistake.
  invoice_number text not null,
  supplier_id uuid not null references suppliers(id) on delete restrict,
  purchase_order_id uuid references purchase_orders(id) on delete set null,

  invoice_date date not null,
  received_on date not null default current_date,
  -- Derived from the supplier's terms at entry, then held: renegotiating
  -- terms must not silently restate when old invoices were due.
  due_date date,
  payment_terms_days integer,

  currency text not null default 'IDR',
  subtotal numeric(18,5) not null default 0,
  tax_amount numeric(18,5) not null default 0,
  total_amount numeric(18,5) not null default 0,

  status invoice_status not null default 'DRAFT',
  -- Machine-readable exceptions from the matching engine, kept so the reason
  -- an invoice is held survives a page reload and a change of shift.
  exceptions jsonb not null default '[]'::jsonb,

  document_url text,
  notes text,
  entered_by uuid,
  entered_by_email text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One invoice number per supplier. The duplicate-payment control.
create unique index if not exists idx_supplier_invoices_unique
  on supplier_invoices(org_id, supplier_id, lower(invoice_number));
create index if not exists idx_supplier_invoices_status
  on supplier_invoices(org_id, status, due_date);

create table if not exists supplier_invoice_lines (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  invoice_id uuid not null references supplier_invoices(id) on delete cascade,
  purchase_order_line_id uuid references purchase_order_lines(id) on delete set null,
  product_id uuid references products(id) on delete set null,
  description text,

  quantity numeric(18,5) not null,
  unit text not null,
  unit_price numeric(18,5) not null default 0,
  tax_percent numeric(6,3) not null default 0,
  line_total numeric(18,5) not null default 0,

  line_number integer not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists idx_supplier_invoice_lines_invoice
  on supplier_invoice_lines(invoice_id);

create or replace function public.refresh_invoice_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare iid uuid;
begin
  iid := coalesce(new.invoice_id, old.invoice_id);
  update public.supplier_invoices i
     set subtotal = coalesce((select sum(l.line_total)
                                from public.supplier_invoice_lines l
                               where l.invoice_id = iid), 0),
         tax_amount = coalesce((select sum(l.line_total * l.tax_percent / 100)
                                  from public.supplier_invoice_lines l
                                 where l.invoice_id = iid), 0),
         total_amount = coalesce((select sum(l.line_total * (1 + l.tax_percent / 100))
                                    from public.supplier_invoice_lines l
                                   where l.invoice_id = iid), 0),
         updated_at = now()
   where i.id = iid;
  return null;
end;
$$;

create trigger supplier_invoice_lines_total
  after insert or update or delete on supplier_invoice_lines
  for each row execute function public.refresh_invoice_total();

/*
 * An invoice with unresolved exceptions cannot be approved for payment.
 *
 * Enforced here rather than by hiding a button, because the whole point of
 * three-way matching is that it holds when somebody is in a hurry.
 */
create or replace function public.refuse_payment_on_exception()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'APPROVED_FOR_PAYMENT'
     and jsonb_array_length(coalesce(new.exceptions, '[]'::jsonb)) > 0
  then
    raise exception 'invoice % has unresolved exceptions and cannot be approved for payment',
      new.invoice_number
      using hint = 'Resolve or formally accept each exception first.';
  end if;
  return new;
end;
$$;

create trigger supplier_invoices_block_exception
  before insert or update on supplier_invoices
  for each row execute function public.refuse_payment_on_exception();

-- Matching tolerances, as configuration rather than opinion.
create table if not exists matching_tolerances (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  -- Percentage and absolute, whichever is more generous, so a rounding
  -- difference on a small line is not an exception and a 2% swing on a large
  -- one still is.
  price_percent numeric(6,3) not null default 2,
  price_absolute numeric(18,5) not null default 5000,
  quantity_percent numeric(6,3) not null default 2,
  quantity_absolute numeric(18,5) not null default 0.5,
  created_at timestamptz not null default now(),
  constraint matching_tolerances_one_per_org unique (org_id)
);

-- ── Budgets ─────────────────────────────────────────────────────────────────

create table if not exists budgets (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  cost_centre_id uuid not null references cost_centres(id) on delete cascade,

  name text not null,
  period_start date not null,
  period_end date not null,
  amount numeric(18,5) not null,
  currency text not null default 'IDR',

  -- A soft stop warns and lets an approver proceed on the record; a hard stop
  -- refuses. Which one applies is a business decision, so it is a column.
  hard_stop boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint budgets_dates check (period_end >= period_start),
  constraint budgets_period unique (org_id, cost_centre_id, period_start, period_end)
);

/*
 * Budget position.
 *
 * Committed is what approved orders have promised but not yet been invoiced —
 * the venue is on the hook for it even though no money has moved. Actual is
 * what has been invoiced. Reporting only actual tells a kitchen it has budget
 * it has already spent.
 */
create or replace view budget_positions as
  select
    b.id as budget_id,
    b.org_id,
    b.cost_centre_id,
    b.name,
    b.period_start,
    b.period_end,
    b.amount,
    b.hard_stop,
    coalesce((
      select sum(po.total_amount - coalesce((
               select sum(si.total_amount) from public.supplier_invoices si
                where si.purchase_order_id = po.id
                  and si.status <> 'CANCELLED'), 0))
        from public.purchase_orders po
       where po.cost_centre_id = b.cost_centre_id
         and po.status in ('APPROVED','ORDERED','PARTIALLY_RECEIVED','RECEIVED')
         and coalesce(po.ordered_on, po.created_at::date) between b.period_start and b.period_end
    ), 0) as committed,
    coalesce((
      select sum(si.total_amount)
        from public.supplier_invoices si
        join public.purchase_orders po2 on po2.id = si.purchase_order_id
       where po2.cost_centre_id = b.cost_centre_id
         and si.status <> 'CANCELLED'
         and si.invoice_date between b.period_start and b.period_end
    ), 0) as actual
  from public.budgets b;

-- ── Tenancy ─────────────────────────────────────────────────────────────────

create trigger goods_receipts_set_org before insert on goods_receipts
  for each row execute function public.set_org_id();
create trigger supplier_invoices_set_org before insert on supplier_invoices
  for each row execute function public.set_org_id();
create trigger matching_tolerances_set_org before insert on matching_tolerances
  for each row execute function public.set_org_id();
create trigger budgets_set_org before insert on budgets
  for each row execute function public.set_org_id();

create or replace function public.set_child_org_from_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare parent_org uuid;
begin
  if tg_table_name = 'goods_receipt_lines' then
    select g.org_id into parent_org from public.goods_receipts g where g.id = new.goods_receipt_id;
  else
    select i.org_id into parent_org from public.supplier_invoices i where i.id = new.invoice_id;
  end if;
  if parent_org is null then
    raise exception 'parent document not found for line';
  end if;
  new.org_id := parent_org;
  return new;
end;
$$;

create trigger goods_receipt_lines_set_org before insert on goods_receipt_lines
  for each row execute function public.set_child_org_from_parent();
create trigger supplier_invoice_lines_set_org before insert on supplier_invoice_lines
  for each row execute function public.set_child_org_from_parent();

do $$
declare t text;
begin
  foreach t in array array['goods_receipts','goods_receipt_lines','supplier_invoices',
                           'supplier_invoice_lines','matching_tolerances','budgets']
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %1$s_read on %1$I for select to authenticated
         using (org_id in (select public.auth_org_ids()))', t);
    execute format(
      'create policy %1$s_insert on %1$I for insert to authenticated
         with check (public.auth_can_write(org_id))', t);
    execute format(
      'create policy %1$s_update on %1$I for update to authenticated
         using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id))', t);
    execute format(
      'create policy %1$s_delete on %1$I for delete to authenticated
         using (public.auth_can_write(org_id))', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

grant select on budget_positions to authenticated;

comment on table supplier_invoices is
  'Supplier invoices with three-way match exceptions. Cannot be approved for payment while exceptions remain.';
comment on view budget_positions is
  'Budget with committed (approved orders not yet invoiced) and actual (invoiced) spend.';

-- Starting tolerances and a budget per cost centre, so the controls are live
-- rather than theoretical. Both are business decisions to revisit.
insert into matching_tolerances (org_id) select id from organizations
on conflict do nothing;

insert into budgets (org_id, cost_centre_id, name, period_start, period_end, amount)
select c.org_id, c.id,
       'FY' || extract(year from current_date)::text || ' ' || c.name,
       date_trunc('year', current_date)::date,
       (date_trunc('year', current_date) + interval '1 year - 1 day')::date,
       case c.code when 'KITCHEN' then 2000000000 when 'BAR' then 800000000 else 200000000 end
from cost_centres c
on conflict do nothing;
