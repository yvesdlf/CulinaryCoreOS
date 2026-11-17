-- ---------------------------------------------------------------------------
-- The front door, and how long it took anybody to answer it
-- ---------------------------------------------------------------------------
-- Fifth of the six. 0066 gave the venue one front door: a request is raised
-- against a type, the type routes it to a department and sets how long
-- somebody has to answer, and 0068 chases the ones nobody does. Five types
-- have existed since the venue was created and not one request has ever been
-- raised, so none of it has ever been looked at.
--
-- ── Who can read it: everybody ────────────────────────────────────────────
--
-- Worth saying out loud because it is the opposite of the report before it.
-- `requests_read` is `org_id in auth_org_ids()` and nothing else — no
-- section, no unit. Every member of the venue can read every request, which
-- is what "one front door" means: a request nobody outside the receiving
-- department can see is a request that quietly becomes that department's
-- problem to admit to.
--
-- So this report is the same for everybody, and carries no `reader_sees_all`
-- flag because there is nothing for it to say. The venue scope is still
-- explicit, for a reader who belongs to two.
--
-- ── Why the row is a request type ─────────────────────────────────────────
--
-- Not a request: the Requests screen is the list, and a weekly meeting is
-- not held about individual requests. Not a department either, although that
-- was the obvious choice — because the **promise lives on the type**
-- (`respond_within_hours`), and a department that receives "Something is
-- broken" within four hours and "We have run out" within twenty-four has no
-- single figure for whether it answered in time. Aggregating to the
-- department would average two different promises into a number that means
-- nothing.
--
-- The receiving department is carried on the row instead, so a head of
-- department can find their own lines without the arithmetic being done
-- across promises they never made.
--
-- ── The period, and the two kinds of lateness ─────────────────────────────
--
-- `raised` counts requests raised in the period. `answered_late` is of those
-- too: raised in the period and acknowledged after the promise had passed.
-- That is history and it cannot change.
--
-- `overdue_now` is different and is as of today: still unacknowledged, with
-- the promise already gone. It is the only figure here somebody can still do
-- something about, which is why it is separate rather than folded in.
--
-- ── A type that promises nothing ──────────────────────────────────────────
--
-- `respond_within_hours` is nullable, so `requests.respond_by` can be null
-- and such a request can never be late. It also cannot be chased: 0068 has
-- nothing to work from. That is not a bug in the data, it is a gap in the
-- configuration, and it is reported as a concern rather than quietly
-- counting those requests as answered on time — which is what a plain
-- `respond_by < now()` test would do.
-- ---------------------------------------------------------------------------

