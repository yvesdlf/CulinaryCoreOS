-- ---------------------------------------------------------------------------
-- Vendor portal, and the communication cycle
-- ---------------------------------------------------------------------------
-- Two things that only make sense together: giving a supplier a way in, and
-- telling people when something needs them.
--
-- The portal's whole risk is leakage. A supplier must see their own orders and
-- nothing else — not another supplier's prices, not what we sell their goods
-- for, not which cost centre pays, not who approved it. So a supplier user is
-- deliberately NOT a member of the organisation. `auth_org_ids()` returns
-- nothing for them, which means every existing policy in the system already
-- denies them by default, and their access comes only from the narrow views
-- below.
--
-- That is the safe direction to fail in. Adding a supplier to the org and then
-- trying to subtract what they must not see would mean every future table
-- silently grants them something.
--
-- The views are the interface, not the tables. They carry the columns a
-- supplier legitimately needs and no others, and their WHERE clause is the
-- scoping. A column added to purchase_orders next year does not appear in the
-- portal unless somebody puts it there.
-- ---------------------------------------------------------------------------

-- ── Who a supplier user is ──────────────────────────────────────────────────

create table if not exists supplier_users (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,

  email text not null,
  user_id uuid,
  contact_name text,

  invited_by_email text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  accepted_at timestamptz,
  revoked_at timestamptz
);

create unique index if not exists idx_supplier_users_pending
  on supplier_users(supplier_id, lower(email))
  where revoked_at is null;
create index if not exists idx_supplier_users_user on supplier_users(user_id);

/*
 * The supplier the caller represents, if any.
 *
 * Returns null for everybody else, including every member of the venue. A
 * person is one or the other; there is no case where somebody is both a buyer
 * and the supplier being bought from, and allowing it would defeat the point.
 */
create or replace function public.auth_supplier_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.supplier_id
  from public.supplier_users s
  where s.user_id = (select auth.uid())
    and s.accepted_at is not null
    and s.revoked_at is null
  limit 1;
$$;

grant execute on function public.auth_supplier_id() to authenticated;

