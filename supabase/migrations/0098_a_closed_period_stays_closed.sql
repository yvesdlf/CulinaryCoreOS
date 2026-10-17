-- ---------------------------------------------------------------------------
-- A closed period stays closed, and somebody can see what is owed
-- ---------------------------------------------------------------------------
-- Two halves of the same job, which is why they are one migration: knowing
-- what you owe is useless if last month's figures can still move underneath
-- you.
--
-- Closing a period. Right now an invoice dated in March can be entered in
-- June and silently changes a month somebody has already reported on. Every
-- accounting system has this control and this one has never had it. The
-- block is a trigger rather than a flag the screens check, because the
-- point is that it holds against anything that can call the API.
--
-- Reopening is deliberately possible and deliberately noisy. A period that
-- can never be reopened produces a worse outcome than one that can: people
-- post the correction into the current month and two months are then wrong.
-- So it reopens, it needs ADMIN, and `privacy_actions`' sibling — the
-- period's own audit columns — records who and why.
--
-- The aging. `supplier_invoices` has had `due_date` and `payment_terms_days`
-- since 0022 and nothing has ever read them, so "what do we owe, and how
-- late is it" has no answer in this system. The buckets are the ones every
-- finance person expects: not yet due, 1–30, 31–60, 61–90, over 90.
--
-- Credit notes are netted off per supplier rather than per invoice, because
-- that is how a supplier applies them and how the conversation goes on the
-- phone. A credit against an invoice already paid still reduces what is
-- owed overall.
-- ---------------------------------------------------------------------------

do $$ begin
  create type period_status as enum ('OPEN', 'CLOSED');
exception when duplicate_object then null; end $$;

create table if not exists accounting_periods (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  starts_on date not null,
  ends_on date not null,
  status period_status not null default 'OPEN',

  closed_by_email text,
  closed_at timestamptz,
  reopened_by_email text,
  reopened_at timestamptz,
  reopen_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint accounting_periods_order check (ends_on >= starts_on),
  constraint accounting_periods_unique unique (org_id, starts_on, ends_on)
);

create index if not exists idx_accounting_periods_range
  on accounting_periods(org_id, starts_on, ends_on) where status = 'CLOSED';

drop trigger if exists accounting_periods_set_org on accounting_periods;
create trigger accounting_periods_set_org before insert on accounting_periods
  for each row execute function public.set_org_id();
drop trigger if exists accounting_periods_touch on accounting_periods;
create trigger accounting_periods_touch before update on accounting_periods
  for each row execute function public.set_updated_at();

/*
 * Is this date inside a period somebody has closed?
 *
 * Its own function so the trigger below reads as the rule it is, and so a
 * screen can grey a date picker without reimplementing the lookup.
 */
create or replace function public.period_is_closed(p_org uuid, p_on date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.accounting_periods p
     where p.org_id = p_org
       and p.status = 'CLOSED'
       and p_on between p.starts_on and p.ends_on
  );
$$;

/*
 * Closing and reopening.
 *
 * Both go through the status column, and both are stamped from the session
 * rather than from anything the client sends — 0085's lesson, applied
 * before it can be learned again here.
 */
create or replace function public.enforce_period_change()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'CLOSED' then
    new.closed_by_email := coalesce(auth.jwt() ->> 'email', new.closed_by_email);
    new.closed_at := now();
    return new;
  end if;

  -- Reopening. Needs ADMIN and a reason, and keeps both.
  if not public.can_write_section('ADMIN', new.org_id) then
    raise exception 'reopening a closed period needs administration access'
      using errcode = '42501';
  end if;
  if coalesce(btrim(new.reopen_reason), '') = '' then
    raise exception 'say why the period is being reopened'
      using hint = 'This is the record of why last month moved.';
  end if;
  new.reopened_by_email := coalesce(auth.jwt() ->> 'email', new.reopened_by_email);
  new.reopened_at := now();
  return new;
end $$;

drop trigger if exists accounting_periods_change on accounting_periods;
create trigger accounting_periods_change before update on accounting_periods
  for each row execute function public.enforce_period_change();

/*
 * The block itself.
 *
 * One function, attached to each table that carries a posting date. Written
 * generically over `tg_argv[0]` rather than copied five times, because five
 * copies is five places for the next person to miss one — which is exactly
 * what `AGENTS.md` §2 describes happening to `seed_organization_defaults`.
 *
 * A delete is refused too. Removing a row from a closed month changes it
 * just as surely as adding one.
 */
create or replace function public.refuse_in_closed_period()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  the_date date;
  the_org uuid;
  row_to_check record;
begin
  row_to_check := case when tg_op = 'DELETE' then old else new end;
  execute format('select ($1).%I::date, ($1).org_id', tg_argv[0])
     into the_date, the_org using row_to_check;

  if the_date is null or the_org is null then
    return row_to_check;
  end if;

  if public.period_is_closed(the_org, the_date) then
    raise exception '% is in a closed period', the_date
      using hint = 'Reopen the period, or date this in an open one.';
  end if;

  return row_to_check;
end $$;

drop trigger if exists supplier_invoices_period on supplier_invoices;
create trigger supplier_invoices_period
  before insert or update or delete on supplier_invoices
  for each row execute function public.refuse_in_closed_period('invoice_date');

