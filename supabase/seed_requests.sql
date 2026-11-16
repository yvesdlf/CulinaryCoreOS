-- ---------------------------------------------------------------------------
-- The front door: what came through it, and who answered
-- ---------------------------------------------------------------------------
-- 0066 built one front door for the venue and five request types have existed
-- since the venue was created. Not one request has ever been raised, so the
-- Requests screen, the chaser in 0068 and `requests_report` (0134) have all
-- been looking at an empty table.
--
-- ── `respond_by` has to be corrected afterwards, and that is not optional ─
--
-- 0067 sets `respond_by` from **`now()`** when the request is inserted, not
-- from `created_at`. That is right for a real request, which is raised at the
-- moment it is inserted. It is wrong for seeded history: every request
-- backdated two months would be given a promise expiring tomorrow, so nothing
-- would ever be late, the chaser would have nothing to chase and the report's
-- whole purpose would be invisible.
--
-- So the promise is rewritten from the raised date once the rows exist. The
-- alternative — inserting at the right `respond_by` — is not available: the
-- trigger overwrites whatever is supplied.
--
-- ── A type that promises nothing ──────────────────────────────────────────
--
-- All five existing types carry `respond_within_hours`, so the concern for a
-- type that promises no answer by any time was unreachable. This adds a sixth
-- — "Something else", with no promise — because that is what actually happens
-- to a request system: somebody adds a catch-all and never sets its target,
-- and every request raised against it is quietly immune to being late and
-- cannot be chased at all.
--
-- ── What it has to contain ────────────────────────────────────────────────
--
--   requests still waiting past the time somebody promised,
--   requests answered, but after the promise had passed,
--   requests nobody has acknowledged at all,
--   a request open far longer than the rest,
--   rejections, which 0066 refuses without a reason,
--   requests that became work orders,
--   and the catch-all type nothing can be late against.
--
-- Against a majority answered inside the promise, or the exceptions stop
-- reading as exceptions.
--
-- Deterministic, not random. Safe to run more than once.
-- ---------------------------------------------------------------------------

