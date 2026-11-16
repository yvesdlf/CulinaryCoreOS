-- ---------------------------------------------------------------------------
-- Maintenance: the plant, the plan, and the jobs nobody closed
-- ---------------------------------------------------------------------------
-- 0055 built a small CMMS and nothing has ever been in it. No assets, no work
-- orders, no planned maintenance — so the Maintenance screen renders an empty
-- state, `maintenance_due` returns nothing, `asset_health` has no asset, and
-- `maintenance_report` (0131) has nothing to report. Four surfaces that have
-- never been looked at.
--
-- ── What it has to contain ────────────────────────────────────────────────
--
-- The report exists to raise things a head of department must act on, so the
-- seed has to contain each of them or the report ships untested against its
-- own purpose:
--
--   a statutory check that has gone past its date,
--   a planned check that has gone past its date,
--   an asset out of service and one running degraded,
--   work orders past their due date and still open,
--   work completed that nobody ever verified,
--   emergencies,
--   a job that has been open over a month,
--   an asset with a maintenance plan whose every job was reactive anyway,
--   and work raised against no asset at all.
--
-- Plus a majority of ordinary, closed, verified jobs, so the exceptions read
-- as exceptions. A demo where every line is a finding teaches the reader to
-- ignore the column.
--
-- ── Nothing is assigned to anybody ────────────────────────────────────────
--
-- 0055 refuses an assignment to someone whose certifications do not cover the
-- asset, who is on approved leave, or who has left. That rule is worth having
-- and worth testing, but a seed that tripped it would fail halfway through
-- and leave the database half-built. Jobs here carry a status and no
-- assignee; the certification rule is exercised by the control suite, which
-- is where a rule belongs.
--
-- ── Deterministic, not random ─────────────────────────────────────────────
--
-- Every choice is a modulus of the job index. See seed_production.sql: the
-- visual baselines are screenshots of this database.
--
-- Safe to run more than once: it clears its own rows first.
-- ---------------------------------------------------------------------------

do $$
declare
  org uuid;
  i integer;
  k integer;
  loc_site uuid;
  loc_boh uuid;
  loc_plant uuid;
  loc_pub uuid;
  raised date;
  done date;
  st text;
  asset_ids uuid[];
  n_assets integer;
  pick uuid;
  n_wo integer := 0;
  n_loose integer := 0;
