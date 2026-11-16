-- ---------------------------------------------------------------------------
-- What broke, and what was never checked
-- ---------------------------------------------------------------------------
-- The second of the six sections that had no report. 0055 gave the venue a
-- small CMMS — assets, work orders, an event log, and planned maintenance on
-- an interval — and two views over it: `maintenance_due`, which lists the
-- schedules that have come round, and `asset_health`, a rolling twelve months
-- per asset. Neither is a period report, and neither is reachable from a
-- screen.
--
-- ── Why the row is an asset ───────────────────────────────────────────────
--
-- A work order list is the raw record and the Maintenance screen already has
-- it. The thing a list cannot show is the pattern: the walk-in fixed four
-- times this month is four unremarkable rows and one serious line. So the
-- grain is the asset, the way production's was the service.
--
-- Work with no asset against it — a leak in a corridor, a door that sticks —
-- is kept under a null asset rather than dropped. It is usually the fabric of
-- the building, and a venue whose maintenance is mostly building fabric is
-- worth knowing about.
--
-- ── Two kinds of number in one row, said out loud ─────────────────────────
--
-- `raised` and `completed` are of the period. `still_open`, `overdue` and the
-- plan columns are as of today, because an open job is open now and a
-- statutory check that came round in August is not resolved by the period
-- ending in November.
--
-- Mixing them is a real hazard and the honest fix is to label rather than to
-- pick one: a report that showed only period figures would close the month
-- with eleven overdue statutory checks invisible, and one that showed only
-- today's state could not be compared to last month. The column names say
-- which is which and `maintenanceCaveats` says it again in words, on screen
-- and in every exported file.
--
-- ── A work order is in the period if it was raised or finished in it ──────
--
-- Not raised only. A job opened in March and closed in November is November's
-- work, and a maintenance manager asking "what did we deal with" means both.
-- The two columns are each counted on their own date, so neither inherits the
-- other's definition.
--
-- ── The due date is not derived twice ─────────────────────────────────────
--
-- `last_completed_on + interval_days`, falling back to "due now" when the
-- plan has never been done, is `maintenance_due`'s formula from 0055 and is
-- repeated here deliberately rather than improved. Two derivations of when a
-- statutory check is due is how a venue ends up with a screen and a report
-- that disagree about whether it is in breach.
--
-- ── Who may read it ───────────────────────────────────────────────────────
--
-- Invoker rights, like `production_report`. `assets`, `work_orders` and
-- `maintenance_plans` are all gated on Maintenance, so a reader without it
-- gets nothing — the honest answer. `maintenance_due` and `asset_health` are
-- not used here for the same reason `production_records_effective` was not:
-- they filter on organisation membership alone, which would hand the venue's
-- maintenance record to anyone with a login.
--
-- ── And one venue, the one the reader is working in ───────────────────────
--
-- Row-level security answers "may I see this", not "is this mine". A reader
-- who belongs to two venues may read both, so without an explicit scope this
-- would merge two plant registers into one agenda and add their downtime
-- together. Every one of those rows would be permitted, which is why no
-- access test would catch it. `auth_default_org_id()` is the venue the
-- reader has switched to, and 0129 and 0130 scope the same way.
-- ---------------------------------------------------------------------------

create or replace function public.maintenance_report(
  p_from date,
  p_to date
)
returns table (
  asset_id uuid,
  asset_code text,
  asset_name text,
  category text,
  criticality text,
  asset_status text,
  location_name text,
  raised integer,
  completed integer,
  still_open integer,
  overdue integer,
  emergencies integer,
  reactive integer,
  planned integer,
  downtime_minutes integer,
  labour_minutes integer,
  avg_days_to_complete numeric,
  oldest_open_days integer,
  completed_not_verified integer,
  plans_active integer,
  plans_overdue integer,
  statutory_overdue integer,
  concerns text[]
)
language plpgsql
stable
set search_path = ''
as $$
declare
  org uuid := public.auth_default_org_id();
