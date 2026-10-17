-- ---------------------------------------------------------------------------
-- A forecast somebody can argue with
-- ---------------------------------------------------------------------------
-- Three things want this and none of them has it: rostering wants expected
-- covers to set a labour target, prep planning wants expected sales to work
-- out what to make, and auto-reorder wants expected usage to decide what to
-- buy. All three are currently done from memory.
--
-- The brief asks for the method to stay simple and explainable, and that is
-- the whole design. A forecast nobody understands is one nobody trusts, and
-- an untrusted forecast is ignored — which is worse than none, because the
-- system now looks like it is planning.
--
-- So: the same weekday over the last few weeks, averaged, with the public
-- holidays taken out of the sample and known events added back. Four to
-- eight weeks, configurable. No seasonality model, no regression, nothing
-- that cannot be explained to a head chef in one sentence.
--
-- The forecast is stored rather than computed on the fly, for two reasons.
-- A roster built against Tuesday's forecast should still be explicable in
-- March when the underlying sales have moved on. And "how good is the
-- forecast" needs the number that was actually used, not a recomputation
-- that has since improved.
-- ---------------------------------------------------------------------------

create table if not exists sales_forecasts (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  business_unit_id uuid references business_units(id) on delete cascade,

  forecast_for date not null,
  covers numeric(12,2),
  net_sales numeric(18,5),

  /* How it was arrived at, so the number can be argued with. */
  method text not null default 'same weekday average',
  weeks_sampled integer,
  samples_used integer,
  note text,

  /* Filled in afterwards, so accuracy can be read rather than assumed. */
  actual_covers numeric(12,2),
  actual_net_sales numeric(18,5),

  made_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sales_forecasts_unique unique (org_id, business_unit_id, forecast_for)
);

create index if not exists idx_sales_forecasts_for
  on sales_forecasts(org_id, forecast_for);

/*
 * Events a venue knows about, which the average cannot.
 *
 * A wedding for ninety is not a Tuesday, and no amount of looking at past
 * Tuesdays will find it. `covers_override` replaces the figure outright
 * rather than adding to it, because "ninety on top of a normal Tuesday" and
 * "ninety instead of" are different bookings and only the person entering
 * it knows which.
 */
create table if not exists known_events (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  business_unit_id uuid references business_units(id) on delete cascade,

  on_date date not null,
  name text not null,
  covers_override numeric(12,2),
  covers_extra numeric(12,2),
  note text,

  created_at timestamptz not null default now(),

  constraint known_events_named check (btrim(name) <> ''),
  constraint known_events_one_way
    check (covers_override is null or covers_extra is null)
);

create index if not exists idx_known_events_date on known_events(org_id, on_date);

