-- ---------------------------------------------------------------------------
-- Editable tax rates, and message channels
-- ---------------------------------------------------------------------------
-- Two things that were decisions waiting on somebody, made configurable so
-- they stop waiting.
--
-- Tax: the organisation already carried a standard and a reduced rate, but
-- nothing could change them and nothing said which applied to what. A venue
-- serving food and alcohol needs both — most EU member states reduce
-- restaurant food and keep alcohol at standard — so a rate is now a row with
-- a name, and a recipe category can be pointed at one.
--
-- Channels: the communication cycle records every moment somebody needs
-- telling and delivers in-app. A channel row says where else it should go and
-- holds the configuration for getting it there. The sending itself is done
-- outside the database by whatever adapter is configured; this records the
-- intent, the attempt and the outcome, so a failed WhatsApp message is
-- visible rather than silently absent.
-- ---------------------------------------------------------------------------

create table if not exists tax_rates (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  name text not null,
  -- The rate itself. Nothing here assumes a country: a venue sets what its
  -- member state charges, and a second venue elsewhere sets something else.
  percent numeric(6,3) not null,
  -- Marks the one used when nothing more specific applies.
  is_default boolean not null default false,
  -- Free text so a venue can record why: "reduced rate, restaurant services".
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tax_rates_percent check (percent >= 0 and percent <= 100)
);

create unique index if not exists idx_tax_rates_name on tax_rates(org_id, lower(name));
-- Exactly one default, enforced rather than hoped for.
create unique index if not exists idx_tax_rates_one_default
  on tax_rates(org_id) where is_default;

/*
 * Which rate a recipe category attracts.
 *
 * By category rather than per recipe, because that is how a menu divides:
 * every cocktail is standard-rated and every starter is not, and setting it
 * on 115 dishes individually is how it ends up wrong on three of them.
 */
create table if not exists category_tax_rates (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  category text not null,
  tax_rate_id uuid not null references tax_rates(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint category_tax_rates_unique unique (org_id, category)
);

/** The rate for a category, falling back to the organisation's default. */
create or replace function public.tax_percent_for(p_category text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select r.percent from public.category_tax_rates c
       join public.tax_rates r on r.id = c.tax_rate_id
      where c.category = p_category
        and c.org_id in (select public.auth_org_ids())
      limit 1),
    (select r.percent from public.tax_rates r
      where r.is_default
        and r.org_id in (select public.auth_org_ids())
      limit 1),
    (select o.standard_vat_percent from public.organizations o
      where o.id in (select public.auth_org_ids()) limit 1),
    0
  );
$$;

grant execute on function public.tax_percent_for(text) to authenticated;

-- ── Message channels ────────────────────────────────────────────────────────

create table if not exists message_channels (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  -- IN_APP is always present. WHATSAPP and EMAIL need an adapter configured.
  kind text not null,
  name text not null,
  enabled boolean not null default false,

  /*
   * Adapter configuration, minus anything secret.
   *
   * A WhatsApp Business account needs a phone number id and a template name;
   * it also needs an access token, which is NOT stored here. Secrets belong in
   * the platform's secret store, and putting one in a table that half the
   * organisation can read would undo every access control in the system.
   */
  config jsonb not null default '{}'::jsonb,

  -- Which notifications go out on this channel. Empty means all of them.
  kinds notification_kind[] not null default '{}',
  -- Nothing is sent outside these hours, local time. A supplier does not need
  -- a delivery query at three in the morning.
  quiet_from time,
  quiet_to time,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint message_channels_kind unique (org_id, kind)
);

/*
 * What was attempted, and what happened.
 *
 * A separate table from `notifications` because one notification can go out on
 * several channels and each can fail differently. A delivery that failed is
 * the thing worth seeing; a notification row alone cannot tell you.
 */
