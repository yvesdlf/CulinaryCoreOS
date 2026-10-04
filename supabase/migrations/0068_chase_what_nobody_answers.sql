-- ---------------------------------------------------------------------------
-- Chasing what nobody answers
-- ---------------------------------------------------------------------------
-- Gap 15: "a request nobody answers sits forever." 0066 gave a request a
-- `respond_by` and a department; this is what happens when the first passes and
-- the second has done nothing.
--
-- ## Up the tree, which is why the tree exists
--
-- `business_units.parent_id` has been a self-reference since 0058 and nothing
-- has read it. This does: an unanswered request goes to the unit's manager,
-- then to the parent unit's manager, then to the parent's parent, and stops at
-- the top. A venue with a flat list of four departments escalates once and
-- stops, which is correct for a venue with a flat list of four departments —
-- the tree is not required, it is used where it is there.
--
-- ## Each step is a notification, not a status change
--
-- The request stays NEW. Escalating is telling somebody, not deciding
-- something, and a request that silently became ACKNOWLEDGED because a timer
-- fired would be a lie told by the system on behalf of a person who never saw
-- it. What changes is `escalation_level` and a row in the ledger, both of which
-- say "nobody had answered this after four hours" — which is the finding.
--
-- ## Nothing is escalated twice for the same reason
--
-- `escalation_level` is the number of times it has been chased, and the sweep
-- only chases a request whose level is below the number of steps its age has
-- earned. A sweep that ran every minute and notified every minute would teach
-- the recipient to filter the sender, which is worse than not chasing at all.
--
-- ## What runs it
--
-- `pg_cron`, in 0069. The sweep is a plain function so it can be tested, called
-- by hand, and read — and so that the decision to run it on a timer is a
-- separate file from the decision about what it does.
-- ---------------------------------------------------------------------------

alter table requests
  add column if not exists escalation_level integer not null default 0,
  add column if not exists escalated_at timestamptz;

comment on column requests.escalation_level is
  'How many times nobody answering has been reported. Not a status: the request is still unanswered.';

-- The sweep reads this: unanswered, promised, and past the promise.
create index if not exists idx_requests_chase
  on requests(respond_by, escalation_level)
  where status = 'NEW' and respond_by is not null;

insert into app_sections (code, name, description, sort_order, is_core)
values ('REQUESTS', 'Requests',
        'The shared front door: anything raised to another department, and what became of it.',
        15, true)
on conflict (code) do nothing;

-- ── Who hears about it ──────────────────────────────────────────────────────

/*
 * The chain of people to tell, in order, for a request sitting on one unit.
 *
 * The unit's own manager first, then up the tree. `manager_employee_id` has
 * been on `business_units` since 0058 and this is its first reader, so a venue
 * that has not named any managers gets an empty chain — which is a finding
 * rather than an error, and the sweep says so instead of escalating into
 * silence.
 *
 * Depth-capped at the same twelve `enforce_business_unit_tree` allows, because
 * a cycle is refused on write and a corrupted row should still not hang a
 * sweep that runs every minute.
 */
create or replace function public.escalation_chain(p_unit uuid)
returns table (step integer, business_unit_id uuid, unit_name text,
               manager_employee_id uuid, manager_email text)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive up as (
    select b.id, b.parent_id, b.name, b.manager_employee_id, 1 as step
      from public.business_units b
     where b.id = p_unit
    union all
    select p.id, p.parent_id, p.name, p.manager_employee_id, up.step + 1
      from public.business_units p
      join up on p.id = up.parent_id
     where up.step < 12
  )
  select up.step, up.id, up.name, up.manager_employee_id, e.work_email
    from up
    left join public.employees e on e.id = up.manager_employee_id
   order by up.step;
$$;

grant execute on function public.escalation_chain(uuid) to authenticated;

-- ── The sweep ───────────────────────────────────────────────────────────────

