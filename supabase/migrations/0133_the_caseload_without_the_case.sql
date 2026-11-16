-- ---------------------------------------------------------------------------
-- The caseload, without the case
-- ---------------------------------------------------------------------------
-- Fourth of the six. HR cases — conduct, performance, grievance,
-- investigation and recognition — with participants and a visibility rule of
-- their own. There has never been a single case in the demo database and
-- there has never been a report.
--
-- There is also no event trail. `hr_cases` and `hr_case_participants` are the
-- whole module: no case event table, and `hr_cases` is not in
-- `audited_tables` either, so the most sensitive records in the system are
-- the ones with no field-level history. That is a gap worth closing and it is
-- not closed here; what it means for this report is that "when was this last
-- touched" can only be answered by `updated_at`, which moves on any edit and
-- is weaker evidence than a trail. The concern below says "changed", not
-- "worked on", for that reason.
--
-- ── This one is not gated like the others ─────────────────────────────────
--
-- Production, Maintenance and Housekeeping are section-gated: a reader
-- without the section gets nothing, and that is the whole access story.
-- `hr_cases` is not in `section_read_rules` at all. It is governed by
-- `can_see_case` — a participant, by user or by email, or the organisation's
-- owner — which is deliberately narrower than any section.
--
-- So this report is *intrinsically partial*, and that is the single most
-- dangerous thing about it. A head of HR who is not a participant on a case
-- cannot see it, and a report that said "3 open cases" to somebody who can
-- see three of eleven would be read as "the venue has three open cases". It
-- would be read that way at a meeting, written into minutes, and acted on.
--
-- Every row therefore carries `reader_sees_all`, the same way the
-- traceability report carries `reader_sees_movements`: true only for an
-- owner, who is the one caller `can_see_case` lets through unconditionally.
-- The screen and all four exported files say which it is, in words, above the
-- table. A partial figure that does not know it is partial is worse than no
-- figure.
--
-- ── What it deliberately does not contain ─────────────────────────────────
--
-- No names. No summaries. No detail. No outcome text.
--
-- Not because the reader may not see them — they may, or the case would not
-- be in the result at all — but because this report exports to CSV, Excel,
-- Word and PDF, and those files leave the system. Access control does not
-- travel with a spreadsheet. A list of disciplinary cases against named
-- employees, mailed round a weekly management meeting, is a disclosure the
-- database can no longer take back.
--
-- What a caseload report is actually for is the shape of the caseload: how
-- many, of what kind, how old, how many closed without anybody recording what
-- was decided. None of that needs a name. The reference is the handle, and
-- anybody who needs the case opens it in the application, where
-- `can_see_case` still applies.
--
-- This is a judgement rather than a rule the schema enforces, so it is
-- written here where the next person will find it before adding a name
-- column.
--
-- ── The period ───────────────────────────────────────────────────────────
--
-- Opened in it, closed in it, or still open — the same rule as the
-- maintenance report, for the same reason. A case opened in March and still
-- running in November belongs on November's agenda more than on March's, and
-- it is the one most likely to have been forgotten.
-- ---------------------------------------------------------------------------

create or replace function public.hr_cases_report(
  p_from date,
  p_to date
)
returns table (
  case_id uuid,
  reference text,
  kind text,
  status text,
  opened_on date,
  closed_on date,
  days_open integer,
  participants integer,
  last_changed_on date,
  has_outcome boolean,
  reader_sees_all boolean,
  concerns text[]
)
language plpgsql
stable
set search_path = ''
as $$
declare
  org uuid := public.auth_default_org_id();
  sees_all boolean;
begin
  if p_from is null or p_to is null then
    raise exception 'an HR case report needs a period'
      using hint = 'Both dates are required: the sheet is filed against them.';
  end if;
  if p_to < p_from then
    raise exception 'the period ends before it begins';
  end if;

  /*
   * Worked out once, from the same rule `can_see_case` uses for its single
   * unconditional exception. Not re-derived per row: it is a fact about the
   * reader, not about the case, and a per-row version would invite somebody
   * to make it mean "I can see this one", which is already true of every row
   * in the result and therefore says nothing.
   */
  sees_all := exists (
    select 1 from public.organization_members m
     where m.organization_id = org
       and m.user_id = (select auth.uid())
       and m.role = 'OWNER'
  );

  return query
  with visible as (
    select c.id, c.reference, c.kind::text as kind, c.status::text as status,
           c.opened_on, c.closed_on,
           (coalesce(c.closed_on, current_date) - c.opened_on)::integer as days_open,
           (c.updated_at at time zone 'UTC')::date as last_changed_on,
           (coalesce(btrim(c.outcome), '') <> '') as has_outcome
      from public.hr_cases c
     where c.org_id = org
       and (c.opened_on between p_from and p_to
         or c.closed_on between p_from and p_to
         or c.status in ('OPEN', 'IN_PROGRESS', 'ESCALATED'))
  ),
  parts as (
    select p.case_id, count(*)::integer as n
      from public.hr_case_participants p
      join visible v on v.id = p.case_id
     group by p.case_id
  )
  select
    v.id, v.reference, v.kind, v.status, v.opened_on, v.closed_on,
    v.days_open,
    coalesce(p.n, 0),
    v.last_changed_on,
    v.has_outcome,
    sees_all,
    array_remove(array[
      /*
       * Closed without anybody writing down what was decided. The worst of
       * the lot: a grievance marked resolved with no outcome is a case the
       * venue cannot defend at a tribunal, and nothing else ever asks.
       */
      case when v.status in ('RESOLVED', 'WITHDRAWN') and not v.has_outcome
           then 'closed with no outcome recorded' end,
      case when v.status = 'ESCALATED'
           then 'escalated' end,
      /*
       * Thirty days. Not a legal limit — there is none that applies to every
       * kind here — but the point past which a conduct or grievance case
       * stops being handled and starts being endured.
       */
      case when v.closed_on is null and v.days_open >= 30
           then 'open ' || v.days_open || ' days' end,
      /*
       * From `updated_at`, which is all there is. It moves on any edit, so
       * this says "changed" rather than "worked on": a case somebody opened
       * and retitled is not a case somebody is handling, and this cannot
       * tell the two apart. It is still the only thing that distinguishes a
       * live case from one nobody has looked at since the spring.
       */
      case when v.closed_on is null
            and (current_date - v.last_changed_on) >= 14
           then 'nothing changed on it for '
                || (current_date - v.last_changed_on) || ' days' end,
      /*
       * A case with nobody but its author on it cannot be read by anybody
       * else except the owner, so it is invisible to the very people who
       * would pick it up if its author left.
       */
      case when coalesce(p.n, 0) <= 1 and v.closed_on is null
           then 'only one person can see it' end
    ], null)
    from visible v
    left join parts p on p.case_id = v.id
   order by (v.closed_on is null) desc, v.days_open desc, v.reference;
end $$;

comment on function public.hr_cases_report(date, date) is
  'One row per HR case the caller may see, carrying no names, summaries or '
  'outcome text because the report exports to files that leave the system. '
  '`reader_sees_all` is true only for an owner: for anybody else this is the '
  'cases they are a participant in, not the venue''s caseload.';

revoke all on function public.hr_cases_report(date, date) from anon;
grant execute on function public.hr_cases_report(date, date) to authenticated;