do $$
declare
  org uuid;
  i integer;
  raised_when timestamptz;
  t record;
  types uuid[];
  type_hours integer[];
  n_types integer;
  pick integer;
  st text;
  ack timestamptz;
  res timestamptz;
  wo uuid;
  n_req integer := 0;
  raisers text[] := array['chef@venue.test', 'sous@venue.test', 'putu@venue.test',
                          'made@venue.test', 'kartini@venue.test', 'barmgr@venue.test'];
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

  delete from public.request_events
   where request_id in (select id from public.requests where org_id = org);
  delete from public.requests where org_id = org;
  delete from public.request_types where org_id = org and code = 'OTHER';

  /*
   * The catch-all with no promise on it. See the header: this is the
   * configuration gap the report exists to name, and without it the concern
   * for it is code nothing can reach.
   */
  insert into public.request_types
    (org_id, code, name, description, to_unit_id, default_priority,
     respond_within_hours, active)
  select org, 'OTHER', 'Something else',
         'Anything that does not fit the other kinds.',
         u.id, 'NORMAL', null, true
    from public.business_units u
   where u.org_id = org and u.code = 'ADMIN';

  select array_agg(id order by code), array_agg(respond_within_hours order by code)
    into types, type_hours
    from public.request_types where org_id = org and active;
  n_types := coalesce(array_length(types, 1), 0);

  if n_types = 0 then
    raise exception 'the venue has no kinds of request to raise'
      using hint = 'Run seed.sql first.';
  end if;

  -- One work order to point a converted request at, if there is one.
  select id into wo from public.work_orders
   where org_id = org order by raised_at desc limit 1;

  for i in 0..79 loop
    -- Sixty days, a few a day, at plausible hours of the afternoon.
    raised_when := ((current_date - (i * 3) / 4)::timestamp
                  + interval '11 hours' + (i % 7) * interval '47 minutes')
                 at time zone 'UTC';

    /*
     * The kind, from a hash of the index rather than a multiple of it.
     *
     * `1 + (i * 5) % 6` against a status cycle of `i % 12` is not
     * independent: 12 is a multiple of 6, so every twelfth request lands on
     * the same kind, and *every rejection in the whole seed* went to "A
     * guest is unhappy" — seven of its thirteen requests rejected, and none
     * anywhere else. The third time this session that a modulus has quietly
     * correlated with the thing it was supposed to vary against.
     */
    pick := 1 + (('x' || substr(md5(i::text), 1, 8))::bit(31)::int) % n_types;

    /*
     * The status mix. Two thirds closed out, because a venue whose front
     * door is entirely unanswered is not one anybody would recognise — and
     * the exceptions only read as exceptions against a majority that worked.
     */
    st := case (i % 12)
            when 0 then 'NEW'
            when 1 then 'ACKNOWLEDGED'
            when 2 then 'IN_PROGRESS'
            when 3 then 'BLOCKED'
            when 4 then 'REJECTED'
            else        'RESOLVED'
          end;

    /*
     * When somebody picked it up. One in five of the answered ones was
     * answered after the promise had passed — history, and the figure a
     * meeting argues about.
     */
    ack := case when st <> 'NEW'
                then raised_when + (case when i % 5 = 2
                                       then interval '1 hour' * (coalesce(type_hours[pick], 12) + 6)
                                       else interval '1 hour' * (1 + i % 3) end)
           end;
    res := case when st in ('RESOLVED', 'REJECTED')
                then ack + interval '1 hour' * (2 + i % 20) end;

    insert into public.requests
      (org_id, request_type_id, raised_by_email, title, detail, priority,
       status, acknowledged_at, resolved_at, closed_at, resolution,
       converted_type, converted_id, created_at)
    values (
      org, types[pick], raisers[1 + (i % array_length(raisers, 1))],
      case (i % 6)
        when 0 then 'Chiller reading high in the back kitchen'
        when 1 then 'Guest in 204 unhappy about the noise'
        when 2 then 'Out of oat milk on the bar'
        when 3 then 'Public toilet needs attention'
        when 4 then 'Short on the late shift tomorrow'
        else        'Light out over the pass'
      end,
      'Raised from the floor.',
      (case when i % 11 = 0 then 'HIGH' else 'NORMAL' end)::public.work_order_priority,
      st::public.request_status,
      ack, res,
      case when st in ('RESOLVED', 'REJECTED') then res end,
      -- 0066 refuses a rejection with no reason, and rightly.
      case when st = 'REJECTED' then 'Already raised by somebody else on the same day.'
           when st = 'RESOLVED' then 'Dealt with on the shift.' end,
      -- One in nine became a work order, where the type says it can.
      case when wo is not null and i % 9 = 5 then 'WORK_ORDER' end,
      case when wo is not null and i % 9 = 5 then wo end,
      raised_when
    );
    n_req := n_req + 1;
  end loop;

  /*
   * One request left open far longer than the rest, so "something has been
   * open n days" has something to fire on.
   */
  insert into public.requests
    (org_id, request_type_id, raised_by_email, title, detail, status, created_at)
  select org, t2.id, 'ketut@venue.test',
         'Store room door still sticking', 'Mentioned a few times now.',
         'NEW',
         ((current_date - 51)::timestamp + interval '10 hours') at time zone 'UTC'
    from public.request_types t2
   where t2.org_id = org and t2.code = 'FAULT';
  n_req := n_req + 1;

  /*
   * And the promise, rewritten from the raised date.
   *
   * See the header. Without this every backdated request carries a promise
   * expiring tomorrow: nothing is ever late, the chaser has nothing to chase
   * and the report shows a venue answering its front door perfectly.
   */
  update public.requests q
     set respond_by = q.created_at
                    + make_interval(hours => t3.respond_within_hours)
    from public.request_types t3
   where t3.id = q.request_type_id
     and q.org_id = org
     and t3.respond_within_hours is not null;

  update public.requests q
     set respond_by = null
    from public.request_types t4
   where t4.id = q.request_type_id
     and q.org_id = org
     and t4.respond_within_hours is null;

  raise notice 'Requests: % raised across % kinds', n_req, n_types;
  raise notice 'Requests: % still open, % of those past the promise, % never acknowledged',
    (select count(*) from public.requests
      where org_id = org and status not in ('RESOLVED','CLOSED','REJECTED')),
    (select count(*) from public.requests
      where org_id = org and status not in ('RESOLVED','CLOSED','REJECTED')
        and acknowledged_at is null and respond_by is not null and respond_by < now()),
    (select count(*) from public.requests
      where org_id = org and status not in ('RESOLVED','CLOSED','REJECTED')
        and acknowledged_at is null);
end $$;
