-- ---------------------------------------------------------------------------
-- What the last shift left behind, and whether anybody read it
-- ---------------------------------------------------------------------------
-- The sixth and last. 0071 gave the venue a shift handover: a department
-- writes one at the end of a shift, publishes it, and the next shift
-- acknowledges it. There has never been a handover in the demo database, so
-- `handover_board` has never shown a row and neither the writing nor the
-- reading half has ever been looked at.
--
-- ── Why the row is a department ───────────────────────────────────────────
--
-- A handover is a department's own record and the chain is per department:
-- the Kitchen's Tuesday handover says nothing about whether the Bar wrote
-- one. A row per handover would be a hundred and fifty lines for a month
-- across five departments, and the question a meeting asks is not "what did
-- Tuesday say" — it is "is this department keeping the chain at all".
--
-- ── Three ways the chain breaks, and they are not the same ────────────────
--
--   **Nothing written.** A day with no handover. The next shift started with
--   whatever they could remember.
--
--   **Written and never published.** 0071 makes DRAFT mean nobody else can
--   see it. A draft is worse than nothing, because the person who wrote it
--   believes they handed over. This is the failure with a false sense of
--   having done the work, and it is the one the report puts first.
--
--   **Published and never acknowledged.** Written into the void. It may have
--   been read — acknowledging is a button, and people are busy — so this is
--   reported as what it is rather than as proof nobody looked.
--
-- ── What `days_missing` cannot know ───────────────────────────────────────
--
-- It counts calendar days in the period with no published handover for that
-- department. The schema has no notion of a department being closed, so a
-- Monday the Bar did not open is indistinguishable from a Monday nobody
-- wrote anything. The figure is still worth having — a department that
-- misses eleven days in a month is worth asking about either way — but it is
-- a question rather than a finding, and `handoverCaveats` says so rather
-- than letting a reader take it for absence.
--
-- ── An empty handover ─────────────────────────────────────────────────────
--
-- Published, with no items on it and nothing in the summary. It satisfies
-- every check in the system and tells the next shift nothing, which is the
-- shape every tick-box process eventually takes. Counted separately from the
-- days with nothing at all, because they are different problems: one is a
-- department that has stopped bothering, the other is one that has stopped
-- pretending.
--
-- ── The one place this report has to check access itself ─────────────────
--
-- Every other report in this series lets row-level security decide: read the
-- gated table as the caller, and a reader without the section gets no rows
-- because there are no rows to get.
--
-- That does not work here, and the reason is the grain. A row is a
-- *department*, and `business_units` is shared — "the venue's departments,
-- named on every screen". So the row set survives RLS untouched and only the
-- counts come from the gated tables. A reader without Handover was therefore
-- handed five departments with nought in every column: a report saying
-- nobody in the venue has written a handover all month, which is a different
-- and much worse statement than "this is not yours to read".
--
-- Hence the explicit `can_read_section` at the top. It is a deliberate
-- exception to the pattern and it is here because the shape of the report
-- made the usual mechanism inapplicable, not because it is tidier.
--
-- Invoker rights and scoped to the active venue, like 0130 to 0134.
-- ---------------------------------------------------------------------------

create or replace function public.handover_report(
  p_from date,
  p_to date
)
returns table (
  unit_id uuid,
  unit_code text,
  unit_name text,
  days_in_period integer,
  days_covered integer,
  days_missing integer,
  longest_gap_days integer,
  written integer,
  drafts integer,
  published integer,
  acknowledged integer,
  never_acknowledged integer,
  empty_handovers integer,
  items integer,
  safety_items integer,
  avg_hours_to_acknowledge numeric,
  concerns text[]
)
language plpgsql
stable
set search_path = ''
as $$
declare
  org uuid := public.auth_default_org_id();
  span integer;
