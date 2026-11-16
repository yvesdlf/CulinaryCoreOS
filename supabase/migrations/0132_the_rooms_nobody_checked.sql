-- ---------------------------------------------------------------------------
-- The rooms that were cleaned, and the ones nobody checked
-- ---------------------------------------------------------------------------
-- Third of the six. 0056 built housekeeping in September — rooms, tasks,
-- inspections, a state log — with five views over it: `housekeeping_board`,
-- `housekeeping_workload`, `rooms_to_inspect`, `my_rooms` and
-- `housekeeping_replenishment`. Every one of them answers "what is happening
-- now". None of them answers "how did last week go", which is the question a
-- Monday meeting is actually for.
--
-- There is also no demo data at all: four room types exist and zero rooms, so
-- none of those five views has ever rendered anything either.
--
-- ── Why the row is a room ─────────────────────────────────────────────────
--
-- Same reasoning as the maintenance report. A task list is the raw record and
-- the board already has it. What a list cannot show is the room that failed
-- inspection three times this week, which is three ordinary rows and one
-- conversation.
--
-- Tasks against a location rather than a room — public areas, linen rooms —
-- are kept under a null room. They are real work and they are the half that
-- disappears from every per-room report.
--
-- Only rooms with work or a problem in the period are listed. A venue with
-- two hundred rooms would otherwise produce two hundred lines to hide eleven,
-- and `housekeepingCaveats` says so, because an absent room and a room with
-- nothing to report are indistinguishable on the page.
--
-- "Or a problem" is doing real work in that sentence. A room out of service
-- has no tasks precisely *because* it is out of service, so an inner join to
-- the sheet would drop the one room the meeting most needs to discuss — and
-- would drop it silently, which is how a room stays off the market for five
-- weeks with nobody raising it. The first version of this function made that
-- mistake and the concern for it was unreachable code.
--
-- ── What "nobody checked it" means here ───────────────────────────────────
--
-- 0056 moves a task to INSPECTED on a pass and back to REJECTED on a failure,
-- so a task sitting in DONE is one that was cleaned and has not been looked
-- at. That is not an error — inspection is meant to lag the clean — but a
-- week's worth of them is a supervisor who stopped inspecting, and nothing
-- else in the system says so out loud.
--
-- The rule that an attendant cannot inspect their own room is enforced by
-- trigger (0056) and so cannot appear here: there is no such row to report.
-- Reporting on a control the database already makes impossible would be
-- theatre.
--
-- ── Minutes ───────────────────────────────────────────────────────────────
--
-- `standard_minutes` is what the room is allowed and `actual_minutes` is what
-- it took, both per task. Both are summed over the tasks that recorded an
-- actual, which is not the same as the tasks that *finished* and the
-- distinction is the whole of it.
--
-- An unfinished task has no actual, so its allowance must not count: adding
-- it would make every day with rooms still in progress look efficient, and it
-- would look that way every week.
--
-- A **rejected** task is the mirror image. It did not finish — the inspection
-- sent it back — but somebody spent forty-five minutes on it, and a room
-- cleaned twice cost the venue two cleans. The first version of this filtered
-- on status and so dropped exactly the work that went wrong, flattering the
-- ratio in precisely the cases a supervisor is looking for. `actual_minutes
-- is not null` is the honest test: did this task consume anybody's time.
--
-- `finished` stays a count of DONE and INSPECTED, because a rejected clean is
-- not finished work even though it was paid for.
--
-- The ratio is deliberately not a performance score. It is reported per room
-- rather than per attendant, and `attendants` is a count rather than a list,
-- because a per-person league table built from a demo-grade standard time is
-- the sort of number that gets somebody disciplined for working in the villa
-- with the broken air conditioning.
--
-- ── Who may read it, and which venue ──────────────────────────────────────
--
-- Invoker rights, scoped to `auth_default_org_id()` — the same shape as 0129,
-- 0130 and 0131. Every table behind this is gated on Housekeeping, so a
-- reader without it gets nothing, and the scope stops a reader who belongs to
-- two venues getting both hotels' floors in one sheet.
-- ---------------------------------------------------------------------------