create or replace function public.requests_report(
  p_from date,
  p_to date
)
returns table (
  type_id uuid,
  type_code text,
  type_name text,
  unit_name text,
  respond_within_hours integer,
  raised integer,
  acknowledged integer,
  resolved integer,
  rejected integer,
  converted integer,
  answered_late integer,
  no_promise integer,
  still_open integer,
  overdue_now integer,
  never_acknowledged integer,
  avg_hours_to_acknowledge numeric,
  avg_hours_to_resolve numeric,
  oldest_open_days integer,
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
    raise exception 'a requests report needs a period'
      using hint = 'Both dates are required: the sheet is filed against them.';
  end if;
  if p_to < p_from then
    raise exception 'the period ends before it begins';
  end if;

  return query
  with r as (
    select q.request_type_id,
           q.status,
           q.respond_by,
           q.acknowledged_at,
           q.resolved_at,
           q.converted_id,
           q.created_at,
           (q.created_at at time zone 'UTC')::date as raised_on,
           (q.status not in ('RESOLVED', 'CLOSED', 'REJECTED')) as is_open
      from public.requests q
     where q.org_id = org
       and ((q.created_at at time zone 'UTC')::date between p_from and p_to
         -- Still open, whatever its age: the same rule as the maintenance
         -- report, and the same reason — an unanswered request from March is
         -- more this month's problem than March's.
         or q.status not in ('RESOLVED', 'CLOSED', 'REJECTED'))
  ),
  per_type as (
    select
      r.request_type_id as type_id,
      count(*) filter (where r.raised_on between p_from and p_to)::integer
        as raised,
      count(*) filter (where r.raised_on between p_from and p_to
                         and r.acknowledged_at is not null)::integer
        as acknowledged,
      count(*) filter (where r.raised_on between p_from and p_to
                         and r.resolved_at is not null)::integer
        as resolved,
      count(*) filter (where r.raised_on between p_from and p_to
                         and r.status = 'REJECTED')::integer
        as rejected,
      count(*) filter (where r.raised_on between p_from and p_to
                         and r.converted_id is not null)::integer
        as converted,
      /*
       * Answered, but after the promise had passed. History: it cannot
       * change and nobody can act on it now.
       */
      count(*) filter (where r.raised_on between p_from and p_to
                         and r.respond_by is not null
                         and r.acknowledged_at is not null
                         and r.acknowledged_at > r.respond_by)::integer
        as answered_late,
      count(*) filter (where r.raised_on between p_from and p_to
                         and r.respond_by is null)::integer
        as no_promise,
      count(*) filter (where r.is_open)::integer as still_open,
      /*
       * As of today, and the only figure here anybody can still do something
       * about. Deliberately not folded into `answered_late`: one is a
       * post-mortem and the other is a list of people still waiting.
       */
      count(*) filter (where r.is_open
                         and r.acknowledged_at is null
                         and r.respond_by is not null
                         and r.respond_by < now())::integer
        as overdue_now,
      count(*) filter (where r.is_open and r.acknowledged_at is null)::integer
        as never_acknowledged,
      /*
       * From `created_at`, not from midnight of the day it was raised.
       *
       * The first version measured against `raised_on::timestamp`, which is
       * the start of that day — so every request raised in the afternoon
       * carried eleven or twelve invented hours, and a two-hour promise
       * showed an average answer time of sixteen hours while only two of
       * thirteen were actually late. The two figures contradicted each other
       * on the same row, which is the only reason it was caught.
       */
      round(avg(extract(epoch from (r.acknowledged_at - r.created_at)) / 3600.0)
            filter (where r.raised_on between p_from and p_to
                      and r.acknowledged_at is not null), 1)
        as avg_ack,
      round(avg(extract(epoch from (r.resolved_at - r.created_at)) / 3600.0)
            filter (where r.raised_on between p_from and p_to
                      and r.resolved_at is not null), 1)
        as avg_res,
      max(current_date - r.raised_on) filter (where r.is_open)::integer
        as oldest_open
      from r
     group by r.request_type_id
  )
  select
    t.id, t.code, t.name, u.name, t.respond_within_hours,
    pt.raised, pt.acknowledged, pt.resolved, pt.rejected, pt.converted,
    pt.answered_late, pt.no_promise, pt.still_open, pt.overdue_now,
    pt.never_acknowledged, pt.avg_ack, pt.avg_res, pt.oldest_open,
    array_remove(array[
      case when pt.overdue_now > 0
           then pt.overdue_now || ' still waiting past the time somebody promised' end,
      case when pt.never_acknowledged - pt.overdue_now > 0
           then (pt.never_acknowledged - pt.overdue_now) ||
                ' open and not yet acknowledged' end,
      case when pt.answered_late > 0
           then pt.answered_late || ' of ' || pt.raised ||
                ' were answered after the promise had passed' end,
      /*
       * Not a data problem: a gap in the configuration. Said rather than
       * silently counted as on time, which is what a plain `respond_by <
       * now()` test does to a request that never had a `respond_by`.
       */
      case when t.respond_within_hours is null
           then 'this type promises no answer by any time, so nothing here can be late or chased' end,
      case when pt.rejected > 0
           then pt.rejected || ' rejected' end,
      case when coalesce(pt.oldest_open, 0) >= 14
           then 'something has been open ' || pt.oldest_open || ' days' end
    ], null)
    from public.request_types t
    join per_type pt on pt.type_id = t.id
    left join public.business_units u on u.id = t.to_unit_id
   where t.org_id = org
   order by pt.overdue_now desc, pt.answered_late desc, t.code;
end $$;

comment on function public.requests_report(date, date) is
  'One row per request type: what came through the front door, how much of '
  'it was answered inside the promise the type makes, and how much is still '
  'waiting. Raised and answered-late are of the period; still open and '
  'overdue are as of today. Every member of the venue may read it.';

revoke all on function public.requests_report(date, date) from anon;
grant execute on function public.requests_report(date, date) to authenticated;