begin
  begin
    select id into strict org from public.organizations where name = 'Demo Kitchen';
  exception
    when no_data_found then
      raise exception 'no organisation called "Demo Kitchen"'
        using hint = 'Run seed.sql first, or rename the venue you want seeded.';
    when too_many_rows then
      raise exception 'more than one organisation is called "Demo Kitchen"'
        using hint = 'The seeds cannot tell which venue you mean. Rename all but one.';
  end;

  /*
   * Work orders first: `work_orders.plan_id` and `assets.id` are both
   * referenced, and 0055 holds some of those references with `restrict`.
   * The event log goes with them — it is written by trigger, so deleting the
   * orders without it would leave a log of jobs that no longer exist.
   */
  delete from public.work_order_events
   where work_order_id in (select id from public.work_orders where org_id = org);
  delete from public.work_orders    where org_id = org;
  delete from public.maintenance_plans where org_id = org;
  delete from public.assets         where org_id = org;

  select id into loc_site  from public.locations where org_id = org and code = 'SITE';
  select id into loc_boh   from public.locations where org_id = org and code = 'BOH';
  select id into loc_plant from public.locations where org_id = org and code = 'PLANT';
  select id into loc_pub   from public.locations where org_id = org and code = 'PUB';

  if loc_plant is null then
    raise exception 'the venue has no locations to put plant in'
      using hint = 'Run seed.sql first.';
  end if;

  -- ── The plant ───────────────────────────────────────────────────────────
  /*
   * Fourteen assets, which is about what a beach club actually has on a
   * register. Two are not in service on purpose: the report has a concern for
   * each state and neither would ever fire otherwise.
   */
  insert into public.assets
    (org_id, code, name, category, location_id, criticality, status,
     manufacturer, model, commissioned_on, warranty_until, purchase_cost)
  values
    (org, 'FR-01', 'Walk-in chiller',          'REFRIGERATION', loc_boh,
     'CRITICAL',  'IN_SERVICE',     'Foster',    'PROG1350', current_date - 900, current_date + 120, 48000000),
    (org, 'FR-02', 'Walk-in freezer',          'REFRIGERATION', loc_boh,
     'CRITICAL',  'DEGRADED',       'Foster',    'PROG1350L', current_date - 900, current_date - 40, 52000000),
    (org, 'FR-03', 'Bar bottle cooler',        'REFRIGERATION', loc_pub,
     'IMPORTANT', 'IN_SERVICE',     'Polar',     'CB929',   current_date - 400, current_date + 330, 9500000),
    (org, 'FR-04', 'Ice machine',              'REFRIGERATION', loc_pub,
     'IMPORTANT', 'OUT_OF_SERVICE', 'Hoshizaki', 'IM-65NE', current_date - 1200, null, 31000000),
    (org, 'CK-01', 'Six-burner range',         'COOKING',       loc_boh,
     'CRITICAL',  'IN_SERVICE',     'Falcon',    'G3101',   current_date - 1100, null, 42000000),
    (org, 'CK-02', 'Combi oven',               'COOKING',       loc_boh,
     'CRITICAL',  'IN_SERVICE',     'Rational',  'iCombi 10', current_date - 700, current_date + 60, 185000000),
    (org, 'CK-03', 'Deep fryer',               'COOKING',       loc_boh,
     'IMPORTANT', 'IN_SERVICE',     'Lincat',    'OE7113',  current_date - 500, null, 14000000),
    (org, 'CK-04', 'Extraction canopy',        'VENTILATION',   loc_boh,
     'CRITICAL',  'IN_SERVICE',     null,        null,      current_date - 1400, null, 76000000),
    (org, 'HV-01', 'Restaurant air handling',  'HVAC',          loc_pub,
     'IMPORTANT', 'IN_SERVICE',     'Daikin',    'FXMQ200',  current_date - 800, null, 120000000),
    (org, 'EL-01', 'Main distribution board',  'ELECTRICAL',    loc_plant,
     'CRITICAL',  'IN_SERVICE',     null,        null,      current_date - 2000, null, 65000000),
    (org, 'EL-02', 'Standby generator',        'ELECTRICAL',    loc_plant,
     'CRITICAL',  'IN_SERVICE',     'Cummins',   'C33 D5',  current_date - 1500, null, 210000000),
    (org, 'PL-01', 'Grease trap',              'PLUMBING',      loc_boh,
     'IMPORTANT', 'IN_SERVICE',     null,        null,      current_date - 1400, null, 18000000),
    (org, 'PL-02', 'Hot water calorifier',     'PLUMBING',      loc_plant,
     'CRITICAL',  'IN_SERVICE',     null,        null,      current_date - 1600, null, 54000000),
    (org, 'FS-01', 'Fire alarm panel',         'FIRE_SAFETY',   loc_site,
     'CRITICAL',  'IN_SERVICE',     'Advanced',  'MxPro 5', current_date - 1000, null, 88000000);

  -- ── The programme on paper ──────────────────────────────────────────────
  /*
   * `statutory` is the column that matters. A statutory check past its date
   * is not a maintenance backlog item, it is a venue operating outside its
   * obligations, and the report puts it first for that reason.
   *
   * `last_completed_on` is set below rather than here, because completing a
   * plan-linked work order advances it by trigger (0055) and would overwrite
   * whatever this said.
   */
  insert into public.maintenance_plans
    (org_id, asset_id, code, title, interval_days, estimated_minutes,
     criticality, statutory, active)
  select org, ast.id, x.code, x.title, x.days, x.mins,
         x.crit::public.asset_criticality, x.stat, true
    from (values
      ('FS-01', 'PPM-FIRE',   'Fire alarm panel: weekly call point test', 7,   30, 'CRITICAL',  true),
      ('EL-01', 'PPM-PAT',    'Portable appliance testing',               365, 480, 'CRITICAL',  true),
      ('EL-02', 'PPM-GEN',    'Standby generator load test',              30,  120, 'CRITICAL',  true),
      ('CK-04', 'PPM-DUCT',   'Kitchen extract deep clean',               180, 360, 'CRITICAL',  true),
      ('PL-02', 'PPM-LEGIO',  'Legionella temperature monitoring',        30,  60,  'CRITICAL',  true),
      ('FR-01', 'PPM-CHILL',  'Walk-in chiller service',                  90,  120, 'CRITICAL',  false),
      ('FR-02', 'PPM-FREEZ',  'Walk-in freezer service',                  90,  120, 'CRITICAL',  false),
      ('CK-02', 'PPM-COMBI',  'Combi oven descale and service',           90,  180, 'IMPORTANT', false),
      ('HV-01', 'PPM-AHU',    'Air handling filter change',               90,  90,  'IMPORTANT', false),
      ('PL-01', 'PPM-GREASE', 'Grease trap pump-out',                     30,  60,  'IMPORTANT', false)
    ) as x(asset, code, title, days, mins, crit, stat)
    join public.assets ast on ast.org_id = org and ast.code = x.asset;

  select array_agg(id order by code) into asset_ids
    from public.assets where org_id = org;
  n_assets := array_length(asset_ids, 1);

  -- ── Ninety days of jobs ─────────────────────────────────────────────────
  for i in 0..71 loop
    raised := current_date - ((i * 5) % 90);

    /*
     * One job in nine has no asset: a leak in a corridor, a door that sticks.
     * It is the fabric of the building rather than the plant, and the report
     * keeps it under a null asset rather than dropping it.
     */
    if i % 9 = 4 then
      pick := null;
    else
      /*
       * A stride coprime with the number of assets.
       *
       * The first version used 7 against 14 assets, and `7i mod 14` only
       * ever takes two values — so twelve of the fourteen never saw a single
       * job and the report showed a venue with two machines. A modulus is
       * only a spread if it shares no factor with the range.
       */
      pick := asset_ids[1 + (i * 5) % n_assets];
    end if;

    /*
     * The status mix. Roughly two thirds closed, because a venue whose every
     * job is open is not a venue anybody would recognise — and because the
     * exceptions only read as exceptions against a majority that is fine.
     */
    st := case (i % 12)
            when 0 then 'OPEN'
            when 1 then 'IN_PROGRESS'
            when 2 then 'ON_HOLD'
            when 3 then 'COMPLETED'   -- done, never verified
            when 4 then 'CANCELLED'
            else 'VERIFIED'
          end;

    -- Closed jobs took between a day and a fortnight.
    done := raised + (1 + (i % 13));
    if done > current_date then done := current_date; end if;

    insert into public.work_orders
      (org_id, title, detail, asset_id, location_id, source, priority, status,
       raised_by_email, raised_at, due_by,
       completed_at, completed_by_email, completion_note,
       verified_at, verified_by_email,
       cancelled_reason, downtime_minutes, labour_minutes)
    values (
      org,
      case (i % 6)
        when 0 then 'Not holding temperature'
        when 1 then 'Noise on start-up'
        when 2 then 'Leaking at the union'
        when 3 then 'Intermittent trip'
        when 4 then 'Fails to reach setpoint'
        else        'Routine inspection finding'
      end,
      'Raised from the floor during service.',
      pick,
      case when pick is null then loc_pub else null end,
      (case (i % 7)
         when 0 then 'PLANNED'
         when 1 then 'INSPECTION'
         when 2 then 'GUEST'
         else 'REACTIVE'
       end)::public.work_order_source,
      (case (i % 11)
         when 0 then 'EMERGENCY'
         when 1 then 'HIGH'
         when 2 then 'HIGH'
         when 10 then 'LOW'
         else 'NORMAL'
       end)::public.work_order_priority,
      st::public.work_order_status,
      'gm@venue.test',
      (raised::timestamp + interval '9 hours') at time zone 'UTC',
      /*
       * One open job in four is given a date that has already passed. An
       * overdue work order is the commonest finding in any CMMS and a demo
       * without one shows a venue nobody would believe.
       */
      case when st in ('OPEN', 'IN_PROGRESS', 'ON_HOLD') and i % 4 = 1
           then current_date - (3 + i % 20)
           else raised + 14 end,
      case when st in ('COMPLETED', 'VERIFIED')
           then (done::timestamp + interval '15 hours') at time zone 'UTC' end,
      case when st in ('COMPLETED', 'VERIFIED') then 'ketut@venue.test' end,
      case when st in ('COMPLETED', 'VERIFIED')
           then 'Stripped, cleaned and reseated. Ran for an hour on test.' end,
      -- Verified a day later, and never by the person who did the work: 0055
      -- refuses that, and the refusal is the control worth demonstrating.
      case when st = 'VERIFIED'
           then ((done + 1)::timestamp + interval '10 hours') at time zone 'UTC' end,
      case when st = 'VERIFIED' then 'gm@venue.test' end,
      case when st = 'CANCELLED'
           then 'Reported twice; the other job covers it.' end,
      case when st in ('COMPLETED', 'VERIFIED') then (i % 7) * 15 end,
      case when st in ('COMPLETED', 'VERIFIED') then 30 + (i % 9) * 20 end
    );

    n_wo := n_wo + 1;
    if pick is null then n_loose := n_loose + 1; end if;
  end loop;

  /*
   * One job left open far longer than the rest, so the "open for n days"
   * concern has something to fire on. Parked against the freezer, which is
   * also the asset running degraded — which is how it usually goes.
   */
  insert into public.work_orders
    (org_id, title, detail, asset_id, source, priority, status,
     raised_by_email, raised_at, due_by)
  select org, 'Door seal perished, icing up', 'Quoted; waiting on the part.',
         ast.id, 'REACTIVE', 'HIGH', 'OPEN', 'chef@venue.test',
         ((current_date - 74)::timestamp + interval '11 hours') at time zone 'UTC',
         current_date - 60
    from public.assets ast where ast.org_id = org and ast.code = 'FR-02';
  n_wo := n_wo + 1;

  /*
   * And the programme's own state, written last.
   *
   * Three are left past their date on purpose — two statutory and one not —
   * because a venue that is fully up to date on statutory maintenance is not
   * the venue this report was written for. The rest are set inside their
   * interval so they do not all read as a breach.
   */
  update public.maintenance_plans p
     set last_completed_on = case p.code
           when 'PPM-FIRE'   then current_date - 23   -- weekly: three weeks late
           when 'PPM-LEGIO'  then current_date - 47   -- monthly: a fortnight late
           when 'PPM-COMBI'  then current_date - 115  -- quarterly: late, not statutory
           else current_date - (p.interval_days / 2)
         end
   where p.org_id = org;

  raise notice 'Maintenance: % assets, % plans, % work orders (% against no asset)',
    (select count(*) from public.assets where org_id = org),
    (select count(*) from public.maintenance_plans where org_id = org),
    n_wo, n_loose;
  raise notice 'Maintenance: % plans past their date, of which % statutory',
    (select count(*) from public.maintenance_plans p
      where p.org_id = org and p.active
        and (coalesce(p.last_completed_on, current_date - p.interval_days)
             + p.interval_days) < current_date),
    (select count(*) from public.maintenance_plans p
      where p.org_id = org and p.active and p.statutory
        and (coalesce(p.last_completed_on, current_date - p.interval_days)
             + p.interval_days) < current_date);
end $$;