create table if not exists message_deliveries (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  notification_id uuid not null references notifications(id) on delete cascade,
  channel_id uuid references message_channels(id) on delete set null,

  kind text not null,
  -- The number or address it went to, kept so a bounce can be chased.
  destination text,

  status text not null default 'PENDING',   -- PENDING | SENT | FAILED | SKIPPED
  attempts integer not null default 0,
  last_error text,
  -- The provider's own id, so a delivery receipt can be matched back.
  external_id text,

  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_message_deliveries_pending
  on message_deliveries(org_id, queued_at) where status = 'PENDING';
create index if not exists idx_message_deliveries_notification
  on message_deliveries(notification_id);

-- Where to reach a supplier on a channel. Separate from the supplier's phone
-- column because a WhatsApp number is often not the switchboard.
alter table suppliers
  add column if not exists whatsapp_number text;

alter table employees
  add column if not exists whatsapp_number text;

/*
 * Queue a notification onto every enabled channel that wants it.
 *
 * Queued, not sent. Sending needs a network call, which a database trigger
 * must never make: a slow provider would hold a transaction open and a failing
 * one would roll back the delivery that caused it. An adapter polls this and
 * marks each row.
 */
create or replace function public.queue_notification_deliveries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare ch record; dest text;
begin
  for ch in
    select * from public.message_channels
     where org_id = new.org_id and enabled
       and (cardinality(kinds) = 0 or new.kind = any(kinds))
  loop
    dest := null;
    if new.supplier_id is not null then
      select s.whatsapp_number into dest
        from public.suppliers s where s.id = new.supplier_id;
      -- A supplier with no number on this channel is skipped, and the skip is
      -- recorded rather than silently dropped.
      insert into public.message_deliveries
        (org_id, notification_id, channel_id, kind, destination, status, last_error)
      values (new.org_id, new.id, ch.id, ch.kind, dest,
              case when dest is null then 'SKIPPED' else 'PENDING' end,
              case when dest is null then 'no number recorded for this supplier' end);
    else
      -- Venue-wide notifications go to the channel's own configured recipient.
      insert into public.message_deliveries
        (org_id, notification_id, channel_id, kind, destination, status)
      values (new.org_id, new.id, ch.id, ch.kind,
              ch.config ->> 'default_recipient',
              case when ch.config ->> 'default_recipient' is null
                   then 'SKIPPED' else 'PENDING' end);
    end if;
  end loop;
  return null;
end;
$$;

create trigger notifications_queue_deliveries
  after insert on notifications
  for each row execute function public.queue_notification_deliveries();

do $$
declare t text;
begin
  foreach t in array array['tax_rates','category_tax_rates','message_channels','message_deliveries']
  loop
    execute format('create trigger %1$s_set_org before insert on %1$I
                      for each row execute function public.set_org_id()', t);
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

-- ── Starting configuration ──────────────────────────────────────────────────
-- The rates a venue is most likely to need, set to the EU standard until
-- somebody says otherwise. Every one of these is editable.

insert into tax_rates (org_id, name, percent, is_default, note)
select o.id, v.name, v.pct, v.def, v.note
from organizations o
cross join (values
  ('Standard', 21.0, true,  'Applies where nothing more specific does. Alcohol is usually standard-rated.'),
  ('Reduced',  21.0, false, 'Most EU member states reduce restaurant food. Set this to your state''s rate.'),
  ('Zero',      0.0, false, 'Where a supply is zero-rated or outside scope.')
) as v(name, pct, def, note)
on conflict do nothing;

insert into message_channels (org_id, kind, name, enabled, config)
select o.id, c.kind, c.name, false, c.cfg::jsonb
from organizations o
cross join (values
  ('IN_APP',   'In the app',  '{}'),
  ('WHATSAPP', 'WhatsApp Business', '{"phone_number_id":"","template":"ccos_notification","default_recipient":null}'),
  ('EMAIL',    'Email',       '{"from":"","default_recipient":null}')
) as c(kind, name, cfg)
on conflict do nothing;

update message_channels set enabled = true where kind = 'IN_APP';

comment on table tax_rates is
  'VAT rates a venue charges. Nothing here assumes a country; the venue sets its own.';
comment on table message_channels is
  'Where notifications go besides the app. Secrets are NOT stored here.';
comment on table message_deliveries is
  'One row per notification per channel: what was attempted and what happened.';
