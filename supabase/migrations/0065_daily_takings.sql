-- ---------------------------------------------------------------------------
-- What came in
-- ---------------------------------------------------------------------------
-- Gap 10, and decision D2. This platform has known what everything *cost*
-- since its first migration and has never known what anything *earned*. Every
-- figure it produces is therefore one side of a subtraction: a food cost
-- percentage with no sales to be a percentage of, a department's spend with
-- nothing to set it against, a labour cost that cannot become a margin.
--
-- `sales_periods` and `sales_lines` are not this. They are dish-level sales
-- mix, imported for menu engineering — what sold, not what the venue took.
--
-- ## The decision this was waiting on
--
-- D2 asks whether somebody types the takings or the platform reads them from
-- the till. Unanswered, so this builds the manual path, which works within a
-- day and loses nothing: a POS integration later writes to this same table and
-- sets `source` to say so. `source` exists from the start for exactly that
-- reason — a column added later means a backfill and an argument about what
-- the old rows meant.
--
-- ## Per channel, which is the part that is easy to get wrong
--
-- Reviewing Q3 Aurelia made this concrete: revenue arrives from delivery
-- platforms as well as the till, and a figure that reads only the till is
-- wrong by whatever the aggregators took — in both directions at once. The
-- customer paid Rp 150.000; the platform kept its commission; the venue banked
-- less. One number cannot be both, and which one a report means decides
-- whether a menu looks profitable.
--
-- So a row holds the gross — what the customer paid — and the commission
-- withheld, and `net` is generated from the two. Menu and cover analysis want
-- the gross. The bank reconciles to the net. Neither is "the revenue".
--
-- ## Covers live here, which closes gap 36b
--
-- Expected covers have lived in one browser's local storage since the
-- production page was built, which makes them one person's working figure
-- rather than the venue's. Actual covers per unit per day per channel sit on
-- this row, beside the money they produced, because the two are only useful
-- together: spend per head is the number a venue actually steers by, and it
-- needs both halves to have been recorded by the same person about the same
-- day.
--
-- ## Correctable, and every correction recorded
--
-- Unlike a pay rate, takings are typed daily by whoever is closing up, and a
-- transposed figure has to be fixable the next morning. So the row is editable
-- and `takings_changes` keeps what it was, what it became and who did it —
-- the same shape `parameter_changes` has had since 0038, and for the same
-- reason: the alternative to an audit trail is not fewer corrections, it is
-- corrections nobody can see.
-- ---------------------------------------------------------------------------

-- ── Where the money comes from ──────────────────────────────────────────────

create type revenue_channel_kind as enum (
  'DINE_IN',    -- Through the till, in the room
  'TAKEAWAY',   -- Collected, no commission
  'DELIVERY',   -- An aggregator, which keeps a share
  'EVENT',      -- A function, usually invoiced
  'OTHER'
);

create table if not exists revenue_channels (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  code text not null,
  name text not null,
  kind revenue_channel_kind not null,

  /*
   * What this channel usually keeps, as a percentage. A default for the form,
   * never the figure of record: a platform's actual deduction moves with
   * promotions, disputes and the month, and a commission computed from a
   * stored percentage is a number the venue cannot reconcile to its remittance.
   * The row holds what was actually withheld.
   */
  typical_commission_percent numeric(6,3)
    check (typical_commission_percent is null
           or typical_commission_percent between 0 and 100),

  active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint revenue_channels_code_shape
    check (code = upper(code) and btrim(code) = code and code <> '')
);

create unique index if not exists idx_revenue_channels_code
  on revenue_channels(org_id, lower(code));

-- ── What came in, per unit per day per channel ──────────────────────────────

