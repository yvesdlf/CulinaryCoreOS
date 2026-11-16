-- ---------------------------------------------------------------------------
-- Housekeeping: the floors, the sheets, and the rooms nobody checked
-- ---------------------------------------------------------------------------
-- 0056 built housekeeping in September with five views over it —
-- `housekeeping_board`, `housekeeping_workload`, `rooms_to_inspect`,
-- `my_rooms` and `housekeeping_replenishment` — and the venue has four room
-- types and **zero rooms**. Not one of those five views has ever rendered a
-- row, and neither has `housekeeping_report` (0132).
--
-- ── It has to seed the rota as well, and that is the point ────────────────
--
-- 0056 refuses to assign housekeeping to somebody who is not rostered that
-- day: it looks for a PUBLISHED shift on the task date and raises if there is
-- none. `shifts` was also empty, so a seed that simply assigned work would
-- have failed on its first row.
--
-- The honest options were to leave every task unassigned — which would have
-- made `housekeeping_workload` and `my_rooms` as empty as before, and the
-- report's `attendants` column permanently nought — or to publish the shifts
-- the work actually needs. This does the second. The shifts are the minimum
-- for the two housekeepers on the days they are given rooms; it is not a rota
-- seed and does not pretend to be one.
--
-- ── What it has to contain ────────────────────────────────────────────────
--
--   a room out of service, with a reason,
--   a room that has sat dirty far longer than the rest,
--   inspections that failed, with findings, and the rooms sent back,
--   rooms cleaned that nobody has inspected,
--   tasks that were never finished,
--   a room that consistently overruns the time allowed,
--   and work against a place rather than a room.
--
-- Against a majority of ordinary rooms that were cleaned, inspected and
-- passed, so the exceptions read as exceptions.
--
-- ── Inspections are inserted, not simulated ───────────────────────────────
--
-- 0056 moves the task and the room *by trigger* when an inspection lands: a
-- pass sends the task to INSPECTED, a failure to REJECTED. So tasks are
-- written as DONE and the inspection does the rest, rather than this file
-- setting both and quietly disagreeing with the trigger about what a pass
-- means.
--
-- The rule that nobody may inspect a room they cleaned is enforced the same
-- way, so the two housekeepers inspect each other's work. A seed that tripped
-- that rule would fail halfway and leave the database half-built.
--
-- Deterministic, not random — see seed_production.sql. Safe to run twice.
-- ---------------------------------------------------------------------------

