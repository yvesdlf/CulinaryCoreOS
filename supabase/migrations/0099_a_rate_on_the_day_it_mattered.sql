-- ---------------------------------------------------------------------------
-- A rate on the day it mattered
-- ---------------------------------------------------------------------------
-- Several documents carry a `currency` — requisitions, orders, invoices,
-- budgets, contracts — and nothing converts between them. So a venue buying
-- wine in EUR and reporting in IDR has figures it cannot add up, and the
-- only way to total a month is to do it outside the system.
--
-- Two rules decide the shape, and both are about not rewriting history.
--
-- Rates append and are dated. The question is never "what is the euro worth"
-- but "what was it worth on the day that invoice was raised", and a table
-- holding one current rate per pair answers the wrong one — it silently
-- restates every past document every time somebody updates it.
--
-- A conversion therefore takes a date, and uses the latest rate **on or
-- before** that date. Never a later one: a document converted at a rate that
-- did not exist when it was written is a number nobody can reproduce.
--
-- If no rate is known on or before the date, the answer is null, not the
-- unconverted figure. Returning the original amount would silently mix
-- currencies in a total — the single most expensive thing this file could
-- do, because the result looks like a number.
-- ---------------------------------------------------------------------------

create table if not exists exchange_rates (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  from_currency text not null,
  to_currency text not null,
  -- How many `to_currency` one `from_currency` buys.
  rate numeric(18,8) not null,
  rate_on date not null,
  source text not null default 'manual',
  note text,

  recorded_by_email text,
  created_at timestamptz not null default now(),

  constraint exchange_rates_positive check (rate > 0),
  constraint exchange_rates_distinct
    check (upper(btrim(from_currency)) <> upper(btrim(to_currency))),
  constraint exchange_rates_named
    check (btrim(from_currency) <> '' and btrim(to_currency) <> ''),
  constraint exchange_rates_unique
    unique (org_id, from_currency, to_currency, rate_on)
);

create index if not exists idx_exchange_rates_lookup
  on exchange_rates(org_id, from_currency, to_currency, rate_on desc);

create or replace function public.stamp_exchange_rate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.from_currency := upper(btrim(new.from_currency));
  new.to_currency := upper(btrim(new.to_currency));
  if auth.uid() is not null then
    new.recorded_by_email := auth.jwt() ->> 'email';
  end if;
  return new;
end $$;

drop trigger if exists exchange_rates_set_org on exchange_rates;
create trigger exchange_rates_set_org before insert on exchange_rates
  for each row execute function public.set_org_id();
drop trigger if exists exchange_rates_stamp on exchange_rates;
create trigger exchange_rates_stamp before insert on exchange_rates
  for each row execute function public.stamp_exchange_rate();

/*
 * The rate that applied on a date.
 *
 * Identical currencies return 1 without a lookup, so a venue that never
 * trades in anything but its own needs no rows at all.
 *
 * Tries the inverse before giving up: somebody who recorded EUR to IDR
 * should not have to record IDR to EUR as well, and making them is how the
 * two end up disagreeing.
 */
create or replace function public.rate_on(
  p_org uuid, p_from text, p_to text, p_on date
)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select case
    when upper(btrim(p_from)) = upper(btrim(p_to)) then 1::numeric
    else coalesce(
      (select r.rate from public.exchange_rates r
        where r.org_id = p_org
          and r.from_currency = upper(btrim(p_from))
          and r.to_currency = upper(btrim(p_to))
          and r.rate_on <= p_on
        order by r.rate_on desc limit 1),
      (select 1 / r.rate from public.exchange_rates r
        where r.org_id = p_org
          and r.from_currency = upper(btrim(p_to))
          and r.to_currency = upper(btrim(p_from))
          and r.rate_on <= p_on
          and r.rate <> 0
        order by r.rate_on desc limit 1)
    )
  end;
$$;

/*
 * An amount in the venue's own currency.
 *
 * Null where no rate is known, deliberately. Returning the unconverted
 * figure would mix currencies inside a total and the result would look like
 * a number, which is worse than a gap somebody can see.
 */
create or replace function public.in_base_currency(
  p_org uuid, p_amount numeric, p_currency text, p_on date
)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select case
    when p_amount is null then null
    else p_amount * public.rate_on(
      p_org,
      coalesce(nullif(btrim(p_currency), ''),
               (select o.currency_code from public.organizations o where o.id = p_org)),
      (select o.currency_code from public.organizations o where o.id = p_org),
      coalesce(p_on, current_date))
  end;
$$;

alter table exchange_rates enable row level security;

drop policy if exists exchange_rates_read on exchange_rates;
create policy exchange_rates_read on exchange_rates for select to authenticated
  using (org_id in (select public.auth_org_ids()));
drop policy if exists exchange_rates_write on exchange_rates;
create policy exchange_rates_write on exchange_rates for insert to authenticated
  with check (public.auth_can_write(org_id));

-- Select and insert only: a rate that was used was used, and a correction is
-- a later row.
grant select, insert on exchange_rates to authenticated;

drop trigger if exists exchange_rates_section_guard on exchange_rates;
create trigger exchange_rates_section_guard
  before insert or update or delete on exchange_rates
  for each row execute function public.require_section_write('PURCHASING');

/*
 * Registered as shared rather than gated.
 *
 * Writing a rate is a purchasing act; reading one is needed anywhere a
 * foreign amount is shown, which is most of the reporting surface. Same
 * position the catalogue takes.
 */
delete from public.section_read_rules where table_name = 'exchange_rates';
insert into public.section_read_rules (table_name, section_code, shared_because)
values ('exchange_rates', null,
        'the rate on a date, needed anywhere a foreign amount is reported');

/*
 * Invoices in the venue's own money.
 *
 * `converted` is null where the rate is unknown, and `needs_a_rate` says so
 * rather than leaving somebody to infer it from a blank.
 */
create or replace view supplier_invoices_in_base
with (security_invoker = true) as
  select
    i.org_id,
    i.id                as invoice_id,
    i.invoice_number,
    i.supplier_id,
    i.invoice_date,
    i.total_amount,
    coalesce(nullif(btrim(i.currency), ''), o.currency_code) as currency,
    o.currency_code     as base_currency,
    public.in_base_currency(i.org_id, i.total_amount, i.currency, i.invoice_date)::numeric(18,5)
                        as total_in_base,
    (public.in_base_currency(i.org_id, i.total_amount, i.currency, i.invoice_date) is null
     and i.total_amount is not null) as needs_a_rate
  from public.supplier_invoices i
  join public.organizations o on o.id = i.org_id;

grant select on supplier_invoices_in_base to authenticated;

comment on table exchange_rates is
  'Dated rates, append-only. A document converts at the rate that applied when it was written. See 0099.';
comment on function public.in_base_currency(uuid, numeric, text, date) is
  'An amount in the venue''s currency, or null where no rate is known — never the unconverted figure. See 0099.';