create table if not exists daily_takings (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  /*
   * Not nullable. Takings charged to nobody are the income equivalent of the
   * requisition with no unit that 0063 went to some trouble to make
   * impossible: they drop out of every per-department figure and quietly make
   * the venue's total disagree with the sum of its parts.
   */
  business_unit_id uuid not null references business_units(id) on delete restrict,
  channel_id uuid not null references revenue_channels(id) on delete restrict,

  on_date date not null,

  /*
   * What the customer paid, before anybody took a share. numeric, because it
   * is money.
   */
  gross_amount numeric(18,5) not null check (gross_amount >= 0),

  /*
   * What the channel withheld. Null means nobody has said — which is not zero,
   * and the generated column below propagates that honestly rather than
   * treating silence as "the venue kept all of it".
   */
  commission_amount numeric(18,5) check (commission_amount >= 0),

  net_amount numeric(18,5)
    generated always as (gross_amount - coalesce(commission_amount, 0)) stored,

  /*
   * Covers for a room, orders for a delivery platform. Gap 36b: this is the
   * venue's figure, in the venue's database, rather than one browser's local
   * storage.
   */
  covers integer check (covers is null or covers >= 0),

  -- 'MANUAL' today. A POS integration writes 'POS' here and nothing else about
  -- this table changes, which is the whole reason D2 was not worth waiting for.
  source text not null default 'MANUAL',

  note text,

  recorded_by_id uuid references auth.users(id) on delete set null,
  recorded_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One figure per unit per channel per day. Two is a question with no answer.
  constraint daily_takings_one_per_day unique (business_unit_id, channel_id, on_date),
  -- A commission cannot exceed what the customer paid.
  constraint daily_takings_commission_fits
    check (commission_amount is null or commission_amount <= gross_amount)
);

create index if not exists idx_daily_takings_day on daily_takings(org_id, on_date desc);
create index if not exists idx_daily_takings_unit
  on daily_takings(business_unit_id, on_date desc);

/*
 * Every correction, kept.
 *
 * Append-only, the same shape `parameter_changes` has had since 0038. Takings
 * are typed by whoever is closing up and a transposed figure has to be fixable
 * the next morning; the alternative to recording the fix is not fewer fixes,
 * it is fixes nobody can see.
 */
create table if not exists takings_changes (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  takings_id uuid not null references daily_takings(id) on delete cascade,
  changed_at timestamptz not null default now(),
  changed_by_email text,
  was_gross numeric(18,5),
  now_gross numeric(18,5),
  was_commission numeric(18,5),
  now_commission numeric(18,5),
  was_covers integer,
  now_covers integer
);

create index if not exists idx_takings_changes_row
  on takings_changes(takings_id, changed_at desc);

-- ── What the client is not trusted to state ─────────────────────────────────

create or replace function public.enforce_daily_takings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  unit_org uuid;
  channel_org uuid;
  caller_email text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  select b.org_id into unit_org
    from public.business_units b where b.id = new.business_unit_id;
  if unit_org is null then
    raise exception 'there is no such business unit to record takings for';
  end if;
  new.org_id := unit_org;

  select c.org_id into channel_org
    from public.revenue_channels c where c.id = new.channel_id;
  if channel_org is distinct from unit_org then
    raise exception 'that channel belongs to another organisation';
  end if;

  /*
   * Tomorrow's takings have not happened.
   *
   * Cheap to type by accident — a date picker one month out — and expensive to
   * find, because the figure is perfectly plausible and simply sits in a
   * period nobody is looking at yet.
   */
  if new.on_date > current_date then
    raise exception 'takings cannot be recorded for %, which has not happened yet',
      to_char(new.on_date, 'FMDD Month YYYY');
  end if;

  if caller_email is not null then
    new.recorded_by_email := caller_email;
    new.recorded_by_id := auth.uid();
  elsif tg_op = 'INSERT' and coalesce(btrim(new.recorded_by_email), '') = '' then
    raise exception 'takings must record who entered them';
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
    -- Only where something that matters actually moved. An update that changes
    -- a note should not fill the audit trail with rows saying nothing changed.
    if new.gross_amount is distinct from old.gross_amount
       or new.commission_amount is distinct from old.commission_amount
       or new.covers is distinct from old.covers
    then
      insert into public.takings_changes
        (org_id, takings_id, changed_by_email,
         was_gross, now_gross, was_commission, now_commission, was_covers, now_covers)
      values
        (new.org_id, new.id, coalesce(caller_email, new.recorded_by_email),
         old.gross_amount, new.gross_amount,
         old.commission_amount, new.commission_amount,
         old.covers, new.covers);
    end if;
  end if;

  return new;
end;
$$;

create trigger daily_takings_enforce
  before insert or update on daily_takings
  for each row execute function public.enforce_daily_takings();

-- ── Who may record it ───────────────────────────────────────────────────────

insert into app_sections (code, name, description, sort_order, is_core)
values ('REVENUE', 'Revenue',
        'What came in, per department per day per channel, and the covers behind it.',
        45, false)
on conflict (code) do nothing;

alter table revenue_channels enable row level security;
alter table daily_takings enable row level security;
alter table takings_changes enable row level security;

