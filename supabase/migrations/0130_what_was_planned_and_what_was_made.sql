-- ---------------------------------------------------------------------------
-- What was planned and what was made
-- ---------------------------------------------------------------------------
-- Phase 2 of the reports work, and the first of the sections that had no
-- report at all. A production plan says what a kitchen intends to prepare for
-- a service; a production record says what it actually made. The two have
-- been stored since 0060 and nothing has ever put them side by side.
--
-- That gap is the whole report. A head of department at a Monday meeting does
-- not want a list of batches — they want the three lines where the plan and
-- the day disagreed:
--
--   a service that was planned and nothing was made for,
--   a preparation that was made with no plan behind it,
--   and a batch that had to be corrected afterwards.
--
-- ── One row per service, not per batch ────────────────────────────────────
--
-- A batch list is the raw record and already exists on the Production screen.
-- Aggregating to the service is what makes it a report: it is the grain the
-- kitchen works in — Monday dinner either happened as intended or it did not
-- — and it is small enough to read across a table at a meeting.
--
-- Production made with no plan is kept, under a null plan, rather than
-- dropped. It is the more interesting half: a kitchen improvising is either
-- responding to a shortage or ignoring the plan, and both are worth a
-- sentence at the meeting. Dropping it would make the report agree with the
-- plan by construction.
--
-- ── What the two halves are actually counted in ───────────────────────────
--
-- A plan line is a *recipe* and a quantity of covers (0060). A completion
-- record is a *preparation* and a number of batches. They are not the same
-- unit and this report does not pretend they are: there is no item-by-item
-- match between them, and the only thing joining a batch to a plan is the
-- cook's own `plan_id` reference. So `dishes_planned` and `preparations_made`
-- sit in separate columns and are never subtracted from one another. The
-- report says whether a plan was answered at all, not whether it was answered
-- correctly — the second question needs a recipe-to-preparation map the
-- database does not have.
--
-- A batch counts against its plan whatever day it was made. Prep for Monday
-- lunch done on Sunday night is still prep for Monday lunch, and filtering
-- the records by the report's own period would read that as a service nobody
-- cooked for. Only the unplanned half is dated, because it has no plan to
-- hang from.
--
-- ── Corrected batches ─────────────────────────────────────────────────────
--
-- A correction is a new row naming the old one (0060), and both rows stay
-- readable. Summing both would count the batch twice, so superseded records
-- are excluded here exactly as `production_records_effective` excludes them.
-- That view is not used directly: it filters on org membership alone, which
-- would hand production figures to a reader with no Production access. This
-- function reads the table, so row-level security applies and such a reader
-- gets nothing — which is the honest answer, unlike traceability, where the
-- lots were shared and only the trace was gated.
--
-- ── One venue, the one the reader is working in ───────────────────────────
--
-- Row-level security answers "may I see this", not "is this mine". Somebody
-- who belongs to two venues can read both, so without an explicit scope this
-- would return both venues' services in one sheet — two Dinner rows on the
-- same date, no column saying which kitchen, and totals that are the sum of
-- two. Plausible, and wrong.
--
-- `auth_default_org_id()` is the venue the reader has actually switched to
-- (0129 scopes the traceability report the same way, and
-- `member_preferences.active_org_id` is where the choice is kept). The scope
-- is therefore deliberate and not a second access check: a reader with no
-- Production access still gets nothing, because RLS is doing that part.
-- ---------------------------------------------------------------------------

