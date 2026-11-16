-- ---------------------------------------------------------------------------
-- HR cases: a caseload, and who can see it
-- ---------------------------------------------------------------------------
-- The HR case module has existed for months with no case in it. The screen
-- renders an empty state and `hr_cases_report` (0133) has nothing to report.
--
-- ── This seed is different from the other five ────────────────────────────
--
-- `hr_cases` is not section-gated. Its read policy is organisation membership
-- **and** `can_see_case` — a participant by user id or by email, or the
-- organisation's owner. So who is on the participant list is not decoration
-- here: it is the access control, and a case seeded with the wrong
-- participants is a case the demo user cannot see at all.
--
-- The demo owner is an OWNER, so they see everything and the report's
-- `reader_sees_all` is true for them. That is the interesting half to
-- demonstrate — but the *other* half matters more, so the participant lists
-- below are real and varied rather than "everybody on everything". A head of
-- department signed in as themselves should be able to see the difference.
--
-- ── What it has to contain ────────────────────────────────────────────────
--
--   a case closed with no outcome written down — the worst of them, because
--     a grievance marked resolved with nothing recorded is a case the venue
--     cannot defend at a tribunal and nothing else ever asks,
--   an escalated case,
--   a case open far longer than thirty days,
--   a case nobody has changed in a fortnight,
--   a case with only its author on it, which nobody else can even see,
--   recognition cases, so the report is not purely disciplinary,
--   and a majority of ordinary cases opened, handled and closed properly.
--
-- ── No real people, and nothing that reads like a real case ───────────────
--
-- The summaries are deliberately flat and procedural. Demo data that reads
-- like a real grievance is demo data somebody will one day screenshot into a
-- deck, and the report itself carries no summaries for the same reason.
--
-- Deterministic, not random. Safe to run more than once.
-- ---------------------------------------------------------------------------