begin
  if p_from is null or p_to is null then
    raise exception 'a handover report needs a period'
      using hint = 'Both dates are required: the sheet is filed against them.';
  end if;
  if p_to < p_from then
    raise exception 'the period ends before it begins';
  end if;

  /*
   * See the header. The departments are readable by everybody, so without
   * this a reader with no Handover access gets every department with nought
   * against it, which reads as "nobody wrote one" rather than "not yours".
   */
  if not public.can_read_section('HANDOVER', org, null) then
    return;
  end if;

  span := (p_to - p_from) + 1;

  return query
  with h as (
    select v.id, v.business_unit_id, v.on_date, v.status, v.published_at,
           v.acknowledged_at,
           (coalesce(btrim(v.summary), '') <> '') as has_summary
      from public.handovers v
     where v.org_id = org
       and v.on_date between p_from and p_to
  ),
  counted as (
    select i.handover_id,
           count(*)::integer as n,
           count(*) filter (where i.kind = 'SAFETY')::integer as safety
      from public.handover_items i
      join h on h.id = i.handover_id
     group by i.handover_id
  ),
  /*
   * The longest run of days without a published handover.
   *
   * Computed from the gaps between consecutive covered days, with the
   * period's own edges counted too: a department that published nothing
   * until the twentieth has a nineteen-day gap, and a version that only
   * looked between covered days would report nought for a department that
   * published once.
   */
  covered as (
    select distinct h.business_unit_id, h.on_date
      from h where h.status = 'PUBLISHED'
  ),
  gaps as (
    select c.business_unit_id,
           c.on_date - coalesce(
             lag(c.on_date) over (partition by c.business_unit_id
                                  order by c.on_date),
             p_from - 1) - 1 as gap
      from covered c
    union all
    -- And the run from the last covered day to the end of the period.
    select c.business_unit_id, p_to - max(c.on_date)
      from covered c group by c.business_unit_id
  ),
  per_unit as (
    select
      h.business_unit_id as unit_id,
      count(*)::integer as written,
      count(*) filter (where h.status = 'DRAFT')::integer as drafts,
      count(*) filter (where h.status = 'PUBLISHED')::integer as published,
      count(*) filter (where h.acknowledged_at is not null)::integer
        as acknowledged,
      count(*) filter (where h.status = 'PUBLISHED'
                         and h.acknowledged_at is null)::integer
        as never_acknowledged,
      count(*) filter (where h.status = 'PUBLISHED'
                         and not h.has_summary
                         and coalesce(c.n, 0) = 0)::integer
        as empty_handovers,
      coalesce(sum(c.n), 0)::integer as items,
      coalesce(sum(c.safety), 0)::integer as safety_items,
      round(avg(extract(epoch from (h.acknowledged_at - h.published_at)) / 3600.0)
            filter (where h.acknowledged_at is not null
                      and h.published_at is not null), 1)
        as avg_ack
      from h
      left join counted c on c.handover_id = h.id
     group by h.business_unit_id
  ),
  cover as (
    select c.business_unit_id, count(*)::integer as days
      from covered c group by c.business_unit_id
  ),
  worst as (
    select g.business_unit_id, max(g.gap)::integer as longest
      from gaps g group by g.business_unit_id
  )
  select
    u.id, u.code, u.name,
    span,
    coalesce(cv.days, 0),
    (span - coalesce(cv.days, 0))::integer,
    coalesce(w.longest, span),
    coalesce(pu.written, 0), coalesce(pu.drafts, 0),
    coalesce(pu.published, 0), coalesce(pu.acknowledged, 0),
    coalesce(pu.never_acknowledged, 0), coalesce(pu.empty_handovers, 0),
    coalesce(pu.items, 0), coalesce(pu.safety_items, 0),
    pu.avg_ack,
    array_remove(array[
      /*
       * First, because it is the failure that feels like success: somebody
       * wrote the handover, believes they handed over, and 0071 makes DRAFT
       * mean nobody else can see it.
       */
      case when coalesce(pu.drafts, 0) > 0
           then pu.drafts || ' written and never published, so nobody else saw '
                || case when pu.drafts = 1 then 'it' else 'them' end end,
      case when (span - coalesce(cv.days, 0)) > 0
           then (span - coalesce(cv.days, 0)) ||
                ' of ' || span || ' days with no handover published' end,
      case when coalesce(w.longest, span) >= 3
           then 'the longest run without one was ' ||
                coalesce(w.longest, span) || ' days' end,
      case when coalesce(pu.never_acknowledged, 0) > 0
           then pu.never_acknowledged || ' published and never acknowledged' end,
      case when coalesce(pu.empty_handovers, 0) > 0
           then pu.empty_handovers || ' published with nothing in ' ||
                case when pu.empty_handovers = 1 then 'it' else 'them' end end,
      case when coalesce(pu.safety_items, 0) > 0
           then pu.safety_items || ' safety ' ||
                case when pu.safety_items = 1 then 'item' else 'items' end end
    ], null)
    from public.business_units u
    left join per_unit pu on pu.unit_id = u.id
    left join cover cv on cv.business_unit_id = u.id
    left join worst w on w.business_unit_id = u.id
   where u.org_id = org
   order by coalesce(pu.drafts, 0) desc,
            (span - coalesce(cv.days, 0)) desc,
            u.code;
end $$;

comment on function public.handover_report(date, date) is
  'One row per department: whether it kept the handover chain, and where it '
  'broke. Days missing counts calendar days with nothing published and '
  'cannot tell a closed day from a forgotten one. Reads as the caller, in '
  'the caller''s active venue; Handover access is required for any of it.';

revoke all on function public.handover_report(date, date) from anon;
grant execute on function public.handover_report(date, date) to authenticated;
