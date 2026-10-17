-- ---------------------------------------------------------------------------
-- Cooling is a curve, and a delivery temperature is a HACCP record
-- ---------------------------------------------------------------------------
-- Two gaps in the same surface, which is why they are one migration.
--
-- Cooling. `haccp_records` holds one set of readings against one form, which
-- fits a fridge check and does not fit cooling at all: cooling is a process
-- with stages and a clock, and the thing that goes wrong is a stage taking
-- too long. The rule the UK FSA and EU practice settle on, and the one
-- `AGENTS.md` §11 already quotes in a comment, is 63 °C down to 21 °C within
-- two hours and on to 5 °C within four more.
--
-- Both limits are editable per venue, because they differ by country and a
-- hard-coded threshold is one nobody can comply with elsewhere. The default
-- is seeded, not written into the trigger.
--
-- The record is the last reading of a stage, and a stage that breaches is a
-- breach whether or not anybody noticed at the time — so it is computed on
-- write rather than left to a screen, and like every other HACCP breach it
-- cannot be saved without saying what was done (0035's rule, reused rather
-- than reinvented).
--
-- Delivery temperature. `goods_receipts.vehicle_temperature_c` has existed
-- since 0021 and goes nowhere. Part 1 §5.6 asks for it to become a HACCP
-- record with `source = receiving`, and it should: a chilled delivery
-- accepted at 11 °C is a food safety event, and at the moment the only
-- trace is a column on a receipt nobody reports on.
-- ---------------------------------------------------------------------------

do $$ begin
  create type cooling_stage as enum ('START', 'TWO_HOUR', 'SIX_HOUR', 'EXTRA');
exception when duplicate_object then null; end $$;

create table if not exists cooling_logs (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  business_unit_id uuid references business_units(id) on delete set null,

  product_description text not null,
  lot_id uuid references stock_lots(id) on delete set null,
  production_record_id uuid references production_records(id) on delete set null,

  started_at timestamptz not null default now(),
  start_temperature_c numeric(6,2) not null,

  finished_at timestamptz,
  breach boolean not null default false,
  breach_detail text,
  corrective_action text,

  started_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cooling_logs_named check (btrim(product_description) <> '')
);

create table if not exists cooling_readings (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  cooling_log_id uuid not null references cooling_logs(id) on delete cascade,

  stage cooling_stage not null,
  temperature_c numeric(6,2) not null,
  read_at timestamptz not null default now(),
  read_by_email text,
  /* Computed on write from the venue's own limits, never from the screen. */
  within_limit boolean,
  note text,

  created_at timestamptz not null default now()
);

create index if not exists idx_cooling_readings_log on cooling_readings(cooling_log_id);
create index if not exists idx_cooling_logs_open
  on cooling_logs(org_id, started_at desc) where finished_at is null;

/*
 * The two limits, as a seeder of its own.
 *
 * Not appended to another seeder's VALUES list — `organization_seeders` is a
 * registry precisely so a migration adding a default does not edit somebody
 * else's function (`AGENTS.md` §2).
 */