do $$
declare
  org uuid;
  i integer;
  opened date;
  closed date;
  st text;
  knd text;
  emp uuid;
  emp_ids uuid[];
  n_emp integer;
  new_case uuid;
  n_cases integer := 0;
  n_parts integer := 0;
  openers text[] := array['gm@venue.test', 'chef@venue.test', 'sous@venue.test'];
  opener text;
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

  delete from public.hr_case_participants
   where case_id in (select id from public.hr_cases where org_id = org);
  delete from public.hr_cases where org_id = org;

  select array_agg(id order by employee_number) into emp_ids
    from public.employees where org_id = org;
  n_emp := coalesce(array_length(emp_ids, 1), 0);

  if n_emp = 0 then
    raise exception 'there are no employees to open a case against'
      using hint = 'Run seed_people.sql first.';
  end if;

  for i in 0..15 loop
    /*
     * Spread over six months rather than four weeks. A caseload is not a
     * week's work: the cases worth finding are the ones opened in the spring
     * that nobody has closed, and a four-week window cannot contain one.
     */
    opened := current_date - (12 + i * 11);

    knd := case (i % 5)
             when 0 then 'CONDUCT'      when 1 then 'PERFORMANCE'
             when 2 then 'GRIEVANCE'    when 3 then 'INVESTIGATION'
             else 'RECOGNITION' end;

    st := case (i % 8)
            when 0 then 'OPEN'
            when 1 then 'IN_PROGRESS'
            when 2 then 'ESCALATED'
            when 3 then 'WITHDRAWN'
            else 'RESOLVED'
          end;

    -- Closed cases took between a week and two months.
    closed := case when st in ('RESOLVED', 'WITHDRAWN')
                   then least(opened + (7 + (i * 5) % 50), current_date) end;

    emp := emp_ids[1 + (i * 5) % n_emp];
    opener := openers[1 + (i % 3)];

    insert into public.hr_cases
      (org_id, employee_id, reference, kind, status, summary, detail,
       outcome, opened_by_email, opened_on, closed_on, updated_at)
    values (
      org, emp,
      'HR-' || to_char(opened, 'YYYY') || '-' || lpad((i + 1)::text, 3, '0'),
      knd::public.case_kind,
      st::public.case_status,
      /*
       * Flat and procedural on purpose — see the header. These are the one
       * field a reader of the *screen* sees, and the report carries none of
       * them into a file.
       */
      case knd
        when 'CONDUCT'       then 'Timekeeping over the preceding month.'
        when 'PERFORMANCE'   then 'Objectives review following probation.'
        when 'GRIEVANCE'     then 'Concern raised about shift allocation.'
        when 'INVESTIGATION' then 'Stock discrepancy reported by a supervisor.'
        else                      'Guest letter naming a member of the team.'
      end,
      'Notes are held on the case record.',
      /*
       * One closed case in three has no outcome written down. That is the
       * line the report exists to surface and it is deliberately not rare:
       * closing a case without recording the decision is the commonest
       * failure in any case system, because the work feels finished.
       */
      case when st in ('RESOLVED', 'WITHDRAWN') and (i % 3) <> 1
           then case st when 'WITHDRAWN'
                        then 'Withdrawn by the person who raised it.'
                        else 'Discussed and agreed; no further action.' end
           end,
      opener, opened, closed,
      /*
       * When it was last touched, written here rather than afterwards so it
       * can be **clamped to the case's own age**.
       *
       * Two bugs lived in the version that set this in a later UPDATE. The
       * operands were reversed — `opened_on - current_date` is negative for
       * a case opened in the past and Postgres keeps the sign through `%`,
       * so it put `updated_at` three weeks into the future and the "nothing
       * changed" concern could never fire at all. Then, with that corrected,
       * a case opened 34 days ago reported "nothing changed for 37 days":
       * changed before it existed. A date in the future and a date before
       * the record began are both the kind of wrong that still looks like a
       * date.
       *
       * One case in three is fresh, so the report shows a caseload somebody
       * is working rather than one nobody has touched.
       */
      now() - (interval '1 day' * least(
        case when i % 3 = 0 then 2 else 9 + (i * 5) % 30 end,
        current_date - opened))
    )
    returning id into new_case;
    n_cases := n_cases + 1;

    /*
     * The participant list is the access control, not a label. The opener is
     * always on it; most cases also carry the general manager, so somebody
     * other than the author can pick them up.
     *
     * One in five has nobody but its author. Those are invisible to every
     * other head of department — only the owner can reach them — which is
     * exactly the concern the report raises and exactly what happens when
     * the author leaves.
     */
    insert into public.hr_case_participants (case_id, email, role)
    values (new_case, opener, 'OPENER');
    n_parts := n_parts + 1;

    /*
     * The second person is somebody other than the opener, always.
     *
     * The first version always added the general manager, so every case the
     * general manager opened conflicted that row away and ended up with one
     * participant — half the caseload carrying the "only one person can see
     * it" concern, which buries the three that mean it.
     */
    if (i % 5) <> 3 then
      insert into public.hr_case_participants (case_id, email, role)
      values (new_case,
              case when opener = 'gm@venue.test'
                   then 'chef@venue.test' else 'gm@venue.test' end,
              'HR');
      n_parts := n_parts + 1;
    end if;
  end loop;

  /*
   * How long since anybody touched them, applied last.
   *
   * `updated_at` defaults to now() on insert and nothing resets it, so
   * without this every case reads as changed today and the "nothing changed
   * on it" concern could never fire on any of them. The open ones are staged
   * so some are live and some have been sitting.
   */
  raise notice 'HR: % cases, % participants', n_cases,
    (select count(*) from public.hr_case_participants p
      join public.hr_cases c on c.id = p.case_id where c.org_id = org);
  raise notice 'HR: % still open, % closed with no outcome, % with only one person on them',
    (select count(*) from public.hr_cases where org_id = org and closed_on is null),
    (select count(*) from public.hr_cases
      where org_id = org and closed_on is not null
        and coalesce(btrim(outcome), '') = ''),
    (select count(*) from public.hr_cases c where c.org_id = org
       and (select count(*) from public.hr_case_participants p
             where p.case_id = c.id) <= 1);
end $$;
