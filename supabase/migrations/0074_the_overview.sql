-- ---------------------------------------------------------------------------
-- One screen, showing what you are responsible for
-- ---------------------------------------------------------------------------
-- Gap 33: "an owner, a finance manager and a head chef all get the same
-- food-cost page." And Part C's last open bullet: "a tile on the overview
-- screen."
--
-- Both are the same thing, and the mistake to avoid is building three
-- dashboards. A role-aware screen made of three hand-written layouts is three
-- screens that drift, and the fourth role — the one the venue invents next —
-- gets whichever of the three somebody guesses at.
--
-- ## One row per department, and the grid decides what is on it
--
-- `unit_overview` is a line per department with every figure this platform can
-- produce about it. What a given person *sees* is decided by the access grid
-- they already have: the labour and profit columns come back null unless they
-- hold Pay, the revenue columns unless they hold Revenue, and so on. So the
-- owner sees everything, the head chef sees the kitchen's work and none of its
-- wages, and the finance manager sees money across every department and no
-- rotas — out of one view and one set of grants, with nothing role-shaped
-- written anywhere.
--
-- That is the same argument as Part C made about departments: the thing that
-- varies is data, not code. A venue that invents a Night Manager grants them
-- what a night manager needs and the screen is already right.
--
-- ## Null means "not yours to see", and the screen must say which
--
-- The cost of this design is that a null column is ambiguous: nothing happened,
-- or you may not look. The view answers it — `may_see_money` and
-- `may_see_pay` are columns, so a screen can say "hidden" rather than drawing
-- a zero. A dashboard that renders an inaccessible figure as 0 is worse than
-- one that renders nothing, because somebody will act on the zero.
--
-- ## It is today, and the word "today" is doing work
--
-- Every figure is for the current day except the ones that are meaningless
-- daily — an overdue request does not reset at midnight, and neither does a
-- piece of paperwork nobody has done. Those are carried as counts of what is
-- outstanding now, which is what somebody arriving at eight in the morning
-- wants to know.
-- ---------------------------------------------------------------------------

create or replace view unit_overview with (security_invoker = true) as
  select
    b.org_id,
    b.id as business_unit_id,
    b.code as unit_code,
    b.name as unit_name,
    b.parent_id,
    current_date as on_date,

    /*
     * What the caller is allowed to be shown, as data rather than as an
     * absence. Without these a screen cannot tell "nothing happened" from "not
     * yours", and would draw a zero for both.
     */
    public.can_read_section('REVENUE', b.org_id, b.id) as may_see_money,
    public.can_read_section('PAY', b.org_id, null::uuid) as may_see_pay,

    -- Money, today. Null without Revenue; the view below it does the hiding.
    (select sum(t.gross_amount) from public.daily_takings t
      where t.business_unit_id = b.id and t.on_date = current_date
        and public.can_read_section('REVENUE', b.org_id, b.id)) as revenue_today,
    (select sum(t.covers) from public.daily_takings t
      where t.business_unit_id = b.id and t.on_date = current_date
        and public.can_read_section('REVENUE', b.org_id, b.id)) as covers_today,

    -- Profit, today. Already refuses to answer without Pay; see 0073.
    (select p.gross_profit from public.unit_profit_daily p
      where p.business_unit_id = b.id and p.on_date = current_date) as profit_today,
    (select p.labour_cost from public.unit_profit_daily p
      where p.business_unit_id = b.id and p.on_date = current_date) as labour_today,

    -- Work waiting on this department, which does not reset at midnight.
    (select l.unanswered_count from public.request_load l
      where l.business_unit_id = b.id) as requests_unanswered,
    (select l.overdue_count from public.request_load l
      where l.business_unit_id = b.id) as requests_overdue,

    -- Paperwork. A breach nobody was told about is the finding, not the count.
    (select count(*) from public.hygiene_by_unit h
      where h.business_unit_id = b.id
        and h.breaches_nobody_was_told_about > 0) as hygiene_breaches_untold,

    -- People on today, which is the figure a manager checks first.
    (select count(*) from public.shifts s
      where s.business_unit_id = b.id
        and (s.starts_at at time zone 'UTC')::date = current_date
        and s.status = 'PUBLISHED') as shifts_today,

    -- Whether the last shift told the next one anything.
    (select h.status::text from public.handovers h
      where h.business_unit_id = b.id
      order by h.on_date desc, h.published_at desc nulls last
      limit 1) as last_handover_status,
    (select h.on_date from public.handovers h
      where h.business_unit_id = b.id
      order by h.on_date desc, h.published_at desc nulls last
      limit 1) as last_handover_on,

    -- Jobs, for a department that owns places and equipment.
    (select count(*) from public.work_orders w
      where w.business_unit_id = b.id
        and w.status not in ('VERIFIED', 'CANCELLED')) as jobs_open,
    (select count(*) from public.work_orders w
      where w.business_unit_id = b.id
        and w.priority = 'EMERGENCY'
        and w.status not in ('VERIFIED', 'CANCELLED')) as jobs_emergency

  from public.business_units b
  where b.active
    and b.org_id in (select public.auth_org_ids());

grant select on unit_overview to authenticated;

/*
 * One line for the whole venue, for whoever is responsible for all of it.
 *
 * Not a sum of the tiles. A sum would be wrong wherever a figure is hidden
 * from the caller — the owner's total and the head chef's total would differ,
 * and the difference would look like a discrepancy rather than a permission.
 * This asks the same questions once, at venue level, and the grid answers the
 * same way it does for a tile.
 */
create or replace view venue_overview with (security_invoker = true) as
  select
    o.id as org_id,
    o.name as venue_name,
    current_date as on_date,
    public.can_read_section('REVENUE', o.id, null::uuid) as may_see_money,
    public.can_read_section('PAY', o.id, null::uuid) as may_see_pay,
    (select sum(t.gross_amount) from public.daily_takings t
      where t.org_id = o.id and t.on_date = current_date
        and public.can_read_section('REVENUE', o.id, null::uuid)) as revenue_today,
    (select sum(p.gross_profit) from public.unit_profit_daily p
      where p.org_id = o.id and p.on_date = current_date) as profit_today,
    (select count(*) from public.requests r
      where r.org_id = o.id and r.status = 'NEW') as requests_unanswered,
    (select count(*) from public.requests r
      where r.org_id = o.id and r.status = 'NEW'
        and r.respond_by is not null and now() > r.respond_by) as requests_overdue,
    (select count(*) from public.work_orders w
      where w.org_id = o.id and w.priority = 'EMERGENCY'
        and w.status not in ('VERIFIED', 'CANCELLED')) as jobs_emergency,
    (select count(*) from public.handovers h
      where h.org_id = o.id and h.status = 'PUBLISHED'
        and h.acknowledged_at is null) as handovers_unread,
    /*
     * The one figure that is about the platform rather than the venue. A queue
     * that is not draining means nobody is being told anything, and every other
     * number on this screen assumes somebody was.
     */
    (select count(*) from public.message_deliveries d
      where d.org_id = o.id and d.status = 'PENDING') as messages_waiting
  from public.organizations o
  where o.id in (select public.auth_org_ids());

grant select on venue_overview to authenticated;

comment on view unit_overview is
  'One line per department, with every figure this platform can produce about it. What a caller sees is decided by their grants, not by a role written in code.';
comment on view venue_overview is
  'The venue in one line. Asked at venue level rather than summed from the tiles, so a hidden figure is not mistaken for a discrepancy.';