create or replace function public.production_report(
  p_from date,
  p_to date
)
returns table (
  planned_for date,
  service text,
  plan_id uuid,
  dishes_planned integer,
  covers_planned numeric,
  preparations_made integer,
  batches_made numeric,
  quantity_made numeric,
  made_by text,
  corrections integer,
  first_made_at timestamptz,
  last_made_at timestamptz,
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
    raise exception 'a production report needs a period'
      using hint = 'Both dates are required: the sheet is filed against them.';
  end if;
  if p_to < p_from then
    raise exception 'the period ends before it begins';
  end if;

  return query
  with plans as (
    select pl.id, pl.planned_for, pl.service
      from public.production_plans pl
     where pl.org_id = org
       and pl.planned_for between p_from and p_to
  ),
  planned as (
    select l.plan_id,
           count(*)::integer                          as dishes,
           coalesce(sum(l.covers), 0)::numeric        as covers
      from public.production_plan_lines l
      join plans p on p.id = l.plan_id
     group by l.plan_id
  ),
  /*
   * The records that still count. `not exists` over the same table rather
   * than a join, so a record superseded twice — which the one-successor
   * index in 0060 forbids, but which a future migration could allow — still
   * drops out exactly once.
   */
  effective as (
    select r.id, r.plan_id, r.sub_recipe_id, r.batches, r.quantity_made,
           r.produced_by_email, r.corrects_id, r.occurred_at,
           (r.occurred_at at time zone 'UTC')::date as made_on
      from public.production_records r
     where r.org_id = org
       and not exists (
       select 1 from public.production_records c where c.corrects_id = r.id
     )
  ),
  -- Against the plan, whatever day the batch was worked.
  made_for_plan as (
    select e.plan_id,
           count(distinct e.sub_recipe_id)::integer       as preparations,
           coalesce(sum(e.batches), 0)                    as batches,
           coalesce(sum(e.quantity_made), 0)              as quantity,
           nullif(string_agg(distinct e.produced_by_email, ', '
                             order by e.produced_by_email), '') as people,
           count(*) filter (where e.corrects_id is not null)::integer
                                                          as corrections,
           min(e.occurred_at)                             as first_at,
           max(e.occurred_at)                             as last_at
      from effective e
     where e.plan_id is not null
     group by e.plan_id
  ),
  -- And the improvised half, which has only its own date to go on.
  made_loose as (
    select e.made_on,
           count(distinct e.sub_recipe_id)::integer       as preparations,
           coalesce(sum(e.batches), 0)                    as batches,
           coalesce(sum(e.quantity_made), 0)              as quantity,
           nullif(string_agg(distinct e.produced_by_email, ', '
                             order by e.produced_by_email), '') as people,
           count(*) filter (where e.corrects_id is not null)::integer
                                                          as corrections,
           min(e.occurred_at)                             as first_at,
           max(e.occurred_at)                             as last_at
      from effective e
     where e.plan_id is null
       and e.made_on between p_from and p_to
     group by e.made_on
  )
  -- Services that were planned, whether or not anything came of them.
  select p.planned_for,
         p.service::text,
         p.id,
         coalesce(pd.dishes, 0),
         coalesce(pd.covers, 0::numeric),
         coalesce(m.preparations, 0),
         coalesce(m.batches, 0),
         coalesce(m.quantity, 0),
         m.people,
         coalesce(m.corrections, 0),
         m.first_at,
         m.last_at,
         array_remove(array[
           case when coalesce(m.preparations, 0) = 0
                then 'planned, and nothing was made for it' end,
           case when coalesce(pd.dishes, 0) = 0
                then 'a plan with no dishes on it' end,
           case when coalesce(m.corrections, 0) > 0
                then m.corrections || ' batch' ||
                     case when m.corrections = 1 then '' else 'es' end ||
                     ' corrected after the fact' end
         ], null)
    from plans p
    left join planned       pd on pd.plan_id = p.id
    left join made_for_plan m  on m.plan_id  = p.id

  union all

  -- And production that answered to no plan at all.
  select m.made_on,
         null,
         null,
         0,
         0::numeric,
         m.preparations, m.batches, m.quantity, m.people, m.corrections,
         m.first_at, m.last_at,
         array_remove(array[
           'made with no plan behind it',
           case when m.corrections > 0
                then m.corrections || ' batch' ||
                     case when m.corrections = 1 then '' else 'es' end ||
                     ' corrected after the fact' end
         ], null)
    from made_loose m

  order by 1 desc, 2 nulls last;
end $$;

comment on function public.production_report(date, date) is
  'One row per planned service in the period, plus a row per day of '
  'production that answered to no plan. Superseded batches are excluded. '
  'Reads as the caller; Production access is required for any of it.';

revoke all on function public.production_report(date, date) from anon;
grant execute on function public.production_report(date, date) to authenticated;