drop trigger if exists goods_receipts_period on goods_receipts;
create trigger goods_receipts_period
  before insert or update or delete on goods_receipts
  for each row execute function public.refuse_in_closed_period('received_on');

drop trigger if exists daily_takings_period on daily_takings;
create trigger daily_takings_period
  before insert or update or delete on daily_takings
  for each row execute function public.refuse_in_closed_period('on_date');

/*
 * Stock movements are deliberately NOT blocked.
 *
 * They are the one ledger where a late entry is routinely correct — a count
 * posts at its snapshot, a sales import at the end of its period, and both
 * can legitimately land after a month is closed if somebody is catching up.
 * Blocking them would make the close the thing people work around rather
 * than the thing they do. The valuation reports read the ledger as at a
 * date, so a late movement is visible rather than hidden.
 *
 * Recorded here because it is a decision, not an oversight.
 */

alter table accounting_periods enable row level security;

drop policy if exists accounting_periods_read on accounting_periods;
create policy accounting_periods_read on accounting_periods for select to authenticated
  using (public.can_read_section('PURCHASING', org_id));
drop policy if exists accounting_periods_write on accounting_periods;
create policy accounting_periods_write on accounting_periods for insert to authenticated
  with check (public.auth_can_write(org_id));
drop policy if exists accounting_periods_update on accounting_periods;
create policy accounting_periods_update on accounting_periods for update to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));

grant select, insert, update on accounting_periods to authenticated;

drop trigger if exists accounting_periods_section_guard on accounting_periods;
create trigger accounting_periods_section_guard
  before insert or update or delete on accounting_periods
  for each row execute function public.require_section_write('PURCHASING');

delete from public.section_read_rules where table_name = 'accounting_periods';
insert into public.section_read_rules (table_name, section_code)
values ('accounting_periods', 'PURCHASING');

/*
 * What is owed, and how late.
 *
 * Only invoices that are actually payable: a draft or an invoice sitting in
 * exception is not a debt, it is an argument. Those are counted separately
 * on the supplier roll-up below, because "we owe nothing" is misleading
 * when four invoices are stuck in a queue.
 */
create or replace view ap_aging
with (security_invoker = true) as
  select
    i.org_id,
    i.id                as invoice_id,
    i.invoice_number,
    i.supplier_id,
    s.name              as supplier_name,
    i.invoice_date,
    i.due_date,
    i.total_amount,
    i.currency,
    i.status,
    (current_date - i.due_date) as days_overdue,
    case
      when i.due_date is null             then 'no due date'
      when i.due_date >= current_date     then 'not yet due'
      when current_date - i.due_date <= 30 then '1 to 30'
      when current_date - i.due_date <= 60 then '31 to 60'
      when current_date - i.due_date <= 90 then '61 to 90'
      else 'over 90'
    end                 as bucket
  from public.supplier_invoices i
  left join public.suppliers s on s.id = i.supplier_id
  where i.status in ('APPROVED_FOR_PAYMENT', 'MATCHING', 'DISPUTED', 'EXCEPTION');

grant select on ap_aging to authenticated;

/*
 * Per supplier, with credits netted off.
 *
 * Netted at the supplier rather than the invoice because that is how a
 * supplier applies them and how the phone call goes. `stuck` is beside the
 * total on purpose: a balance of zero means something different when three
 * invoices are in exception.
 */
create or replace view ap_by_supplier
with (security_invoker = true) as
  select
    a.org_id,
    a.supplier_id,
    a.supplier_name,
    count(*)                                               as invoices,
    count(*) filter (where a.status in ('EXCEPTION', 'DISPUTED')) as stuck,
    sum(a.total_amount) filter (where a.status = 'APPROVED_FOR_PAYMENT')::numeric(18,5)
                                                           as approved_to_pay,
    sum(a.total_amount) filter (where a.bucket <> 'not yet due'
                                  and a.status = 'APPROVED_FOR_PAYMENT')::numeric(18,5)
                                                           as overdue,
    coalesce(c.credits, 0)::numeric(18,5)                  as credits_owed_to_us,
    (coalesce(sum(a.total_amount) filter (where a.status = 'APPROVED_FOR_PAYMENT'), 0)
     - coalesce(c.credits, 0))::numeric(18,5)              as net_payable,
    max(a.days_overdue)                                    as oldest_days_overdue
  from public.ap_aging a
  left join (
    select cn.supplier_id, sum(cn.amount) as credits
      from public.supplier_credit_notes cn
     where cn.status in ('EXPECTED', 'RECEIVED')
     group by cn.supplier_id
  ) c on c.supplier_id = a.supplier_id
  group by a.org_id, a.supplier_id, a.supplier_name, c.credits;

grant select on ap_by_supplier to authenticated;

comment on table accounting_periods is
  'Months that have been reported on. Posting into a closed one is refused; reopening needs ADMIN and a reason. See 0098.';
comment on view ap_aging is
  'Payable invoices by how late they are. Drafts and paid invoices are not debts. See 0098.';
comment on view ap_by_supplier is
  'What each supplier is owed, credits netted off, with how many invoices are stuck rather than payable. See 0098.';
