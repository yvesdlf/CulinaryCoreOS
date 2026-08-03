-- ---------------------------------------------------------------------------
-- Sourcing — requests for quotation
-- ---------------------------------------------------------------------------
-- Ask several suppliers what they would charge, compare, and award.
--
-- The property that matters is that a supplier sees their own quote and never
-- anybody else's. A sealed bid that leaks is worse than no process at all: it
-- lets the last supplier to respond undercut the others by a rupiah, and once
-- that is suspected the quotes stop being honest.
--
-- So quote visibility is scoped the same way the rest of the portal is —
-- through views filtered by `auth_supplier_id()`, with the base tables denied
-- to suppliers entirely because they are not members of the organisation.
--
-- Awarding records why. A cheaper quote is not automatically the right one:
-- lead time, minimum order and a supplier's delivery record all matter, and a
-- buyer who chose the dearer quote should be able to say so on the record
-- rather than being second-guessed a year later.
-- ---------------------------------------------------------------------------

create type rfq_status as enum ('DRAFT', 'SENT', 'CLOSED', 'AWARDED', 'CANCELLED');

create table if not exists rfqs (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  reference text not null,
  title text not null,
  status rfq_status not null default 'DRAFT',

  needed_by date,
  -- After this, late quotes are still recorded but marked as late rather than
  -- refused: a supplier who missed the deadline by an hour with the best price
  -- is a decision for a buyer, not for a constraint.
  closes_at timestamptz,

  notes text,
  created_by_email text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_rfqs_reference on rfqs(org_id, lower(reference));

create table if not exists rfq_lines (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  rfq_id uuid not null references rfqs(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  description text,
  quantity numeric(18,5) not null,
  unit text not null,
  line_number integer not null default 1,
  created_at timestamptz not null default now(),
  constraint rfq_lines_positive check (quantity > 0)
);

create index if not exists idx_rfq_lines_rfq on rfq_lines(rfq_id);

-- Who was asked.
create table if not exists rfq_suppliers (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  rfq_id uuid not null references rfqs(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  invited_at timestamptz not null default now(),
  responded_at timestamptz,
  declined boolean not null default false,
  decline_reason text,
  constraint rfq_suppliers_unique unique (rfq_id, supplier_id)
);

create table if not exists rfq_quotes (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  rfq_id uuid not null references rfqs(id) on delete cascade,
  rfq_line_id uuid not null references rfq_lines(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,

  unit_price numeric(18,5) not null,
  lead_time_days integer,
  minimum_quantity numeric(18,5),
  note text,

  submitted_at timestamptz not null default now(),
  -- Recorded rather than refused; see the note on closes_at.
  is_late boolean not null default false,

  constraint rfq_quotes_unique unique (rfq_line_id, supplier_id),
  constraint rfq_quotes_price check (unit_price >= 0)
);

create index if not exists idx_rfq_quotes_line on rfq_quotes(rfq_line_id);

create table if not exists rfq_awards (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  rfq_id uuid not null references rfqs(id) on delete cascade,
  rfq_line_id uuid not null references rfq_lines(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete restrict,
  quote_id uuid references rfq_quotes(id) on delete set null,

  -- Required. A buyer who chose the dearer quote should say why on the record
  -- rather than be second-guessed a year later.
  rationale text not null,
  awarded_by_email text,
  awarded_at timestamptz not null default now(),
  -- Filled in when the award becomes a real order.
  purchase_order_id uuid references purchase_orders(id) on delete set null,

  constraint rfq_awards_one_per_line unique (rfq_line_id),
  constraint rfq_awards_rationale check (btrim(rationale) <> '')
);

/*
 * Mark a quote late if it arrived after the deadline.
 *
 * Computed at submission rather than compared at read time, so the fact does
 * not change when somebody looks at it next week.
 */
create or replace function public.mark_late_quote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare deadline timestamptz;
begin
  select r.closes_at into deadline from public.rfqs r where r.id = new.rfq_id;
  new.is_late := deadline is not null and new.submitted_at > deadline;
  return new;
end;
$$;

create trigger rfq_quotes_mark_late
  before insert on rfq_quotes
  for each row execute function public.mark_late_quote();

/** Quote comparison for a line, cheapest first, with the award if made. */
create or replace view rfq_comparison as
  select
    l.rfq_id,
    l.id as rfq_line_id,
    l.line_number,
    coalesce(l.description, p.name) as description,
    l.quantity,
    l.unit,
    q.id as quote_id,
    q.supplier_id,
    s.name as supplier_name,
    q.unit_price,
    (q.unit_price * l.quantity) as line_total,
    q.lead_time_days,
    q.minimum_quantity,
    q.note,
    q.is_late,
    (a.id is not null) as awarded
  from public.rfq_lines l
  left join public.products p on p.id = l.product_id
  left join public.rfq_quotes q on q.rfq_line_id = l.id
  left join public.suppliers s on s.id = q.supplier_id
  left join public.rfq_awards a on a.rfq_line_id = l.id and a.supplier_id = q.supplier_id
  where l.org_id in (select public.auth_org_ids());

grant select on rfq_comparison to authenticated;

-- ── The supplier's side ─────────────────────────────────────────────────────
/*
 * What a supplier sees. Their invitations, the lines they were asked about,
 * and their own quotes — never anybody else's, and never the comparison.
 */
create or replace view portal_rfqs as
  select
    r.id, r.reference, r.title, r.status, r.needed_by, r.closes_at, r.notes,
    o.name as buyer_name,
    rs.responded_at, rs.declined
  from public.rfqs r
  join public.rfq_suppliers rs on rs.rfq_id = r.id
  join public.organizations o on o.id = r.org_id
  where rs.supplier_id = public.auth_supplier_id()
    and r.status in ('SENT', 'CLOSED', 'AWARDED');

create or replace view portal_rfq_lines as
  select
    l.id, l.rfq_id, l.line_number,
    coalesce(l.description, p.name) as description,
    l.quantity, l.unit,
    -- Their own quote only. Another supplier's price is not selected here at
    -- all, so there is nothing to leak.
    q.unit_price as my_unit_price,
    q.lead_time_days as my_lead_time_days,
    q.note as my_note
  from public.rfq_lines l
  join public.rfqs r on r.id = l.rfq_id
  join public.rfq_suppliers rs on rs.rfq_id = r.id
    and rs.supplier_id = public.auth_supplier_id()
  left join public.products p on p.id = l.product_id
  left join public.rfq_quotes q on q.rfq_line_id = l.id
    and q.supplier_id = public.auth_supplier_id()
  where r.status in ('SENT', 'CLOSED', 'AWARDED');

grant select on portal_rfqs, portal_rfq_lines to authenticated;

/**
 * Submit or revise a quote.
 *
 * An RPC, so a supplier writes a price on a line they were invited to and
 * nothing else. A table policy would let them write any column the grant
 * allows, including somebody else's supplier_id.
 */
create or replace function public.submit_quote(
  p_line uuid, p_unit_price numeric,
  p_lead_time_days integer default null, p_note text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare me uuid; the_rfq uuid; the_org uuid;
begin
  me := public.auth_supplier_id();
  if me is null then raise exception 'not a supplier contact'; end if;

  select l.rfq_id, l.org_id into the_rfq, the_org
    from public.rfq_lines l
    join public.rfqs r on r.id = l.rfq_id
    join public.rfq_suppliers rs on rs.rfq_id = r.id and rs.supplier_id = me
   where l.id = p_line and r.status = 'SENT';

  if the_rfq is null then
    raise exception 'that line is not open to you for quoting';
  end if;

  insert into public.rfq_quotes
    (org_id, rfq_id, rfq_line_id, supplier_id, unit_price, lead_time_days, note)
  values (the_org, the_rfq, p_line, me, p_unit_price, p_lead_time_days, p_note)
  on conflict (rfq_line_id, supplier_id) do update
    set unit_price = excluded.unit_price,
        lead_time_days = excluded.lead_time_days,
        note = excluded.note,
        submitted_at = now();

  update public.rfq_suppliers
     set responded_at = now()
   where rfq_id = the_rfq and supplier_id = me;
end;
$$;

grant execute on function public.submit_quote(uuid, numeric, integer, text) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['rfqs','rfq_lines','rfq_suppliers','rfq_quotes','rfq_awards']
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

create trigger rfqs_set_org before insert on rfqs
  for each row execute function public.set_org_id();

create or replace function public.set_rfq_child_org_id()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent_org uuid;
begin
  select r.org_id into parent_org from public.rfqs r where r.id = new.rfq_id;
  if parent_org is null then raise exception 'rfq not found'; end if;
  new.org_id := parent_org;
  return new;
end;
$$;

create trigger rfq_lines_set_org before insert on rfq_lines
  for each row execute function public.set_rfq_child_org_id();
create trigger rfq_suppliers_set_org before insert on rfq_suppliers
  for each row execute function public.set_rfq_child_org_id();
create trigger rfq_quotes_set_org before insert on rfq_quotes
  for each row execute function public.set_rfq_child_org_id();
create trigger rfq_awards_set_org before insert on rfq_awards
  for each row execute function public.set_rfq_child_org_id();

comment on table rfq_quotes is
  'Sealed: a supplier reads only their own, through portal_rfq_lines.';
comment on table rfq_awards is
  'Why a quote was chosen. Rationale is required — the cheapest is not always the right one.';