create policy revenue_channels_read on revenue_channels
  for select to authenticated using (org_id in (select public.auth_org_ids()));
create policy revenue_channels_write on revenue_channels
  for all to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));

create policy daily_takings_read on daily_takings
  for select to authenticated using (org_id in (select public.auth_org_ids()));
create policy daily_takings_write on daily_takings
  for all to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));

create policy takings_changes_read on takings_changes
  for select to authenticated using (org_id in (select public.auth_org_ids()));

grant select, insert, update, delete on revenue_channels to authenticated;
grant select, insert, update, delete on daily_takings to authenticated;
-- The trail does not move. Written by the trigger, read by anybody in the
-- venue, edited by nobody — the same grant shape as every other ledger here.
grant select on takings_changes to authenticated;

create trigger revenue_channels_section_guard
  before insert or update or delete on revenue_channels
  for each row execute function public.require_section_write('PARAMETERS');

/*
 * REVENUE, and therefore scopable by unit — `daily_takings` carries
 * `business_unit_id`, so 0062's derivation picks this up without being told.
 * A bar manager who may type the bar's takings and not the kitchen's is the
 * motivating case, and it works because the guard reads the row's own unit.
 *
 * The channel list is PARAMETERS, because adding a delivery platform changes
 * what every department's figures are broken down by. Typing Tuesday's takings
 * and inventing a new revenue stream are different acts.
 */
create trigger daily_takings_section_guard
  before insert or update or delete on daily_takings
  for each row execute function public.require_section_write('REVENUE');

/*
 * And a correction to how that list is computed, found by this migration
 * rather than introduced by it.
 *
 * 0062 derives `scopes_by_unit` by asking which guarded tables carry a
 * `business_unit_id`. Re-running it after adding this section turned
 * **Administration** scopable as well, which nobody intended: `member_access`
 * gained that column in 0062 itself, and it is guarded by ADMIN.
 *
 * The column means something different there. On `work_orders` or
 * `daily_takings` it says which department the row *belongs to*. On
 * `member_access` it says which department the grant is *about* — the subject
 * of the permission, not its owner. Reading the second as the first turns a
 * grant's subject into its scope, and the consequence is a delegation path
 * nobody designed: somebody holding Administration scoped to the kitchen could
 * write kitchen-scoped grants in every other section, including one for
 * themselves. It was unreachable only because ADMIN happened not to be on that
 * list, and this migration was one `select` away from putting it there.
 *
 * Excluded by name, with the reason, rather than by a cleverer rule. The
 * distinction is real and cannot be stated in SQL: "does this column say where
 * the row lives, or what the row is about" is a question about meaning. A list
 * of one, argued for, beats a heuristic that would be wrong differently.
 */
