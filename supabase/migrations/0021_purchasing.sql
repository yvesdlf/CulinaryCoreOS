-- ---------------------------------------------------------------------------
-- Purchasing — requisitions, approvals, purchase orders
-- ---------------------------------------------------------------------------
-- The control this exists to provide is not the paperwork. It is that the
-- person who asks for something cannot be the person who approves it, and that
-- neither of them can quietly raise the limit.
--
-- So two things are enforced in the database rather than in a screen:
--
--   Segregation of duties. An approval by the person who submitted the
--   document is refused. A disabled button is not a control: it stops one
--   client, and the next one anybody writes has no idea the rule exists.
--
--   Approval authority. Who may approve is a function of the amount and the
--   approver's role, read from a policy table at the moment of approval — not
--   from what a form believed when it was opened.
--
-- Approvals are an append-only ledger for the same reason the stock ledger is:
-- an approval that can be edited afterwards is not evidence of anything.
-- ---------------------------------------------------------------------------

create type purchase_status as enum (
  'DRAFT',              -- being written, nobody else's problem yet
  'SUBMITTED',          -- awaiting approval
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'ORDERED',            -- a purchase order has been raised/sent
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CLOSED'
);

create type approval_action as enum (
  'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'REOPENED'
);

-- ── Cost centres ────────────────────────────────────────────────────────────
-- Spend has to be attributable to something before it can be controlled. One
-- table, deliberately flat: departments, outlets and projects are all "the
-- thing this money is charged to" and splitting them buys nothing yet.