/*
 * Chase everything that is past its promise and still unanswered.
 *
 * Returns what it did rather than writing to a log nobody reads: a caller — a
 * cron job, a test, somebody at a console — gets one row per request chased,
 * with who was told. A sweep that reports nothing is indistinguishable from a
 * sweep that did nothing, and the two want very different responses.
 *
 * `p_now` is a parameter and not `now()`. A sweep that reads the clock cannot
 * be tested across the boundary it exists to detect, and this one has three
 * boundaries — the promise, the second step and the top of the tree.
 *
 * SECURITY DEFINER, because the only caller is a job with no session: it reads
 * every venue's overdue requests on purpose. It is not granted to
 * `authenticated`, so nobody signed in can run it against a venue they cannot
 * see.
 */
create or replace function public.chase_unanswered_requests(
  p_now timestamptz default now(),
  p_limit integer default 500)
returns table (
  request_id uuid,
  reference text,
  unit_name text,
  level integer,
  told_email text,
  hours_waiting numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  target record;
  earned integer;
begin
  for r in
    select q.id, q.org_id, q.reference, q.title, q.business_unit_id,
           q.respond_by, q.escalation_level, q.created_at, q.priority,
           b.name as unit_name,
           t.respond_within_hours
      from public.requests q
      join public.business_units b on b.id = q.business_unit_id
      join public.request_types t on t.id = q.request_type_id
     where q.status = 'NEW'
       and q.respond_by is not null
       and q.respond_by < p_now
     order by q.respond_by
     limit greatest(p_limit, 0)
  loop
    /*
     * One step for being late at all, and another for every further wait of
     * the same length. A request promised in four hours and ignored for
     * thirteen has earned three steps; it is chased once now and not again
     * until it has earned a fourth.
     *
     * The period is the *promise* — the type's `respond_within_hours` — and
     * not `respond_by - created_at`, which is what this computed first. The
     * two agree on a request raised through a screen and disagree on one whose
     * `created_at` was backdated, which is every imported row and every row a
     * migration writes. A chase cadence that drifts on imported data is the
     * kind of wrong that is only ever noticed as "it keeps emailing me".
     */
    earned := 1 + floor(
      extract(epoch from (p_now - r.respond_by))
      / greatest(r.respond_within_hours * 3600.0, 1))::integer;

    if earned <= r.escalation_level then
      continue;
    end if;

    select * into target
      from public.escalation_chain(r.business_unit_id)
     where manager_email is not null
     order by step
     offset least(r.escalation_level, 11) limit 1;

    update public.requests
       set escalation_level = earned,
           escalated_at = p_now
     where id = r.id;

    insert into public.request_events
      (org_id, request_id, from_status, to_status, note, actor_email, at)
    values (r.org_id, r.id, 'NEW', 'NEW',
            case
              when target.manager_email is null
                then 'Nobody has answered this, and there is no manager named to tell'
              else 'Nobody has answered this — ' || target.manager_email || ' told'
            end,
            null, p_now);

    if target.manager_email is not null then
      insert into public.notifications
        (org_id, kind, subject, body, entity_type, entity_id)
      values (r.org_id, 'REQUEST_UNANSWERED',
              r.reference || ' has not been answered',
              r.title || E'\n\n'
                || r.unit_name || ' was asked '
                || round(extract(epoch from (p_now - r.created_at)) / 3600.0, 1)::text
                || ' hours ago and nobody has picked it up.',
              'REQUEST', r.id);
    end if;

    request_id := r.id;
    reference := r.reference;
    unit_name := r.unit_name;
    level := earned;
    told_email := target.manager_email;
    hours_waiting := round(extract(epoch from (p_now - r.created_at)) / 3600.0, 1);
    return next;
  end loop;
end;
$$;

revoke all on function public.chase_unanswered_requests(timestamptz, integer) from public;
grant execute on function public.chase_unanswered_requests(timestamptz, integer) to service_role;

-- The notification kind the sweep raises.
alter type notification_kind add value if not exists 'REQUEST_UNANSWERED';

comment on function public.escalation_chain(uuid) is
  'The managers to tell, from the unit upwards. Empty where no manager is named, which is a finding.';
comment on function public.chase_unanswered_requests(timestamptz, integer) is
  'One row per request chased. Takes the clock as a parameter so the boundaries can be tested.';
