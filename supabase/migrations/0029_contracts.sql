-- ---------------------------------------------------------------------------
-- Contracts — SRS 4.9 §16
-- ---------------------------------------------------------------------------
-- What was agreed with a supplier, and whether we are getting it.
--
-- The reason this is worth a table rather than a folder of PDFs is the price
-- schedule. A contract that says guanciale costs 590.000 a kilo until March is
-- only useful if something checks the invoice against it — otherwise the
-- agreement and the buying drift apart and nobody notices until the year-end.
--
-- Two dates matter and they are not the same one. `ends_on` is when the
-- agreement stops; `notice_by` is the last day to give notice of not renewing,
-- and it is usually months earlier. A system that only tracks the end date
-- lets a contract auto-renew while everyone is still deciding.
-- ---------------------------------------------------------------------------

create type contract_status as enum (
  'DRAFT', 'ACTIVE', 'EXPIRING', 'EXPIRED', 'TERMINATED', 'SUPERSEDED'
);

create table if not exists contracts (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,

  reference text not null,
  title text not null,
  status contract_status not null default 'DRAFT',

  starts_on date not null,
  ends_on date,
  -- The last day to give notice of non-renewal. Usually well before ends_on.
  notice_by date,
  auto_renews boolean not null default false,
  renewal_months integer,

  -- What we committed to spend, where there is a commitment. Both are
  -- optional: plenty of agreements are price lists with no volume promise.
  minimum_commitment numeric(18,5),
  maximum_commitment numeric(18,5),
  currency text not null default 'IDR',

  -- Agreed service levels, in the supplier's own words. Structured obligation
  -- extraction is a later job and needs legal review before anyone relies on
  -- it, so this stays as text somebody wrote.
  delivery_days text,
  lead_time_days integer,
  service_terms text,

  document_url text,
  notes text,

  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint contracts_dates check (ends_on is null or ends_on >= starts_on),
  constraint contracts_notice check (notice_by is null or ends_on is null or notice_by <= ends_on)
);

create unique index if not exists idx_contracts_reference
  on contracts(org_id, lower(reference));
create index if not exists idx_contracts_supplier on contracts(supplier_id, status);
create index if not exists idx_contracts_expiry on contracts(org_id, ends_on)
  where status in ('ACTIVE', 'EXPIRING');

/*
 * The agreed price for a product, for a period.
 *
 * Effective-dated rather than a single current price, because the whole point
 * is to be able to say what was agreed when an invoice was raised — not what
 * is agreed now.
 */
create table if not exists contract_prices (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  contract_id uuid not null references contracts(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  description text,

  unit text not null,
  unit_price numeric(18,5) not null,
  effective_from date not null,
  effective_to date,

  created_at timestamptz not null default now(),

  constraint contract_prices_have_something
    check (product_id is not null or nullif(btrim(coalesce(description,'')),'') is not null),
  constraint contract_prices_dates
    check (effective_to is null or effective_to >= effective_from)
);

create index if not exists idx_contract_prices_lookup
  on contract_prices(product_id, effective_from desc);

/**
 * The agreed price for a product on a date, if any contract covers it.
 *
 * Used to check what a supplier charges against what they agreed to charge.
 */
create or replace function public.contract_price_for(
  p_product uuid, p_supplier uuid, p_on date default current_date
) returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select cp.unit_price
  from public.contract_prices cp
  join public.contracts c on c.id = cp.contract_id
  where cp.product_id = p_product
    and c.supplier_id = p_supplier
    and c.status in ('ACTIVE', 'EXPIRING')
    and p_on between cp.effective_from and coalesce(cp.effective_to, 'infinity'::date)
    and p_on >= c.starts_on
    and p_on <= coalesce(c.ends_on, 'infinity'::date)
  order by cp.effective_from desc
  limit 1;
$$;

grant execute on function public.contract_price_for(uuid, uuid, date) to authenticated;

/*
 * Keep the status in step with the calendar.
 *
 * Derived rather than remembered. A contract that expired last Tuesday should
 * say so without somebody having run a report, and a status nobody maintains
 * is a status that lies.
 */
create or replace function public.refresh_contract_statuses()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.contracts
     set status = case
           when ends_on is null then 'ACTIVE'::public.contract_status
           when ends_on < current_date then 'EXPIRED'::public.contract_status
           when ends_on <= current_date + 60 then 'EXPIRING'::public.contract_status
           else 'ACTIVE'::public.contract_status
         end,
         updated_at = now()
   where status in ('ACTIVE', 'EXPIRING', 'EXPIRED');
$$;

grant execute on function public.refresh_contract_statuses() to authenticated;

/** Contracts wanting attention: expiring, or with notice falling due. */
create or replace view contract_attention as
  select
    c.id, c.org_id, c.reference, c.title, c.status,
    s.name as supplier_name,
    c.ends_on, c.notice_by, c.auto_renews,
    (c.ends_on - current_date) as days_to_end,
    (c.notice_by - current_date) as days_to_notice
  from public.contracts c
  join public.suppliers s on s.id = c.supplier_id
  where c.org_id in (select public.auth_org_ids())
    and c.status in ('ACTIVE', 'EXPIRING', 'EXPIRED')
    and (
      (c.ends_on is not null and c.ends_on <= current_date + 90)
      or (c.notice_by is not null and c.notice_by <= current_date + 30)
    );

grant select on contract_attention to authenticated;

do $$
declare t text;
begin
  foreach t in array array['contracts','contract_prices']
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

create trigger contracts_set_org before insert on contracts
  for each row execute function public.set_org_id();

create or replace function public.set_contract_price_org_id()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent_org uuid;
begin
  select c.org_id into parent_org from public.contracts c where c.id = new.contract_id;
  if parent_org is null then raise exception 'contract not found'; end if;
  new.org_id := parent_org;
  return new;
end;
$$;

create trigger contract_prices_set_org before insert on contract_prices
  for each row execute function public.set_contract_price_org_id();

comment on table contracts is
  'Supplier agreements. notice_by is the last day to avoid auto-renewal, and is not ends_on.';
comment on table contract_prices is
  'Effective-dated agreed prices, so an old invoice can be checked against what was agreed then.';