create or replace function public.seed_forecast_parameter(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.venue_parameters
    (org_id, code, name, description, value, unit, min_value, max_value)
  values (p_org, 'FORECAST_WEEKS', 'Forecast sample',
          'How many past weeks of the same weekday the forecast averages.',
          6, 'weeks', 2, 12)
  on conflict (org_id, code) do nothing;
end $$;

revoke all on function public.seed_forecast_parameter(uuid)
  from public, anon, authenticated;

insert into public.organization_seeders (ordinal, function_name, note)
select coalesce(max(ordinal), 0) + 1, 'seed_forecast_parameter',
       'How many weeks the sales forecast averages (0107)'
  from public.organization_seeders
on conflict (function_name) do nothing;

do $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.seed_forecast_parameter(o.id);
  end loop;
end $$;

/*
 * Build a forecast for a date.
 *
 * Public holidays are excluded from the sample rather than adjusted for.
 * Averaging a bank holiday into a normal Tuesday corrupts both, and a venue
 * that wants a holiday forecast should enter it as a known event — which is
 * the honest way to say "this day is not like the others".
 *
 * `daily_takings` is one row per channel per day, so the sample aggregates to
 * the day before averaging. Averaging the rows would average *channels*: a
 * Tuesday with delivery and walk-in counted as two half-Tuesdays, and a unit
 * that opened a second channel mid-sample would appear to have halved its
 * covers. The first draft of this function did exactly that.
 *
 * Returns the number of forecasts written so a caller can tell the
 * difference between "nothing to forecast" and "nothing happened".
 */
create or replace function public.build_sales_forecast(
  p_org uuid, p_for date, p_unit uuid default null
)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  weeks integer;
  unit record;
  made integer := 0;
  seen integer := 0;
  permitted integer := 0;
  sample record;
  ev record;
  final_covers numeric;
begin
  select coalesce(v.value, 6)::int into weeks
    from public.venue_parameters v
   where v.org_id = p_org and v.code = 'FORECAST_WEEKS';
  weeks := coalesce(weeks, 6);

  for unit in
    select b.id from public.business_units b
     where b.org_id = p_org and b.active
       and (p_unit is null or b.id = p_unit)
  loop
    /*
     * The permission question is asked per unit, and only per unit.
     *
     * The first draft gated the whole function on `can_write_section('REVENUE',
     * p_org)` and that was wrong in the direction AGENTS.md section 1
     * describes: `auth_section_level` with a null unit matches only grants
     * whose own `business_unit_id` is null, so an outlet manager holding
     * Revenue on their own restaurant and nothing else scores NONE at the
     * organisation and was refused outright — refused, that is, for the one
     * unit they are actually responsible for.
     *
     * So each unit is asked about separately and the ones they cannot write
     * are skipped, which keeps a venue-wide call working for somebody who
     * holds two outlets out of five.
     *
     * This is not duplicating the section guard on the table, which was the
     * first objection to it. Deleting these three lines and watching the suite
     * showed what they actually cover: the guard refuses a *member* who holds
     * nothing on the unit, but it returns early when `auth.uid()` is null —
     * the deliberate carve-out for the staff portal, so a commis chef's own
     * clock-in is not refused with a message about a section they are not
     * supposed to know exists. An unauthenticated caller therefore sails past
     * the trigger, and this check is the only thing in front of them.
     */
    seen := seen + 1;
    if not public.can_write_section('REVENUE', p_org, unit.id) then
      continue;
    end if;
    permitted := permitted + 1;

    select
        avg(day.covers)   as covers,
        avg(day.net)      as net_sales,
        count(*)          as n
      into sample
      from (
        select d.on_date,
               sum(d.covers)     as covers,
               sum(d.net_amount) as net
          from public.daily_takings d
         where d.org_id = p_org
           and d.business_unit_id = unit.id
           and d.on_date < p_for
           and d.on_date >= p_for - (weeks * 7)
           and extract(dow from d.on_date) = extract(dow from p_for)
           -- A bank holiday is not a normal Tuesday, in either direction.
           and not exists (
             select 1 from public.public_holidays h
              where h.org_id = p_org and h.holiday_on = d.on_date)
         group by d.on_date
      ) day;

    if coalesce(sample.n, 0) = 0 then
      continue;   -- Nothing to go on. Better than a confident zero.
    end if;

    final_covers := sample.covers;

    select * into ev from public.known_events e
     where e.org_id = p_org and e.on_date = p_for
       and (e.business_unit_id is null or e.business_unit_id = unit.id)
     order by (e.business_unit_id is not null) desc
     limit 1;

    if ev.id is not null then
      if ev.covers_override is not null then
        final_covers := ev.covers_override;
      elsif ev.covers_extra is not null then
        final_covers := coalesce(final_covers, 0) + ev.covers_extra;
      end if;
    end if;

    insert into public.sales_forecasts
      (org_id, business_unit_id, forecast_for, covers, net_sales,
       weeks_sampled, samples_used, made_by_email, note)
    values (p_org, unit.id, p_for,
            round(final_covers, 2),
            round(sample.net_sales, 5),
            weeks, sample.n,
            auth.jwt() ->> 'email',
            case when ev.id is not null then 'Adjusted for ' || ev.name end)
    on conflict (org_id, business_unit_id, forecast_for) do update
      set covers = excluded.covers,
          net_sales = excluded.net_sales,
          weeks_sampled = excluded.weeks_sampled,
          samples_used = excluded.samples_used,
          note = excluded.note,
          updated_at = now();

    made := made + 1;
  end loop;

  /*
   * Nothing written has two quite different causes and they must not read the
   * same. A venue with no active business units has nothing to forecast and
   * gets zero; somebody with no Revenue access anywhere gets told so. Folding
   * the second into the first would mean a manager clicking Forecast, seeing
   * "nothing to forecast", and never learning they were refused.
   */
  if seen > 0 and permitted = 0 then
    raise exception 'you do not have edit access to Revenue for any outlet'
      using errcode = '42501';
  end if;

  return made;
end $$;

revoke all on function public.build_sales_forecast(uuid, date, uuid) from public;
grant execute on function public.build_sales_forecast(uuid, date, uuid) to authenticated;

drop trigger if exists sales_forecasts_set_org on sales_forecasts;
create trigger sales_forecasts_set_org before insert on sales_forecasts
  for each row execute function public.set_org_id();
drop trigger if exists sales_forecasts_touch on sales_forecasts;
create trigger sales_forecasts_touch before update on sales_forecasts
  for each row execute function public.set_updated_at();
drop trigger if exists known_events_set_org on known_events;
create trigger known_events_set_org before insert on known_events
  for each row execute function public.set_org_id();

alter table sales_forecasts enable row level security;
alter table known_events enable row level security;

drop policy if exists sales_forecasts_read on sales_forecasts;
create policy sales_forecasts_read on sales_forecasts for select to authenticated
  using (public.can_read_section('REVENUE', org_id));
drop policy if exists sales_forecasts_write on sales_forecasts;
create policy sales_forecasts_write on sales_forecasts for all to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));