begin
  if p_from is null or p_to is null then
    raise exception 'a maintenance report needs a period'
      using hint = 'Both dates are required: the sheet is filed against them.';
  end if;
  if p_to < p_from then
    raise exception 'the period ends before it begins';
  end if;

  return query
  with relevant as (
    select w.asset_id,
           w.priority,
           w.source,
           w.status,
           w.due_by,
           w.downtime_minutes,
           w.labour_minutes,
           (w.raised_at    at time zone 'UTC')::date as raised_on,
           (w.completed_at at time zone 'UTC')::date as completed_on,
           (w.status not in ('COMPLETED', 'VERIFIED', 'CANCELLED')) as is_open
      from public.work_orders w
     where w.org_id = org
       and ((w.raised_at at time zone 'UTC')::date between p_from and p_to
        or (w.completed_at at time zone 'UTC')::date between p_from and p_to
        -- Still open, whatever its age. A job raised in March and still open
        -- in November belongs on November's agenda more than on March's.
        or w.status not in ('COMPLETED', 'VERIFIED', 'CANCELLED'))
  ),
  per_asset as (
    select
      r.asset_id,
      count(*) filter (where r.raised_on between p_from and p_to)::integer
        as raised,
      count(*) filter (where r.completed_on between p_from and p_to)::integer
        as completed,
      count(*) filter (where r.is_open)::integer as still_open,
      count(*) filter (where r.is_open
                         and r.due_by is not null
                         and r.due_by < current_date)::integer as overdue,
      count(*) filter (where r.priority = 'EMERGENCY'
                         and r.raised_on between p_from and p_to)::integer
        as emergencies,
      count(*) filter (where r.source = 'REACTIVE'
                         and r.raised_on between p_from and p_to)::integer
        as reactive,
      count(*) filter (where r.source = 'PLANNED'
                         and r.raised_on between p_from and p_to)::integer
        as planned,
      /*
       * Downtime and labour are counted on completion, not on raising. An
       * open job's downtime is still accruing and is not a figure yet; adding
       * a half-finished one to the month's total would understate it and
       * nothing would ever correct it.
       */
      coalesce(sum(r.downtime_minutes)
               filter (where r.completed_on between p_from and p_to), 0)::integer
        as downtime,
      coalesce(sum(r.labour_minutes)
               filter (where r.completed_on between p_from and p_to), 0)::integer
        as labour,
      round(avg(r.completed_on - r.raised_on)
            filter (where r.completed_on between p_from and p_to), 1)
        as avg_days,
      max(current_date - r.raised_on) filter (where r.is_open)::integer
        as oldest_open,
      /*
       * COMPLETED and not VERIFIED: the work is done and nobody has checked
       * it. 0055 made verification a separate status for exactly this reason,
       * and a status nobody ever reaches is a control that does not exist.
       */
      count(*) filter (where r.status = 'COMPLETED'
                         and r.completed_on between p_from and p_to)::integer
        as not_verified
      from relevant r
     group by r.asset_id
  ),
  plan_state as (
    select
      p.asset_id,
      count(*)::integer as active,
      count(*) filter (
        where (coalesce(p.last_completed_on, current_date - p.interval_days)
               + p.interval_days) < current_date)::integer as overdue,
      count(*) filter (
        where p.statutory
          and (coalesce(p.last_completed_on, current_date - p.interval_days)
               + p.interval_days) < current_date)::integer as statutory_overdue
      from public.maintenance_plans p
     where p.org_id = org and p.active and p.asset_id is not null
     group by p.asset_id
  ),
  /*
   * Which assets are on the agenda.
   *
   * Not every asset. A chiller with no jobs, nothing overdue and in service
   * is not a line at a meeting, and listing four hundred of them would bury
   * the eleven that are. An absent asset therefore means "nothing to say",
   * not "no such asset" — which `maintenanceCaveats` states, because the two
   * are indistinguishable on the page otherwise.
   */
  subject as (
    select a.id, a.code, a.name, a.category,
           a.criticality::text as criticality,
           a.status::text as asset_status,
           l.name as location_name
      from public.assets a
      left join public.locations l on l.id = a.location_id
     where a.org_id = org
       and a.status <> 'DISPOSED'
       and (exists (select 1 from per_asset  x  where x.asset_id = a.id)
         or exists (select 1 from plan_state pl where pl.asset_id = a.id
                                                  and pl.overdue > 0)
         or a.status <> 'IN_SERVICE')
  )
  select
    s.id, s.code, s.name, s.category, s.criticality, s.asset_status,
    s.location_name,
    coalesce(pa.raised, 0),
    coalesce(pa.completed, 0),
    coalesce(pa.still_open, 0),
    coalesce(pa.overdue, 0),
    coalesce(pa.emergencies, 0),
    coalesce(pa.reactive, 0),
    coalesce(pa.planned, 0),
    coalesce(pa.downtime, 0),
    coalesce(pa.labour, 0),
    pa.avg_days,
    pa.oldest_open,
    coalesce(pa.not_verified, 0),
    coalesce(pl.active, 0),
    coalesce(pl.overdue, 0),
    coalesce(pl.statutory_overdue, 0),
    array_remove(array[
      case when coalesce(pl.statutory_overdue, 0) > 0
           then pl.statutory_overdue || ' statutory check' ||
                case when pl.statutory_overdue = 1 then ' is' else 's are' end ||
                ' overdue' end,
      case when coalesce(pl.overdue, 0) - coalesce(pl.statutory_overdue, 0) > 0
           then (pl.overdue - pl.statutory_overdue) || ' planned check' ||
                case when pl.overdue - pl.statutory_overdue = 1
                     then ' is' else 's are' end || ' overdue' end,
      case when s.asset_status = 'OUT_OF_SERVICE' then 'out of service' end,
      case when s.asset_status = 'DEGRADED' then 'running degraded' end,
      case when coalesce(pa.overdue, 0) > 0
           then pa.overdue || ' work order' ||
                case when pa.overdue = 1
                     then ' is past its due date'
                     else 's are past their due date' end end,
      case when coalesce(pa.not_verified, 0) > 0
           then pa.not_verified || ' completed and never verified' end,
      case when coalesce(pa.emergencies, 0) > 0
           then pa.emergencies || ' raised as an emergency' end,
      case when coalesce(pa.oldest_open, 0) >= 30
           then 'something has been open ' || pa.oldest_open || ' days' end,
      /*
       * The programme exists on paper and not in practice. Only said where
       * there is a plan to fail: an asset with no schedule is not failing to
       * follow one.
       */
      case when coalesce(pl.active, 0) > 0
            and coalesce(pa.planned, 0) = 0
            and coalesce(pa.reactive, 0) > 0
           then 'it has a maintenance plan, and every job this period was reactive' end
    ], null)
    from subject s
    left join per_asset  pa on pa.asset_id = s.id
    left join plan_state pl on pl.asset_id = s.id

  union all

  -- Work against no asset: the building itself, usually.
  select
    null, null, null, null, null, null, null,
    pa.raised, pa.completed, pa.still_open, pa.overdue, pa.emergencies,
    pa.reactive, pa.planned, pa.downtime, pa.labour, pa.avg_days,
    pa.oldest_open, pa.not_verified,
    0, 0, 0,
    array_remove(array[
      'raised against no asset',
      case when pa.overdue > 0
           then pa.overdue || ' work order' ||
                case when pa.overdue = 1
                     then ' is past its due date'
                     else 's are past their due date' end end,
      case when pa.not_verified > 0
           then pa.not_verified || ' completed and never verified' end,
      case when pa.emergencies > 0
           then pa.emergencies || ' raised as an emergency' end,
      case when coalesce(pa.oldest_open, 0) >= 30
           then 'something has been open ' || pa.oldest_open || ' days' end
    ], null)
    from per_asset pa
   where pa.asset_id is null

  -- Statutory first, then the rest by how much is open: the order a meeting
  -- would take them in.
  order by 22 desc, 21 desc, 10 desc, 3 nulls last;
end $$;

comment on function public.maintenance_report(date, date) is
  'One row per asset with work or a problem in the period, plus a row for '
  'work against no asset. Raised and completed are of the period; open, '
  'overdue and the plan columns are as of today. Reads as the caller; '
  'Maintenance access is required for any of it.';

revoke all on function public.maintenance_report(date, date) from anon;
grant execute on function public.maintenance_report(date, date) to authenticated;