do $$
declare
  org uuid;
  loc_pub uuid;
  kartini uuid;
  sriati uuid;
  kartini_email text := 'kartini@venue.test';
  sriati_email text := 'housekeep@venue.test';
  hk_dept uuid;
  i integer;
  d date;
  r record;
  who uuid;
  who_email text;
  other_email text;
  task_id uuid;
  st text;
  n_rooms integer := 0;
  n_shifts integer := 0;
  n_tasks integer := 0;
  n_insp integer := 0;
  n_failed integer := 0;
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
   * Inspections cascade from tasks and state events from rooms, but the order
   * is written out rather than relied on: a future `on delete restrict`
   * should fail loudly here rather than silently leave orphans.
   */
  delete from public.housekeeping_inspections where org_id = org;
  delete from public.housekeeping_tasks where org_id = org;
  delete from public.room_state_events where org_id = org;
  delete from public.rooms where org_id = org;
  delete from public.shifts
   where org_id = org and notes = 'Housekeeping demo';
  delete from public.locations where org_id = org and code like 'RM-%';

  select id into loc_pub from public.locations where org_id = org and code = 'PUB';

  /*
   * A location per room, because `idx_rooms_location` is unique on
   * `location_id`: in this schema a guest room *is* a location, not a thing
   * inside one. Maintenance and hygiene hang their own records off the same
   * place, which is the reason for the rule — a work order raised "in 305"
   * and a room called 305 have to be the same row or neither module can
   * answer the other's question.
   */
  insert into public.locations (org_id, code, name, kind)
  select org, 'RM-' || x.number, 'Room ' || x.number, 'GUEST_ROOM'
    from (values
      ('101'),('102'),('103'),('104'),('105'),('106'),('107'),('108'),
      ('201'),('202'),('203'),('204'),('205'),('206'),('207'),('208'),
      ('301'),('302'),('303'),('304'),('305'),('306'),('401'),('402')
    ) as x(number);

  select id into kartini from public.employees
   where org_id = org and lower(work_email) = kartini_email;
  select id into sriati from public.employees
   where org_id = org and lower(work_email) = sriati_email;

  if kartini is null or sriati is null then
    raise exception 'the two housekeepers are not in the employee list'
      using hint = 'Run seed_people.sql first.';
  end if;

  select id into hk_dept from public.departments
   where org_id = org and lower(name) like '%housekeep%' limit 1;

  -- ── The floors ──────────────────────────────────────────────────────────
  /*
   * Twenty-four rooms over three floors: twelve standard, six double, four
   * suites and two villas. Small enough to read, large enough that the report
   * listing only the rooms with something to say is doing real work.
   */
  insert into public.rooms (org_id, location_id, room_type_id, room_number,
                            floor, state, occupancy, out_of_service_reason)
  select org, l.id, rt.id, x.number, x.floor,
         x.state::public.housekeeping_state,
         x.occ::public.room_occupancy,
         x.reason
    from (values
      ('101','1','STD','CLEAN','VACANT',null), ('102','1','STD','CLEAN','OCCUPIED',null),
      ('103','1','STD','DIRTY','DEPARTURE',null), ('104','1','STD','CLEAN','OCCUPIED',null),
      ('105','1','STD','INSPECTED','ARRIVAL',null), ('106','1','STD','CLEAN','VACANT',null),
      ('107','1','DBL','CLEAN','OCCUPIED',null), ('108','1','DBL','DIRTY','DEPARTURE',null),
      ('201','2','STD','CLEAN','OCCUPIED',null), ('202','2','STD','INSPECTED','VACANT',null),
      ('203','2','STD','CLEAN','STAYOVER',null), ('204','2','STD','DIRTY','DEPARTURE',null),
      ('205','2','STD','CLEAN','OCCUPIED',null), ('206','2','STD','CLEAN','VACANT',null),
      ('207','2','DBL','CLEAN','OCCUPIED',null), ('208','2','DBL','IN_PROGRESS','DEPARTURE',null),
      ('301','3','DBL','CLEAN','OCCUPIED',null), ('302','3','DBL','CLEAN','VACANT',null),
      ('303','3','SUITE','CLEAN','OCCUPIED',null), ('304','3','SUITE','INSPECTED','ARRIVAL',null),
      ('305','3','SUITE','DIRTY','DEPARTURE',null),
      ('306','3','SUITE','OUT_OF_SERVICE','VACANT','Air conditioning failed; parts on order'),
      ('401','4','VILLA','CLEAN','OCCUPIED',null),
      ('402','4','VILLA','OUT_OF_SERVICE','VACANT','Water ingress after the storm; drying out')
    ) as x(number, floor, type, state, occ, reason)
    join public.room_types rt on rt.org_id = org and rt.code = x.type
    join public.locations l on l.org_id = org and l.code = 'RM-' || x.number;

  get diagnostics n_rooms = row_count;

  /*
   * One room has been sitting dirty since long before the period.
   *
   * `state_changed_at` defaults to now(), so without this every room reads as
   * having changed state today and the "dirty for n days" concern could never
   * fire on any of them. 305 is a departure suite nobody has gone near.
   */
  update public.rooms
     set state_changed_at = now() - interval '9 days'
   where org_id = org and room_number = '305';

  -- ── Enough rota to be allowed to assign the work ────────────────────────
  /*
   * PUBLISHED, because 0056 looks for exactly that. DRAFT shifts are a plan
   * and the rule is deliberately about what was actually published — a sheet
   * of work against an unpublished rota is work nobody has been told about.
   */
  for i in 0..27 loop
    d := current_date - i;
    insert into public.shifts
      (org_id, employee_id, department_id, starts_at, ends_at,
       break_minutes, status, notes, created_by_email, published_at)
    select org, e.id, hk_dept,
           (d::timestamp + interval '8 hours') at time zone 'UTC',
           (d::timestamp + interval '16 hours') at time zone 'UTC',
           30, 'PUBLISHED', 'Housekeeping demo', 'gm@venue.test', now()
      from (values (kartini), (sriati)) as e(id);
    n_shifts := n_shifts + 2;
  end loop;

  -- ── Four weeks of sheets ────────────────────────────────────────────────
  for i in 0..27 loop
    d := current_date - i;

    /*
     * The two housekeepers alternate days, so a room worked over four weeks
     * has been touched by both and the `attendants` count means something.
     * The inspector is always the other one — 0056 refuses an inspection by
     * the person who cleaned, and that refusal is worth demonstrating rather
     * than designing around.
     */
    if i % 2 = 0 then
      who := kartini; who_email := kartini_email; other_email := sriati_email;
    else
      who := sriati;  who_email := sriati_email;  other_email := kartini_email;
    end if;

    for r in
      /*
       * `seed` is a stable per-room number from the room's own digits.
       *
       * The first version used `length(room_number)`, which is 3 for all
       * twenty-four of them — so every room took the same branch on every
       * day and the report showed two dozen identical lines. The same
       * mistake as the maintenance seed's stride, arriving from a different
       * direction: a modulus only varies if the thing being divided does.
       */
      select rm.id, rm.room_number, rt.code as type,
             ('x' || substr(md5(rm.room_number), 1, 8))::bit(31)::int as seed
        from public.rooms rm
        left join public.room_types rt on rt.id = rm.room_type_id
       where rm.org_id = org
         and rm.state <> 'OUT_OF_SERVICE'
         -- A third of the floor each day, which is what a real sheet is.
         and ((('x' || substr(md5(rm.room_number), 1, 8))::bit(31)::int) + i) % 3 = 0
       order by rm.room_number
    loop
      /*
       * The time allowed comes from the room type, and 402 — the villa — is
       * deliberately given work that overruns it, so the "took n% longer"
       * concern has a room to fire on rather than being unreachable code.
       */
      st := case ((i * 7 + r.seed) % 11)
              when 0 then 'PENDING'
              when 1 then 'IN_PROGRESS'
              when 2 then 'DONE'       -- cleaned, nobody inspected it
              else 'DONE'              -- inspected below
            end;

      insert into public.housekeeping_tasks
        (org_id, room_id, kind, task_date, assigned_to, assigned_at,
         standard_minutes, status, started_at, finished_at, actual_minutes)
      values (
        org, r.id,
        (case (i % 5)
           when 0 then 'DEPARTURE' when 1 then 'STAYOVER'
           when 2 then 'TURNDOWN'  when 3 then 'DEPARTURE'
           else 'DEEP_CLEAN' end)::public.housekeeping_task_kind,
        d, who,
        (d::timestamp + interval '8 hours') at time zone 'UTC',
        case r.type when 'VILLA' then 90 when 'SUITE' then 60
                    when 'DBL' then 40 else 30 end,
        st::public.housekeeping_task_status,
        case when st <> 'PENDING'
             then (d::timestamp + interval '9 hours') at time zone 'UTC' end,
        case when st = 'DONE'
             then (d::timestamp + interval '10 hours') at time zone 'UTC' end,
        case when st = 'DONE' then
          (case r.type when 'VILLA' then 90 when 'SUITE' then 60
                       when 'DBL' then 40 else 30 end)
          -- 303 and 401 consistently overrun; everything else lands near.
          + case when r.room_number in ('303', '401') then 25
                 else (i % 7) - 3 end
        end
      )
      returning id into task_id;
      n_tasks := n_tasks + 1;

      /*
       * Everything cleaned gets inspected except one in nine, which is left
       * in DONE. That is the "nobody has inspected it" line, and it is the
       * only thing in housekeeping that goes quietly wrong.
       */
      if st = 'DONE' and ((i * 7 + r.seed) % 11) <> 2 then
        insert into public.housekeeping_inspections
          (org_id, task_id, inspector_email, passed, score, findings, inspected_at)
        values (
          org, task_id, other_email,
          -- One in seven fails, and 305 and 208 rather more often.
          not (((i * 3 + r.seed) % 7) = 0
               or (r.room_number in ('305', '208') and i % 3 = 0)),
          case when ((i * 3 + r.seed) % 7) = 0 then 62 else 90 + (i % 9) end,
          case when ((i * 3 + r.seed) % 7) = 0
                 or (r.room_number in ('305', '208') and i % 3 = 0)
               then 'Bathroom glass marked and the bin not emptied.' end,
          (d::timestamp + interval '11 hours') at time zone 'UTC'
        );
        n_insp := n_insp + 1;
        if ((i * 3 + r.seed) % 7) = 0
           or (r.room_number in ('305', '208') and i % 3 = 0) then
          n_failed := n_failed + 1;
        end if;
      end if;
    end loop;

    -- Public areas and the linen room: real work, against no room at all.
    if i % 3 = 0 then
      insert into public.housekeeping_tasks
        (org_id, location_id, kind, task_date, assigned_to, assigned_at,
         standard_minutes, status, started_at, finished_at, actual_minutes)
      values (
        org, loc_pub,
        (case when i % 6 = 0 then 'PUBLIC_AREA' else 'LINEN' end)::public.housekeeping_task_kind,
        d, who,
        (d::timestamp + interval '8 hours') at time zone 'UTC',
        45,
        (case when i % 9 = 3 then 'IN_PROGRESS' else 'DONE' end)::public.housekeeping_task_status,
        (d::timestamp + interval '14 hours') at time zone 'UTC',
        case when i % 9 <> 3
             then (d::timestamp + interval '15 hours') at time zone 'UTC' end,
        case when i % 9 <> 3 then 45 + (i % 5) end
      );
      n_tasks := n_tasks + 1;
    end if;
  end loop;

  /*
   * State ages, applied last and for a reason.
   *
   * `state_changed_at` is rewritten by 0056's trigger every time an
   * inspection lands, so anything set before the loop is overwritten by it.
   * The first version backdated room 305 at the top and the trigger quietly
   * put it back to today, which made every "for n days" figure read nought
   * and the concerns that use them unreachable.
   *
   * 306 and 402 have been out for weeks — that is the point of them; a room
   * out for two days is maintenance and a room out for five weeks is revenue
   * nobody has escalated. 208 is the room that keeps failing inspection, and
   * it has been sitting dirty since the last one sent it back.
   */
  update public.rooms set state_changed_at = now() - interval '34 days'
   where org_id = org and room_number = '306';
  update public.rooms set state_changed_at = now() - interval '11 days'
   where org_id = org and room_number = '402';
  update public.rooms set state_changed_at = now() - interval '3 days'
   where org_id = org and room_number = '208' and state = 'DIRTY';

  raise notice 'Housekeeping: % rooms, % published shifts, % tasks',
    n_rooms, n_shifts, n_tasks;
  raise notice 'Housekeeping: % inspections, of which % failed; % cleans nobody inspected',
    n_insp, n_failed,
    (select count(*) from public.housekeeping_tasks
      where org_id = org and status = 'DONE');
end $$;