drop policy if exists known_events_read on known_events;
create policy known_events_read on known_events for select to authenticated
  using (org_id in (select public.auth_org_ids()));
drop policy if exists known_events_write on known_events;
create policy known_events_write on known_events for all to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));

grant select, insert, update, delete on sales_forecasts to authenticated;
grant select, insert, update, delete on known_events to authenticated;

drop trigger if exists sales_forecasts_section_guard on sales_forecasts;
create trigger sales_forecasts_section_guard
  before insert or update or delete on sales_forecasts
  for each row execute function public.require_section_write('REVENUE');

delete from public.section_read_rules
 where table_name in ('sales_forecasts', 'known_events');
insert into public.section_read_rules (table_name, section_code, shared_because) values
  ('sales_forecasts', 'REVENUE', null),
  ('known_events', null, 'a wedding on Saturday, which the rota and the prep list both need');

/*
 * How good the forecast turned out to be.
 *
 * Shown rather than hidden, because a forecast whose accuracy nobody can
 * see is one people stop checking and then stop trusting, in that order.
 */
create or replace view forecast_accuracy
with (security_invoker = true) as
  select
    f.org_id,
    f.business_unit_id,
    b.name as unit_name,
    f.forecast_for,
    f.covers            as forecast_covers,
    f.actual_covers,
    f.samples_used,
    case when f.actual_covers > 0
         then round(abs(f.covers - f.actual_covers) / f.actual_covers * 100, 1)
    end                 as covers_error_percent,
    f.net_sales         as forecast_net_sales,
    f.actual_net_sales,
    -- A forecast built on one past day is a guess with a decimal point.
    (coalesce(f.samples_used, 0) < 3) as thin_evidence
  from public.sales_forecasts f
  left join public.business_units b on b.id = f.business_unit_id
  where f.actual_covers is not null or f.actual_net_sales is not null;

grant select on forecast_accuracy to authenticated;

comment on table sales_forecasts is
  'Stored rather than recomputed, so a roster built against Tuesday''s forecast is still explicable in March. See 0107.';
comment on table known_events is
  'What the average cannot know. A wedding for ninety is not a Tuesday. See 0107.';