/** Accept a portal invitation. The supplier's own action, like a member's. */
create or replace function public.accept_supplier_invitation(invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare inv public.supplier_users; caller_email text;
begin
  select lower(coalesce(auth.jwt() ->> 'email', '')) into caller_email;
  if caller_email = '' then raise exception 'not signed in'; end if;

  select * into inv from public.supplier_users
   where id = invitation_id
     and lower(email) = caller_email
     and accepted_at is null
     and revoked_at is null
     and expires_at > now();

  if inv is null then
    raise exception 'this invitation is not available'
      using hint = 'It may have been used, revoked, or expired.';
  end if;

  update public.supplier_users
     set accepted_at = now(), user_id = auth.uid()
   where id = inv.id;
  return inv.supplier_id;
end;
$$;

grant execute on function public.accept_supplier_invitation(uuid) to authenticated;

alter table supplier_users enable row level security;

create trigger supplier_users_set_org before insert on supplier_users
  for each row execute function public.set_org_id();

-- The venue manages these; a supplier may read the invitation addressed to
-- them so they can accept it.
create policy supplier_users_read on supplier_users
  for select to authenticated
  using (
    org_id in (select public.auth_org_ids())
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
create policy supplier_users_write on supplier_users
  for insert to authenticated with check (public.auth_can_write(org_id));
create policy supplier_users_update on supplier_users
  for update to authenticated using (public.auth_can_write(org_id));

grant select, insert, update on supplier_users to authenticated;

-- ── Order acknowledgement ───────────────────────────────────────────────────

alter table purchase_orders
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_by_email text,
  add column if not exists supplier_note text,
  -- What the supplier says they will deliver, which is not always what we asked.
  add column if not exists supplier_promised_on date;

comment on column purchase_orders.supplier_promised_on is
  'The date the supplier committed to, as distinct from the date we asked for.';

-- ── The portal's view of the world ──────────────────────────────────────────
/*
 * Deliberately narrow. Compare with `purchase_orders`, which also carries the
 * cost centre, the requisition it came from, who created it and our internal
 * notes. None of that is a supplier's business.
 */
create or replace view portal_orders as
  select
    p.id,
    p.reference,
    p.status,
    p.currency,
    p.ordered_on,
    p.expected_on,
    p.subtotal,
    p.tax_amount,
    p.total_amount,
    p.acknowledged_at,
    p.supplier_promised_on,
    p.supplier_note,
    o.name as buyer_name
  from public.purchase_orders p
  join public.organizations o on o.id = p.org_id
  where p.supplier_id = public.auth_supplier_id()
    -- A draft is not an order and the supplier has not been told about it.
    and p.status <> 'DRAFT';

create or replace view portal_order_lines as
  select
    l.id,
    l.purchase_order_id,
    l.line_number,
    -- The product's name, not our catalogue record: no cost, no yield, no
    -- allergen data, nothing about what we make from it.
    coalesce(l.description, pr.name) as description,
    l.quantity,
    l.unit,
    -- The price we agreed with them, which they already know.
    l.unit_price,
    l.tax_percent,
    l.line_total,
    l.quantity_received
  from public.purchase_order_lines l
  join public.purchase_orders p on p.id = l.purchase_order_id
  left join public.products pr on pr.id = l.product_id
  where p.supplier_id = public.auth_supplier_id()
    and p.status <> 'DRAFT';

create or replace view portal_invoices as
  select
    i.id,
    i.invoice_number,
    i.invoice_date,
    i.due_date,
    i.total_amount,
    i.currency,
    -- Simplified: a supplier is told their invoice is held, not the internal
    -- reasoning behind each exception.
    case i.status
      when 'APPROVED_FOR_PAYMENT' then 'Approved for payment'
      when 'PAID' then 'Paid'
      when 'DISPUTED' then 'Query raised'
      when 'EXCEPTION' then 'On hold'
      when 'CANCELLED' then 'Cancelled'
      else 'Being checked'
    end as status,
    (jsonb_array_length(coalesce(i.exceptions, '[]'::jsonb)) > 0) as has_query
  from public.supplier_invoices i
  where i.supplier_id = public.auth_supplier_id();

create or replace view portal_deliveries as
  select
    g.id,
    g.reference,
    g.received_on,
    g.delivery_note,
    p.reference as order_reference,
    (select count(*) from public.goods_receipt_lines gl
      where gl.goods_receipt_id = g.id and gl.quantity_rejected > 0) as rejected_lines
  from public.goods_receipts g
  left join public.purchase_orders p on p.id = g.purchase_order_id
  where g.supplier_id = public.auth_supplier_id();

grant select on portal_orders, portal_order_lines, portal_invoices, portal_deliveries
  to authenticated;

/*
 * Acknowledging an order.
 *
 * An RPC rather than a policy, because a supplier must be able to write
 * exactly four fields on exactly their own orders, and a table-level update
 * policy would let them write any column the grant allows.
 */
create or replace function public.acknowledge_purchase_order(
  order_id uuid,
  promised_on date default null,
  note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare caller_supplier uuid;
begin
  caller_supplier := public.auth_supplier_id();
  if caller_supplier is null then
    raise exception 'not a supplier contact';
  end if;

  update public.purchase_orders p
     set acknowledged_at = now(),
         acknowledged_by_email = coalesce(auth.jwt() ->> 'email', ''),
         supplier_promised_on = coalesce(promised_on, p.supplier_promised_on),
         supplier_note = coalesce(note, p.supplier_note),
         updated_at = now()
   where p.id = order_id
     and p.supplier_id = caller_supplier
     and p.status <> 'DRAFT';

  if not found then
    raise exception 'that order is not yours to acknowledge';
  end if;
end;
$$;

grant execute on function public.acknowledge_purchase_order(uuid, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Notifications — the communication cycle
-- ---------------------------------------------------------------------------
-- The cycle in the brief is a sequence of moments where somebody needs to be
-- told: a requisition needs approving, an order has gone out, a delivery
-- arrived short, an invoice is on hold.
--
-- Every one of those is recorded here. What is NOT here is a channel: nothing
-- is emailed or messaged, because which channel a venue uses is a decision
-- nobody has made yet. A notification carries the channel it was delivered on
-- so an email or WhatsApp adapter can be added later and mark the same row,
-- rather than a second, parallel history appearing beside this one.
-- ---------------------------------------------------------------------------

create type notification_kind as enum (
  'REQUISITION_SUBMITTED',
  'REQUISITION_DECIDED',
  'ORDER_SENT',
  'ORDER_ACKNOWLEDGED',
  'DELIVERY_RECORDED',
  'DELIVERY_SHORT',
  'INVOICE_ON_HOLD',
  'INVOICE_APPROVED',
  'LEAVE_REQUESTED',
  'LEAVE_DECIDED',
  'CERTIFICATE_EXPIRING'
);

create table if not exists notifications (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  kind notification_kind not null,
  subject text not null,
  body text,

  -- Exactly one of these. A notification is either for the venue's people or
  -- for one supplier, never both, because the wording differs and so does
  -- what may be said.
  audience_role org_role,
  supplier_id uuid references suppliers(id) on delete cascade,

  -- What it is about, so the UI can link to it.
  entity_type text,
  entity_id uuid,

  channel text not null default 'IN_APP',
  delivered_at timestamptz not null default now(),
  read_at timestamptz,
  read_by uuid,

  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_unread
  on notifications(org_id, created_at desc) where read_at is null;
create index if not exists idx_notifications_supplier
  on notifications(supplier_id, created_at desc);

alter table notifications enable row level security;

create trigger notifications_set_org before insert on notifications
  for each row execute function public.set_org_id();

/*
 * A supplier sees only notifications addressed to them; the venue's people
 * see only those addressed to the venue.
 */
create policy notifications_read on notifications
  for select to authenticated
  using (
    (supplier_id is null and org_id in (select public.auth_org_ids()))
    or (supplier_id is not null and supplier_id = public.auth_supplier_id())
  );

create policy notifications_insert on notifications
  for insert to authenticated with check (public.auth_can_write(org_id));

-- Marking as read is the only update anybody makes.
create policy notifications_update on notifications
  for update to authenticated
  using (
    (supplier_id is null and org_id in (select public.auth_org_ids()))
    or (supplier_id is not null and supplier_id = public.auth_supplier_id())
  );

grant select, insert, update on notifications to authenticated;

/** Raise a notification. Used by the triggers below. */
create or replace function public.notify(
  p_org uuid, p_kind public.notification_kind, p_subject text, p_body text,
  p_role public.org_role default null, p_supplier uuid default null,
  p_entity_type text default null, p_entity_id uuid default null
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications
    (org_id, kind, subject, body, audience_role, supplier_id, entity_type, entity_id)
  values (p_org, p_kind, p_subject, p_body, p_role, p_supplier, p_entity_type, p_entity_id);
$$;

/*
 * The cycle itself.
 *
 * Raised by trigger rather than by the pages, so a requisition submitted by a
 * script, an import or a future mobile client tells the approvers just the
 * same. A notification that only fires when somebody used the right screen is
 * not a communication cycle.
 */
create or replace function public.notify_requisition_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status = 'SUBMITTED' then
      perform public.notify(
        new.org_id, 'REQUISITION_SUBMITTED',
        new.reference || ' needs approving',
        coalesce(new.requested_by_email, 'Someone') || ' raised it for ' ||
          to_char(new.total_amount, 'FM999,999,999,990D00') || '.',
        'ADMIN', null, 'requisition', new.id);
    elsif new.status in ('APPROVED', 'REJECTED') then
      perform public.notify(
        new.org_id, 'REQUISITION_DECIDED',
        new.reference || ' was ' || lower(new.status::text),
        null, 'CHEF', null, 'requisition', new.id);
    end if;
  end if;
  return null;
end;
$$;

create trigger requisitions_notify
  after insert or update on requisitions
  for each row execute function public.notify_requisition_change();

create or replace function public.notify_order_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  /*
   * On insert as well as on update. An order can be created already ordered —
   * by an import, or by a page that raises and sends in one step — and a
   * cycle that only fires on a status *change* would silently tell the
   * supplier nothing in exactly that case.
   */
  if new.status = 'ORDERED'
     and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    -- To the supplier, in their language, with none of our internals.
    perform public.notify(
      new.org_id, 'ORDER_SENT',
      'New order ' || new.reference,
      'Please confirm and tell us when you can deliver.',
      null, new.supplier_id, 'purchase_order', new.id);
  end if;

  if tg_op = 'UPDATE' and new.acknowledged_at is not null
     and old.acknowledged_at is null then
    perform public.notify(
      new.org_id, 'ORDER_ACKNOWLEDGED',
      new.reference || ' confirmed by the supplier',
      case when new.supplier_promised_on is not null
        then 'Promised for ' || new.supplier_promised_on::text || '.'
        else null end,
      'CHEF', null, 'purchase_order', new.id);
  end if;
  return null;
end;
$$;

create trigger purchase_orders_notify
  after insert or update on purchase_orders
  for each row execute function public.notify_order_change();

create or replace function public.notify_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare rejected numeric;
begin
  select coalesce(sum(quantity_rejected), 0) into rejected
    from public.goods_receipt_lines where goods_receipt_id = new.id;

  perform public.notify(
    new.org_id, 'DELIVERY_RECORDED',
    'Delivery ' || new.reference || ' booked in',
    null, 'CHEF', null, 'goods_receipt', new.id);
  return null;
end;
$$;

create trigger goods_receipts_notify
  after insert on goods_receipts
  for each row execute function public.notify_delivery();

/*
 * A short or rejected delivery is told to both sides.
 *
 * On the receipt line rather than the header, because the rejection is
 * recorded per line and the header is written before the lines exist.
 */
create or replace function public.notify_rejection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare sup uuid; ref text;
begin
  if new.quantity_rejected <= 0 then return null; end if;
  select g.supplier_id, g.reference into sup, ref
    from public.goods_receipts g where g.id = new.goods_receipt_id;

  perform public.notify(
    new.org_id, 'DELIVERY_SHORT',
    'Goods rejected on ' || coalesce(ref, 'a delivery'),
    coalesce(new.rejection_reason, 'No reason recorded') || '.',
    'ADMIN', null, 'goods_receipt', new.goods_receipt_id);

  if sup is not null then
    perform public.notify(
      new.org_id, 'DELIVERY_SHORT',
      'Some goods were not accepted on ' || coalesce(ref, 'a recent delivery'),
      coalesce(new.rejection_reason, 'Please get in touch.') || '.',
      null, sup, 'goods_receipt', new.goods_receipt_id);
  end if;
  return null;
end;
$$;

create trigger goods_receipt_lines_notify
  after insert on goods_receipt_lines
  for each row execute function public.notify_rejection();

create or replace function public.notify_invoice_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status = 'EXCEPTION' then
      perform public.notify(
        new.org_id, 'INVOICE_ON_HOLD',
        'Invoice ' || new.invoice_number || ' is on hold',
        jsonb_array_length(coalesce(new.exceptions, '[]'::jsonb))::text ||
          ' thing(s) do not match the order or the delivery.',
        'ADMIN', null, 'invoice', new.id);
      perform public.notify(
        new.org_id, 'INVOICE_ON_HOLD',
        'We have a query on invoice ' || new.invoice_number,
        'We will be in touch shortly.',
        null, new.supplier_id, 'invoice', new.id);
    elsif new.status = 'APPROVED_FOR_PAYMENT' then
      perform public.notify(
        new.org_id, 'INVOICE_APPROVED',
        'Invoice ' || new.invoice_number || ' approved for payment',
        case when new.due_date is not null
          then 'Due ' || new.due_date::text || '.' else null end,
        null, new.supplier_id, 'invoice', new.id);
    end if;
  end if;
  return null;
end;
$$;

create trigger supplier_invoices_notify
  after insert or update on supplier_invoices
  for each row execute function public.notify_invoice_change();

create or replace function public.notify_leave_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.status = 'REQUESTED' then
    perform public.notify(
      new.org_id, 'LEAVE_REQUESTED', 'Leave request to decide',
      coalesce(new.requested_by_email, 'Someone') || ' asked for ' ||
        new.days::text || ' day(s) from ' || new.starts_on::text || '.',
      'ADMIN', null, 'leave_request', new.id);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status
        and new.status in ('APPROVED', 'REJECTED') then
    perform public.notify(
      new.org_id, 'LEAVE_DECIDED',
      'Leave ' || lower(new.status::text),
      new.starts_on::text || ' to ' || new.ends_on::text || '.',
      'CHEF', null, 'leave_request', new.id);
  end if;
  return null;
end;
$$;

create trigger leave_requests_notify
  after insert or update on leave_requests
  for each row execute function public.notify_leave_change();

comment on table notifications is
  'The communication cycle. Delivery is in-app only; email and messaging adapters mark the same row.';
comment on view portal_orders is
  'What a supplier may see of their orders. Narrow on purpose — compare purchase_orders.';