create or replace function public.seed_cooling_parameters(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.venue_parameters
    (org_id, code, name, description, value, unit, min_value, max_value)
  values
    (p_org, 'COOLING_STAGE_1_HOURS', 'Cooling, first stage',
     'Hours allowed to fall from the start temperature to the first limit.',
     2, 'hours', 0.5, 12),
    (p_org, 'COOLING_STAGE_1_TEMP', 'Cooling, first limit',
     'Temperature to reach by the end of the first stage.', 21, 'degrees', 0, 40),
    (p_org, 'COOLING_STAGE_2_HOURS', 'Cooling, second stage',
     'Further hours allowed to reach the final limit.', 4, 'hours', 0.5, 24),
    (p_org, 'COOLING_STAGE_2_TEMP', 'Cooling, final limit',
     'Temperature to reach by the end of cooling.', 5, 'degrees', 0, 20)
  on conflict (org_id, code) do nothing;
end $$;

revoke all on function public.seed_cooling_parameters(uuid)
  from public, anon, authenticated;

insert into public.organization_seeders (ordinal, function_name, note)
select coalesce(max(ordinal), 0) + 1, 'seed_cooling_parameters',
       'Cooling stage limits, editable because they differ by country (0100)'
  from public.organization_seeders
on conflict (function_name) do nothing;

do $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.seed_cooling_parameters(o.id);
  end loop;
end $$;

create or replace function public.set_cooling_child_org()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent_org uuid;
begin
  select l.org_id into parent_org from public.cooling_logs l where l.id = new.cooling_log_id;
  if parent_org is null then
    raise exception 'the cooling log this reading belongs to does not exist';
  end if;
  new.org_id := parent_org;
  return new;
end $$;

/*
 * Whether a reading made its stage, and what that does to the log.
 *
 * Computed here rather than on a screen because the breach is the record:
 * a stage that overran at two in the morning is a breach whether or not
 * anybody was looking at a page when it happened.
 */
create or replace function public.assess_cooling_reading()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  log record;
  limit_hours numeric;
  limit_temp numeric;
  elapsed_hours numeric;
begin
  select * into log from public.cooling_logs l where l.id = new.cooling_log_id;

  if new.stage = 'START' then
    new.within_limit := true;
    return new;
  end if;

  select v.value into limit_hours from public.venue_parameters v
   where v.org_id = new.org_id
     and v.code = case new.stage when 'TWO_HOUR' then 'COOLING_STAGE_1_HOURS'
                                 else 'COOLING_STAGE_2_HOURS' end;
  select v.value into limit_temp from public.venue_parameters v
   where v.org_id = new.org_id
     and v.code = case new.stage when 'TWO_HOUR' then 'COOLING_STAGE_1_TEMP'
                                 else 'COOLING_STAGE_2_TEMP' end;

  -- Defaults only if a venue has somehow lost its parameters; the seeder
  -- gives every organisation these on creation.
  limit_hours := coalesce(limit_hours, case new.stage when 'TWO_HOUR' then 2 else 6 end);
  limit_temp  := coalesce(limit_temp,  case new.stage when 'TWO_HOUR' then 21 else 5 end);

  -- The second stage's clock runs from the start, not from the first
  -- reading: two hours plus four is six hours of cooling in total.
  if new.stage = 'SIX_HOUR' then
    select coalesce(v.value, 2) into elapsed_hours from public.venue_parameters v
     where v.org_id = new.org_id and v.code = 'COOLING_STAGE_1_HOURS';
    limit_hours := limit_hours + coalesce(elapsed_hours, 2);
  end if;

  elapsed_hours := extract(epoch from (new.read_at - log.started_at)) / 3600.0;

  new.within_limit :=
    (new.temperature_c <= limit_temp) and (elapsed_hours <= limit_hours);

  if not new.within_limit then
    update public.cooling_logs
       set breach = true,
           breach_detail = coalesce(breach_detail,
             format('%s °C after %s hours; the limit is %s °C within %s.',
                    new.temperature_c, round(elapsed_hours, 1), limit_temp, limit_hours)),
           updated_at = now()
     where id = new.cooling_log_id;
  end if;

  return new;
end $$;

/*
 * The same rule 0035 applies to every other breach: a recorded breach with
 * no corrective action is evidence you knew. Reused rather than reinvented,
 * so the two cannot drift apart.
 */
create or replace function public.enforce_cooling_breach()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.finished_at is not null and new.breach
     and btrim(coalesce(new.corrective_action, '')) = '' then
    raise exception 'a breach must record what was done about it'
      using hint = 'A recorded breach with no corrective action is evidence you knew.';
  end if;
  return new;
end $$;

drop trigger if exists cooling_logs_set_org on cooling_logs;
create trigger cooling_logs_set_org before insert on cooling_logs
  for each row execute function public.set_org_id();
drop trigger if exists cooling_logs_touch on cooling_logs;
create trigger cooling_logs_touch before update on cooling_logs
  for each row execute function public.set_updated_at();
drop trigger if exists cooling_logs_breach on cooling_logs;
create trigger cooling_logs_breach before insert or update on cooling_logs
  for each row execute function public.enforce_cooling_breach();

drop trigger if exists cooling_readings_set_org on cooling_readings;
create trigger cooling_readings_set_org before insert on cooling_readings
  for each row execute function public.set_cooling_child_org();
/*
 * `zz` so it sorts after `cooling_readings_set_org`.
 *
 * Postgres fires same-timing triggers in alphabetical order, and "assess"
 * sorts before "set_org" — so the first draft looked the venue's limits up
 * with `new.org_id` still null, found nothing, and silently fell back to
 * the defaults written into this function. Two tests passed anyway, because
 * the defaults happen to equal the seeded values; the one that caught it
 * was the one that changed a venue's limit and expected the change to
 * matter. `AGENTS.md` §2 records the same trap numbering a kitchen job
 * WO-ENG-.
 */
drop trigger if exists cooling_readings_assess on cooling_readings;
drop trigger if exists cooling_readings_zz_assess on cooling_readings;
create trigger cooling_readings_zz_assess before insert on cooling_readings
  for each row execute function public.assess_cooling_reading();

alter table cooling_logs enable row level security;
alter table cooling_readings enable row level security;

drop policy if exists cooling_logs_read on cooling_logs;
create policy cooling_logs_read on cooling_logs for select to authenticated
  using (public.can_read_section('HYGIENE', org_id));
drop policy if exists cooling_logs_write on cooling_logs;
create policy cooling_logs_write on cooling_logs for insert to authenticated
  with check (public.auth_can_write(org_id));
drop policy if exists cooling_logs_update on cooling_logs;
create policy cooling_logs_update on cooling_logs for update to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));

drop policy if exists cooling_readings_read on cooling_readings;
create policy cooling_readings_read on cooling_readings for select to authenticated
  using (public.can_read_section('HYGIENE', org_id));