create or replace function public.refresh_section_unit_scoping()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.app_sections s
     set scopes_by_unit = exists (
       select 1
         from pg_catalog.pg_trigger t
         join pg_catalog.pg_class c on c.oid = t.tgrelid
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where not t.tgisinternal
          and n.nspname = 'public'
          -- The grant table's unit is the grant's subject, not the row's home.
          and c.relname <> 'member_access'
          and pg_catalog.pg_get_triggerdef(t.oid)
              like '%require_section_write(''' || s.code || ''')%'
          and exists (
            select 1 from pg_catalog.pg_attribute a
             where a.attrelid = c.oid
               and a.attname = 'business_unit_id'
               and a.attnum > 0
               and not a.attisdropped));
end;
$fn$;

select public.refresh_section_unit_scoping();

-- ── What a venue starts with ────────────────────────────────────────────────
/*
 * Three channels, and the registry means this migration adds one row to a
 * table rather than rewriting the function four migrations have each rewritten
 * in full. That is 0060's seeder registry doing the job it was built for, one
 * migration later.
 */
create or replace function public.seed_revenue_channels(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.revenue_channels (org_id, code, name, kind, typical_commission_percent)
  select p_org, c.code, c.name, c.kind::public.revenue_channel_kind, c.pct
    from (values
      ('TILL',     'Through the till', 'DINE_IN',  null),
      ('TAKEAWAY', 'Takeaway',         'TAKEAWAY', null),
      -- A placeholder rather than a named platform: every venue uses different
      -- ones, and seeding somebody else's brand name is a guess printed on a
      -- report. The percentage is the one figure a venue will certainly change.
      ('DELIVERY', 'Delivery platform','DELIVERY', 20)
    ) as c(code, name, kind, pct)
   where not exists (
     select 1 from public.revenue_channels r
      where r.org_id = p_org and lower(r.code) = lower(c.code));
end;
$$;

insert into organization_seeders (ordinal, function_name, note)
values (35, 'seed_revenue_channels', 'Till, takeaway and a delivery platform. 0065.')
on conflict (ordinal) do nothing;

do $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.seed_revenue_channels(o.id);
  end loop;
end $$;

-- ── What the screens read ───────────────────────────────────────────────────

/*
 * Revenue per unit per day, with the channels kept apart.
 *
 * `security_invoker`, so the caller's own organisation scope applies. Gross and
 * net are both carried, because a report that picks one and calls it "revenue"
 * is wrong for whoever wanted the other.
 */
create or replace view revenue_daily with (security_invoker = true) as
  select
    t.org_id,
    t.business_unit_id,
    b.code as business_unit_code,
    b.name as business_unit_name,
    t.on_date,
    t.channel_id,
    c.code as channel_code,
    c.name as channel_name,
    c.kind as channel_kind,
    t.gross_amount,
    t.commission_amount,
    t.net_amount,
    t.covers,
    -- Null covers gives null spend, never a division by nothing and never a
    -- zero: "nobody counted" and "nobody came" are different days.
    case when coalesce(t.covers, 0) > 0
         then round(t.gross_amount / t.covers, 2) end as spend_per_cover,
    t.source,
    t.recorded_by_email,
    t.updated_at
  from public.daily_takings t
  join public.business_units b on b.id = t.business_unit_id
  join public.revenue_channels c on c.id = t.channel_id;

grant select on revenue_daily to authenticated;

/*
 * Revenue against labour, per unit per day. The figure Stage 2 exists to make
 * possible.
 *
 * Requires Pay, and returns nothing without it. The labour half is the
 * sensitive half, and a view that showed revenue with a null labour column
 * would be the same mistake `labour_cost_daily` had to have fixed — a report
 * that lists everything and costs nothing reads as a fact rather than as a
 * refusal.
 *
 * Deliberately not a margin: cost of goods is not in it. Calling
 * revenue-minus-labour "profit" would be wrong by the entire food cost, and
 * this platform knows that number — it is simply a different join and belongs
 * on the dashboard that asks for both, not hidden inside a view with a
 * flattering name.
 */
create or replace view unit_labour_against_revenue with (security_invoker = true) as
  with revenue as (
    select business_unit_id, on_date,
           sum(gross_amount) as gross,
           sum(net_amount) as net,
           sum(covers) as covers
      from public.daily_takings
     group by 1, 2
  ),
  labour as (
    select business_unit_id, on_date, sum(cost) as labour_cost, sum(hours) as hours
      from public.labour_cost_daily
     group by 1, 2
  )
  select
    b.org_id,
    b.id as business_unit_id,
    b.code as business_unit_code,
    b.name as business_unit_name,
    d.on_date,
    r.gross,
    r.net,
    r.covers,
    l.hours,
    l.labour_cost,
    case when coalesce(r.net, 0) > 0 and l.labour_cost is not null
         then round(100 * l.labour_cost / r.net, 2) end as labour_percent_of_net
  from (select distinct on_date from public.labour_cost_daily
        union
        select distinct on_date from public.daily_takings) d
  cross join public.business_units b
  left join revenue r on r.business_unit_id = b.id and r.on_date = d.on_date
  left join labour l on l.business_unit_id = b.id and l.on_date = d.on_date
  where (r.gross is not null or l.labour_cost is not null)
    and public.can_read_section('PAY', b.org_id, null::uuid);

grant select on unit_labour_against_revenue to authenticated;

comment on table daily_takings is
  'What came in, per unit per day per channel. Gross is what the customer paid; net is what the venue kept.';
comment on column daily_takings.commission_amount is
  'What the channel withheld. Null means nobody has said, which is not the same as nothing.';
comment on column daily_takings.covers is
  'Covers for a room, orders for a platform. Gap 36b: the venue''s figure, not one browser''s.';
comment on table takings_changes is
  'Append-only. What a takings figure was, what it became and who changed it.';
comment on view revenue_daily is
  'Takings with their channel and unit named, and spend per cover where covers were counted.';
comment on view unit_labour_against_revenue is
  'Labour against revenue per unit per day. Needs Pay. Not a margin — cost of goods is not in it.';