create or replace function public.housekeeping_report(
  p_from date,
  p_to date
)
returns table (
  room_id uuid,
  room_number text,
  room_type text,
  floor text,
  room_state text,
  occupancy text,
  days_in_state integer,
  tasks integer,
  finished integer,
  unfinished integer,
  rejected integer,
  awaiting_inspection integer,
  inspections integer,
  inspections_failed integer,
  standard_minutes integer,
  actual_minutes integer,
  attendants integer,
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
    raise exception 'a housekeeping report needs a period'
      using hint = 'Both dates are required: the sheet is filed against them.';
  end if;
  if p_to < p_from then
    raise exception 'the period ends before it begins';
  end if;

  return query
  with task as (
    select t.id, t.room_id, t.status, t.assigned_to,
           t.standard_minutes, t.actual_minutes,
           (t.status in ('DONE', 'INSPECTED')) as is_finished
      from public.housekeeping_tasks t
     where t.org_id = org
       and t.task_date between p_from and p_to
  ),
  insp as (
    select i.task_id, i.passed
      from public.housekeeping_inspections i
      join task on task.id = i.task_id
     where i.org_id = org
  ),
  per_room as (
    select
      t.room_id,
      count(*)::integer as tasks,
      count(*) filter (where t.is_finished)::integer as finished,
      count(*) filter (where t.status in ('PENDING', 'IN_PROGRESS'))::integer
        as unfinished,
      count(*) filter (where t.status = 'REJECTED')::integer as rejected,
      count(*) filter (where t.status = 'DONE')::integer as awaiting,
      /*
       * Minutes over the tasks that recorded an actual — see the header. Not
       * over the finished ones: that would drop every rejected clean, which
       * is the work that cost the most and went the most wrong.
       */
      coalesce(sum(t.standard_minutes)
               filter (where t.actual_minutes is not null), 0)::integer
        as standard,
      coalesce(sum(t.actual_minutes)
               filter (where t.actual_minutes is not null), 0)::integer
        as actual,
      count(distinct t.assigned_to)::integer as attendants
      from task t
     group by t.room_id
  ),
  per_room_insp as (
    select t.room_id,
           count(*)::integer as inspections,
           count(*) filter (where not i.passed)::integer as failed
      from insp i
      join task t on t.id = i.task_id
     group by t.room_id
  )
  select
    r.id,
    r.room_number,
    rt.name,
    r.floor,
    r.state::text,
    r.occupancy::text,
    (current_date - (r.state_changed_at at time zone 'UTC')::date)::integer,
    coalesce(pr.tasks, 0), coalesce(pr.finished, 0),
    coalesce(pr.unfinished, 0), coalesce(pr.rejected, 0),
    coalesce(pr.awaiting, 0),
    coalesce(pi.inspections, 0),
    coalesce(pi.failed, 0),
    coalesce(pr.standard, 0), coalesce(pr.actual, 0),
    coalesce(pr.attendants, 0),
    array_remove(array[
      /*
        * Out of service, and for how long. The duration is the part that
        * matters: a room out for two days is maintenance, a room out for
        * five weeks is lost revenue nobody has escalated.
        */
      case when r.state = 'OUT_OF_SERVICE'
           then 'out of service '
             || (current_date - (r.state_changed_at at time zone 'UTC')::date)
             || ' days'
             || coalesce(' — ' || nullif(btrim(r.out_of_service_reason), ''), '')
           end,
      case when r.state = 'DIRTY'
            and (current_date - (r.state_changed_at at time zone 'UTC')::date) >= 2
           then 'dirty for '
             || (current_date - (r.state_changed_at at time zone 'UTC')::date)
             || ' days' end,
      case when coalesce(pi.failed, 0) > 0
           then pi.failed || ' inspection' ||
                case when pi.failed = 1 then '' else 's' end || ' failed' end,
      case when coalesce(pr.rejected, 0) > 0
           then 'sent back to be done again ' || pr.rejected ||
                case when coalesce(pr.rejected, 0) = 1 then ' time' else ' times' end end,
      case when coalesce(pr.awaiting, 0) > 0
           then pr.awaiting || ' clean' ||
                case when coalesce(pr.awaiting, 0) = 1 then '' else 's' end ||
                ' nobody has inspected' end,
      case when coalesce(pr.unfinished, 0) > 0
           then pr.unfinished || ' task' ||
                case when coalesce(pr.unfinished, 0) = 1 then '' else 's' end ||
                ' never finished' end,
      /*
       * A fifth over, and only where there is enough work behind it to mean
       * something. One villa that took twenty minutes longer is a villa; a
       * week of them is a standard time that is wrong or a room that is.
       */
      case when coalesce(pr.standard, 0) >= 60 and coalesce(pr.actual, 0) > pr.standard * 1.2
           then 'took ' ||
                round((pr.actual::numeric / pr.standard - 1) * 100) ||
                '% longer than the time allowed' end
    ], null)
    from public.rooms r
    left join public.room_types rt on rt.id = r.room_type_id
    left join per_room pr on pr.room_id = r.id
    left join per_room_insp pi on pi.room_id = r.id
   where r.org_id = org
     and (pr.room_id is not null or r.state = 'OUT_OF_SERVICE')

  union all

  -- Work against a place rather than a room: public areas, linen, corridors.
  select
    null, null, null, null, null, null, null,
    pr.tasks, pr.finished, pr.unfinished, pr.rejected, pr.awaiting,
    coalesce(pi.inspections, 0), coalesce(pi.failed, 0),
    pr.standard, pr.actual, pr.attendants,
    array_remove(array[
      'not a room — public areas and linen',
      /*
       * Public-area work is inspectable like any other task — 0056 puts no
       * room in the way of it — so a pile of it sitting in DONE means the
       * same here as it does upstairs. Without this the column reads seven
       * and nothing on the row says what seven is.
       */
      case when coalesce(pr.awaiting, 0) > 0
           then pr.awaiting || ' finished, none of them inspected' end,
      case when coalesce(pr.unfinished, 0) > 0
           then pr.unfinished || ' task' ||
                case when coalesce(pr.unfinished, 0) = 1 then '' else 's' end ||
                ' never finished' end,
      case when coalesce(pi.failed, 0) > 0
           then pi.failed || ' inspection' ||
                case when pi.failed = 1 then '' else 's' end || ' failed' end
    ], null)
    from per_room pr
    left join per_room_insp pi on pi.room_id is null
   where pr.room_id is null

  order by 14 desc, 11 desc, 2 nulls last;
end $$;

comment on function public.housekeeping_report(date, date) is
  'One row per room worked in the period, plus a row for work against a '
  'place rather than a room. Minutes are summed over finished tasks only. '
  'Reads as the caller, in the caller''s active venue; Housekeeping access '
  'is required for any of it.';

revoke all on function public.housekeeping_report(date, date) from anon;
grant execute on function public.housekeeping_report(date, date) to authenticated;