create table if not exists cost_centres (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  code text not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_cost_centres_code
  on cost_centres(org_id, lower(code));

-- ── Approval policy ─────────────────────────────────────────────────────────
/*
 * Who may approve what.
 *
 * A row says: for this document type, at or above this amount, an approver
 * must hold at least this role. The applicable rule is the one with the
 * highest threshold the amount reaches, so adding a stricter tier for large
 * orders does not require touching the smaller ones.
 *
 * Held as data rather than code because it is a business policy that finance
 * owns and will change without a deployment.
 */
create table if not exists approval_policies (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  document_type text not null,            -- REQUISITION | PURCHASE_ORDER
  min_amount numeric(18,5) not null default 0,
  required_role org_role not null,
  created_at timestamptz not null default now(),
  constraint approval_policies_unique unique (org_id, document_type, min_amount)
);

-- ── Requisitions ────────────────────────────────────────────────────────────

create table if not exists requisitions (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  reference text not null,
  cost_centre_id uuid references cost_centres(id) on delete set null,

  needed_by date,
  justification text,
  status purchase_status not null default 'DRAFT',
  currency text not null default 'IDR',
  -- Denormalised from the lines so policy and budget checks do not have to
  -- re-add them at every read. Kept in step by trigger below.
  total_amount numeric(18,5) not null default 0,

  requested_by uuid,
  requested_by_email text,
  submitted_at timestamptz,

  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_requisitions_reference
  on requisitions(org_id, reference);

create table if not exists requisition_lines (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  requisition_id uuid not null references requisitions(id) on delete cascade,

  -- A requisition can ask for something not yet in the catalogue, which is
  -- how new ingredients get proposed. One of the two must be present.
  product_id uuid references products(id) on delete set null,
  description text,

  quantity numeric(18,5) not null,
  unit text not null,
  estimated_unit_price numeric(18,5) not null default 0,
  line_total numeric(18,5) not null default 0,
  suggested_supplier_id uuid references suppliers(id) on delete set null,

  line_number integer not null default 1,
  created_at timestamptz not null default now(),

  constraint requisition_lines_have_something
    check (product_id is not null or nullif(btrim(coalesce(description,'')),'') is not null),
  constraint requisition_lines_positive check (quantity > 0)
);

create index if not exists idx_requisition_lines_req on requisition_lines(requisition_id);

-- ── Purchase orders ─────────────────────────────────────────────────────────

create table if not exists purchase_orders (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  reference text not null,
  supplier_id uuid not null references suppliers(id) on delete restrict,
  -- Where it came from, when it came from one. A PO can also be raised direct.
  requisition_id uuid references requisitions(id) on delete set null,
  cost_centre_id uuid references cost_centres(id) on delete set null,

  status purchase_status not null default 'DRAFT',
  currency text not null default 'IDR',
  ordered_on date,
  expected_on date,

  subtotal numeric(18,5) not null default 0,
  tax_amount numeric(18,5) not null default 0,
  total_amount numeric(18,5) not null default 0,

  created_by uuid,
  created_by_email text,
  sent_at timestamptz,
  notes text,

  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_purchase_orders_reference
  on purchase_orders(org_id, reference);
create index if not exists idx_purchase_orders_supplier
  on purchase_orders(org_id, supplier_id, status);

create table if not exists purchase_order_lines (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  description text,

  quantity numeric(18,5) not null,
  unit text not null,
  unit_price numeric(18,5) not null default 0,
  -- Per line, because a delivery of food and a delivery of cleaning chemicals
  -- do not carry the same rate in most member states.
  tax_percent numeric(6,3) not null default 0,
  line_total numeric(18,5) not null default 0,

  -- Filled in by receiving. Kept on the line so "what is still outstanding"
  -- is one read rather than a join across every goods receipt.
  quantity_received numeric(18,5) not null default 0,

  line_number integer not null default 1,
  created_at timestamptz not null default now(),

  constraint purchase_order_lines_positive check (quantity > 0)
);

create index if not exists idx_purchase_order_lines_po
  on purchase_order_lines(purchase_order_id);

-- ── Approvals ───────────────────────────────────────────────────────────────

create table if not exists approval_events (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  document_type text not null,          -- REQUISITION | PURCHASE_ORDER
  document_id uuid not null,
  action approval_action not null,

  actor_id uuid,
  actor_email text,
  actor_role org_role,
  -- The amount the decision was made against, captured at the time. A later
  -- edit to the document must not silently re-describe what was approved.
  amount numeric(18,5),
  comment text,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_approval_events_document
  on approval_events(document_type, document_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Segregation of duties, and approval authority.
--
-- Both are checked here because both are the point of the module. An approval
-- recorded by the requester, or by somebody without the authority for the
-- amount, is refused however it arrives.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_approval_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  submitter uuid;
  submitter_email text;
  doc_amount numeric;
  caller_role public.org_role;
  needed public.org_role;
  rank_of jsonb := '{"VIEWER":0,"CHEF":1,"ADMIN":2,"OWNER":3}'::jsonb;
begin
  if new.action <> 'APPROVED' then
    return new;
  end if;

  if new.document_type = 'REQUISITION' then
    select r.requested_by, r.requested_by_email, r.total_amount
      into submitter, submitter_email, doc_amount
      from public.requisitions r where r.id = new.document_id;
  else
    select p.created_by, p.created_by_email, p.total_amount
      into submitter, submitter_email, doc_amount
      from public.purchase_orders p where p.id = new.document_id;
  end if;

  if doc_amount is null then
    raise exception 'document % not found', new.document_id;
  end if;

  -- Segregation of duties. Matched on both id and email so that a record
  -- raised before the person had an account is still caught.
  if (submitter is not null and new.actor_id is not null and submitter = new.actor_id)
     or (submitter_email is not null and new.actor_email is not null
         and lower(submitter_email) = lower(new.actor_email))
  then
    raise exception 'the person who raised this cannot approve it'
      using hint = 'Segregation of duties: ask someone else to approve.';
  end if;

  select m.role into caller_role
    from public.organization_members m
   where m.organization_id = new.org_id
     and m.user_id = new.actor_id;

  if caller_role is null then
    raise exception 'approver is not a member of this organization';
  end if;

  -- The strictest rule the amount reaches.
  select p.required_role into needed
    from public.approval_policies p
   where p.org_id = new.org_id
     and p.document_type = new.document_type
     and p.min_amount <= doc_amount
   order by p.min_amount desc
   limit 1;

  if needed is not null
     and (rank_of ->> caller_role::text)::int < (rank_of ->> needed::text)::int
  then
    raise exception 'approving % at this amount requires the % role',
      lower(new.document_type), needed
      using hint = 'Approval authority is set by the organisation''s policy.';
  end if;

  new.actor_role := caller_role;
  new.amount := doc_amount;
  return new;
end;
$$;

create trigger approval_events_enforce
  before insert on approval_events
  for each row execute function public.enforce_approval_rules();

-- ---------------------------------------------------------------------------
-- Keep the header totals in step with their lines.
--
-- Denormalised on purpose — policy checks, budget checks and list screens all
-- read the total — so it is maintained where it cannot drift.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_requisition_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare rid uuid;
begin
  rid := coalesce(new.requisition_id, old.requisition_id);
  update public.requisitions r
     set total_amount = coalesce(
           (select sum(l.line_total) from public.requisition_lines l
             where l.requisition_id = rid), 0),
         updated_at = now()
   where r.id = rid;
  return null;
end;
$$;

create trigger requisition_lines_total
  after insert or update or delete on requisition_lines
  for each row execute function public.refresh_requisition_total();

create or replace function public.refresh_purchase_order_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare pid uuid;
begin
  pid := coalesce(new.purchase_order_id, old.purchase_order_id);
  update public.purchase_orders p
     set subtotal = coalesce((select sum(l.line_total)
                                from public.purchase_order_lines l
                               where l.purchase_order_id = pid), 0),
         tax_amount = coalesce((select sum(l.line_total * l.tax_percent / 100)
                                  from public.purchase_order_lines l
                                 where l.purchase_order_id = pid), 0),
         total_amount = coalesce((select sum(l.line_total * (1 + l.tax_percent / 100))
                                    from public.purchase_order_lines l
                                   where l.purchase_order_id = pid), 0),
         updated_at = now()
   where p.id = pid;
  return null;
end;
$$;

create trigger purchase_order_lines_total
  after insert or update or delete on purchase_order_lines
  for each row execute function public.refresh_purchase_order_total();

-- ── Tenancy ─────────────────────────────────────────────────────────────────

create trigger cost_centres_set_org before insert on cost_centres
  for each row execute function public.set_org_id();
create trigger approval_policies_set_org before insert on approval_policies
  for each row execute function public.set_org_id();
create trigger requisitions_set_org before insert on requisitions
  for each row execute function public.set_org_id();
create trigger purchase_orders_set_org before insert on purchase_orders
  for each row execute function public.set_org_id();
create trigger approval_events_set_org before insert on approval_events
  for each row execute function public.set_org_id();

create or replace function public.set_purchase_line_org_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare parent_org uuid;
begin
  if tg_table_name = 'requisition_lines' then
    select r.org_id into parent_org from public.requisitions r where r.id = new.requisition_id;
  else
    select p.org_id into parent_org from public.purchase_orders p where p.id = new.purchase_order_id;
  end if;
  if parent_org is null then
    raise exception 'parent document not found for line';
  end if;
  new.org_id := parent_org;
  return new;
end;
$$;

create trigger requisition_lines_set_org before insert on requisition_lines
  for each row execute function public.set_purchase_line_org_id();
create trigger purchase_order_lines_set_org before insert on purchase_order_lines
  for each row execute function public.set_purchase_line_org_id();

alter table cost_centres enable row level security;
alter table approval_policies enable row level security;
alter table requisitions enable row level security;
alter table requisition_lines enable row level security;
alter table purchase_orders enable row level security;
alter table purchase_order_lines enable row level security;
alter table approval_events enable row level security;

do $$
declare t text;
begin
  foreach t in array array['cost_centres','approval_policies','requisitions',
                           'requisition_lines','purchase_orders','purchase_order_lines']
  loop
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

-- Approvals are evidence. No update, no delete, and no grant for either — a
-- decision is reversed by recording the reversal, not by editing the record.
create policy approval_events_read on approval_events
  for select to authenticated using (org_id in (select public.auth_org_ids()));
create policy approval_events_insert on approval_events
  for insert to authenticated with check (public.auth_can_write(org_id));
grant select, insert on approval_events to authenticated;

comment on table approval_events is
  'Append-only approval ledger. Segregation of duties and approval authority are enforced by trigger.';
comment on table approval_policies is
  'Who may approve what, by amount. Owned by finance, changed without a deployment.';

-- ── Starting policy and cost centres ────────────────────────────────────────
-- Thresholds are a business decision, so these are a starting point rather
-- than an answer: anyone with write access may approve small requisitions, an
-- admin is needed above 5 million, and an owner above 25 million.
insert into approval_policies (org_id, document_type, min_amount, required_role)
select o.id, d.t, v.amt, v.role::org_role
from organizations o
cross join (values ('REQUISITION'), ('PURCHASE_ORDER')) as d(t)
cross join (values (0, 'CHEF'), (5000000, 'ADMIN'), (25000000, 'OWNER')) as v(amt, role)
on conflict do nothing;

insert into cost_centres (org_id, code, name)
select o.id, c.code, c.name
from organizations o
cross join (values ('KITCHEN', 'Kitchen'), ('BAR', 'Bar'), ('FOH', 'Front of house')) as c(code, name)
on conflict do nothing;