drop policy if exists cooling_readings_write on cooling_readings;
create policy cooling_readings_write on cooling_readings for insert to authenticated
  with check (public.auth_can_write(org_id));

-- Readings append. A temperature that was taken was taken.
grant select, insert, update on cooling_logs to authenticated;
grant select, insert on cooling_readings to authenticated;

drop trigger if exists cooling_logs_section_guard on cooling_logs;
create trigger cooling_logs_section_guard
  before insert or update or delete on cooling_logs
  for each row execute function public.require_section_write('HYGIENE');
drop trigger if exists cooling_readings_section_guard on cooling_readings;
create trigger cooling_readings_section_guard
  before insert or update or delete on cooling_readings
  for each row execute function public.require_section_write('HYGIENE');

delete from public.section_read_rules
 where table_name in ('cooling_logs', 'cooling_readings');
insert into public.section_read_rules (table_name, section_code) values
  ('cooling_logs', 'HYGIENE'),
  ('cooling_readings', 'HYGIENE');

-- ── A delivery temperature becomes a hygiene record ────────────────────────

alter table haccp_records
  add column if not exists source text not null default 'manual',
  add column if not exists goods_receipt_id uuid
    references goods_receipts(id) on delete set null;

comment on column haccp_records.source is
  'manual, receiving, or sensor. 0100 writes the receiving ones; sensor is declared and not yet produced.';

/*
 * A chilled delivery accepted warm is a food safety event.
 *
 * Written from the receipt rather than asked for twice, because a storeman
 * who has already typed the temperature on the delivery is not going to
 * type it again on a hygiene form — and a control nobody completes is not a
 * control.
 *
 * It finds the venue's own receiving form by section rather than by a code
 * written here, so a venue that has renamed or re-coded theirs still gets
 * the record. Where there is no such form the receipt still saves: refusing
 * a delivery because a form is missing would stop the kitchen working.
 */
create or replace function public.log_receipt_temperature()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  form record;
  chilled_limit numeric;
  is_breach boolean;
begin
  if new.vehicle_temperature_c is null then
    return new;
  end if;

  select f.id, f.is_ccp into form
    from public.haccp_forms f
   where f.org_id = new.org_id
     and f.active
     and lower(f.section) like '%receiv%'
   order by f.is_ccp desc
   limit 1;

  if form.id is null then
    return new;
  end if;

  select v.value into chilled_limit from public.venue_parameters v
   where v.org_id = new.org_id and v.code = 'DELIVERY_CHILLED_MAX';
  chilled_limit := coalesce(chilled_limit, 8);

  is_breach := new.vehicle_temperature_c > chilled_limit;

  insert into public.haccp_records
    (org_id, form_id, covers_date, values, breach, breach_detail,
     corrective_action, completed_by_email, completed_at, source, goods_receipt_id)
  values (
    new.org_id, form.id, new.received_on,
    jsonb_build_object('Vehicle temperature', new.vehicle_temperature_c),
    is_breach,
    case when is_breach then
      format('Delivery arrived at %s °C; the limit is %s °C.',
             new.vehicle_temperature_c, chilled_limit) end,
    -- The receipt's own note carries the action where there was one; a
    -- breach with nothing recorded is refused by enforce_haccp_breach, which
    -- is why the fallback is explicit rather than blank.
    case when is_breach then
      coalesce(nullif(btrim(new.notes), ''),
               'Recorded on delivery; see the goods receipt.') end,
    -- `completed_by_email` is not null, and a receipt entered by a migration
    -- or an integration may carry no address. Naming the source beats
    -- failing the delivery over a missing email.
    coalesce(nullif(btrim(new.received_by_email), ''),
             auth.jwt() ->> 'email',
             'recorded from the delivery'),
    now(), 'receiving', new.id);

  return new;
end $$;

drop trigger if exists goods_receipts_temperature on goods_receipts;
create trigger goods_receipts_temperature
  after insert on goods_receipts
  for each row execute function public.log_receipt_temperature();

create or replace function public.seed_delivery_temperature_parameter(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.venue_parameters
    (org_id, code, name, description, value, unit, min_value, max_value)
  values (p_org, 'DELIVERY_CHILLED_MAX', 'Delivery temperature limit',
          'Above this, a chilled delivery is recorded as a hygiene breach.',
          8, 'degrees', 0, 20)
  on conflict (org_id, code) do nothing;
end $$;

revoke all on function public.seed_delivery_temperature_parameter(uuid)
  from public, anon, authenticated;

insert into public.organization_seeders (ordinal, function_name, note)
select coalesce(max(ordinal), 0) + 1, 'seed_delivery_temperature_parameter',
       'Above this a chilled delivery is a hygiene breach (0100)'
  from public.organization_seeders
on conflict (function_name) do nothing;

do $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.seed_delivery_temperature_parameter(o.id);
  end loop;
end $$;

comment on table cooling_logs is
  'A cooling process with stages and a clock. Limits are venue parameters because they differ by country. See 0100.';
