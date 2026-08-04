-- ---------------------------------------------------------------------------
-- The staff portal
-- ---------------------------------------------------------------------------
-- Everyone who works here gets an account. What they can see through it is
-- their own working life and nothing else: what has been sent to them, the
-- training they have been given, their rota, their leave, their hours.
--
-- The central decision, and the one everything else follows from: a staff
-- account is NOT an organisation member.
--
-- This is the vendor portal's position and it is right for the same reason. If
-- a commis chef were a member, `auth_org_ids()` would include the venue and
-- every existing read policy in the database — two hundred and sixty of them —
-- would return rows. Supplier prices, other people's salaries, the HR case
-- file about them. Making that safe would mean auditing every policy and
-- getting all of them right; making it safe *by default* means the caller has
-- no membership at all, so every existing policy already denies them and
-- access exists only where this migration builds a door.
--
-- The brief asks that general staff have no access to the rest of the app
-- "unless granted by the IT manager". That composes exactly: granting access is
-- adding them to organization_members and setting section rights in
-- Administration. Until somebody does, they are a portal user and nothing else.
--
-- Three things here are not obvious and are deliberate:
--
--   The quiz view never selects correct_index. A person sitting an exam must
--   not be able to read the answers out of the API that renders it, and the
--   reliable way to guarantee that is for the answers never to appear in
--   anything they can select from.
--
--   A clock-in carries where it happened. Geofencing is off until a venue
--   draws a fence, because a venue with no fence should not be unable to
--   clock anybody in.
--
--   A sick note is a medical record. It goes in a private bucket, readable by
--   the person it belongs to and by HR, and never by "everyone in the org".
-- ---------------------------------------------------------------------------

-- ── Who is this? ────────────────────────────────────────────────────────────
/*
 * The employee record for the signed-in user.
 *
 * Matched on user_id, and falling back to a verified work email so an account
 * created before the employee record was linked still resolves. SECURITY
 * DEFINER because the caller has no rights on employees at all — that is the
 * point.
 */
create or replace function public.auth_employee_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.employees e
  where e.user_id = (select auth.uid())
     or (e.work_email is not null
         and lower(e.work_email) = lower(coalesce((select auth.jwt() ->> 'email'), '')))
  order by (e.user_id = (select auth.uid())) desc
  limit 1;
$$;

create or replace function public.auth_employee_org()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.org_id from public.employees e where e.id = public.auth_employee_id();
$$;

grant execute on function public.auth_employee_id() to authenticated;
grant execute on function public.auth_employee_org() to authenticated;

-- ── What was sent to them ───────────────────────────────────────────────────

create type staff_document_kind as enum (
  'NEWSLETTER',   -- what is happening at the venue
  'ROTA',         -- the week's rota, published as a document
  'TRAINING',     -- material to read before an exam
  'POLICY',       -- something they must acknowledge having read
  'PAYSLIP',      -- issued individually
  'OTHER'
);

create table if not exists staff_documents (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  kind staff_document_kind not null default 'NEWSLETTER',
  title text not null,
  body text,
  -- A file in the staff-documents bucket. Null for a document that is only
  -- the words above.
  file_path text,
  file_name text,
  -- Training material belongs to a course, so reading it and sitting its exam
  -- are the same journey rather than two unrelated screens.
  course_id uuid references training_courses(id) on delete set null,

  -- An acknowledgement is evidence. A venue needs to show an inspector that
  -- the allergen policy was issued and read, not that it was emailed.
  requires_acknowledgement boolean not null default false,

  published_at timestamptz,
  published_by_email text,
  created_at timestamptz not null default now(),

  constraint staff_documents_title check (btrim(title) <> '')
);

create index if not exists idx_staff_documents_org
  on staff_documents(org_id, published_at desc);

/*
 * Who it went to.
 *
 * A row per recipient rather than a broadcast flag, because "did Budi read the
 * allergen policy" is the question that gets asked, and a broadcast cannot
 * answer it.
 */
create table if not exists staff_document_recipients (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  document_id uuid not null references staff_documents(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,

  read_at timestamptz,
  acknowledged_at timestamptz,

  constraint staff_document_recipients_unique unique (document_id, employee_id)
);

create index if not exists idx_staff_document_recipients_employee
  on staff_document_recipients(employee_id, read_at);

-- ── Sick notes and other evidence ───────────────────────────────────────────

create table if not exists leave_attachments (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  leave_request_id uuid not null references leave_requests(id) on delete cascade,

  -- Path in the private sick-notes bucket.
  file_path text not null,
  file_name text,
  content_type text,
  uploaded_by_email text,
  uploaded_at timestamptz not null default now()
);

create index if not exists idx_leave_attachments_request
  on leave_attachments(leave_request_id);

-- ── Geofenced clocking ──────────────────────────────────────────────────────

create table if not exists venue_geofences (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  latitude numeric(10,7) not null,
  longitude numeric(10,7) not null,
  -- Metres. Generous by default: GPS indoors is bad, and a fence tight enough
  -- to be meaningful is tight enough to stop somebody clocking in from the
  -- staff entrance.
  radius_m integer not null default 150,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),

  constraint venue_geofences_radius check (radius_m between 20 and 5000)
);

alter table time_entries add column if not exists latitude numeric(10,7);
alter table time_entries add column if not exists longitude numeric(10,7);
alter table time_entries add column if not exists accuracy_m numeric(8,2);
alter table time_entries add column if not exists outside_geofence boolean not null default false;

/*
 * Distance between two points on the earth, in metres.
 *
 * The haversine formula. PostGIS would be the right tool and is a heavy
 * dependency for one distance check; at these ranges the difference between
 * this and a proper geodesic is centimetres.
 */
create or replace function public.metres_between(
  lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round((6371000 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) *
    power(sin(radians(lon2 - lon1) / 2), 2)
  )))::numeric, 1);
$$;

/*
 * A clock-in happens at the venue.
 *
 * Refused outright rather than flagged, because a warning nobody reads is not
 * a control and the whole point is that hours are what payroll is calculated
 * from. Three deliberate exemptions:
 *
 *   No fence drawn, or none enabled — geofencing is opt-in per venue.
 *   No coordinates supplied — a browser that refuses location, or a kiosk
 *   without it. Recorded as outside_geofence so it is visible rather than
 *   silently trusted.
 *   Entered by a manager on somebody's behalf, which is the documented way to
 *   fix a phone that had no signal.
 */
create or replace function public.enforce_geofence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  nearest numeric;
  fence record;
begin
  if new.source = 'MANAGER' then
    return new;
  end if;

  if not exists (
    select 1 from public.venue_geofences g
     where g.org_id = new.org_id and g.enabled
  ) then
    return new;
  end if;

  if new.latitude is null or new.longitude is null then
    new.outside_geofence := true;
    return new;
  end if;

  select g.*, public.metres_between(g.latitude, g.longitude, new.latitude, new.longitude) as away
    into fence
    from public.venue_geofences g
   where g.org_id = new.org_id and g.enabled
   order by public.metres_between(g.latitude, g.longitude, new.latitude, new.longitude)
   limit 1;

  nearest := fence.away;

  if nearest > fence.radius_m then
    raise exception 'you are % m from %, which is outside the % m clocking area',
      round(nearest), fence.name, fence.radius_m
      using hint = 'Clock in at the venue, or ask a manager to enter it for you.';
  end if;

  new.outside_geofence := false;
  return new;
end;
$$;

drop trigger if exists time_entries_geofence on time_entries;
create trigger time_entries_geofence
  before insert on time_entries
  for each row execute function public.enforce_geofence();

-- ── An exam result reaches the people who need it ───────────────────────────

alter table notifications add column if not exists employee_id uuid
  references employees(id) on delete cascade;

create index if not exists idx_notifications_employee
  on notifications(employee_id, read_at);

/*
 * When an attempt is marked, tell HR and the person's own manager.
 *
 * The brief asks for both, and they are different audiences: HR keeps the
 * training record, and the line manager is the one who has to decide whether
 * somebody works the section tomorrow. A manager who finds out at the next
 * quarterly review has found out too late to act on it.
 */
create or replace function public.notify_exam_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  emp record;
  course_title text;
  manager_employee uuid;
  verdict text;
begin
  -- Only once a result exists, and only when it has just arrived.
  if new.score is null or new.awaiting_marking then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.score is not null and not old.awaiting_marking then
    return new;
  end if;

  select e.first_name, e.last_name, e.manager_id into emp
    from public.employees e where e.id = new.employee_id;
  select c.title into course_title
    from public.training_courses c where c.id = new.course_id;

  manager_employee := emp.manager_id;
  verdict := case when new.passed then 'passed' else 'did not pass' end;

  -- HR, by role.
  perform public.notify(
    new.org_id, 'TRAINING'::public.notification_kind,
    format('%s %s %s %s', emp.first_name, emp.last_name, verdict, coalesce(course_title, 'a course')),
    format('Scored %s%%.', round(new.score)),
    'ADMIN'::public.org_role, null, 'quiz_attempt', new.id);

  -- And the line manager, by name.
  if manager_employee is not null then
    insert into public.notifications
      (org_id, kind, subject, body, employee_id, entity_type, entity_id)
    values (
      new.org_id, 'TRAINING'::public.notification_kind,
      format('%s %s %s %s', emp.first_name, emp.last_name, verdict, coalesce(course_title, 'a course')),
      format('Scored %s%%. You are their line manager.', round(new.score)),
      manager_employee, 'quiz_attempt', new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists quiz_attempts_notify on quiz_attempts;
create trigger quiz_attempts_notify
  after insert or update on quiz_attempts
  for each row execute function public.notify_exam_result();

-- ── Tenancy for the new tables ──────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['staff_documents','staff_document_recipients',
                           'leave_attachments','venue_geofences']
  loop
    execute format('create trigger %1$s_set_org before insert on %1$I
                      for each row execute function public.set_org_id()', t);
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %1$s_read on %1$I for select to authenticated
         using (org_id in (select public.auth_org_ids()))', t);
    execute format(
      'create policy %1$s_insert on %1$I for insert to authenticated
         with check (public.auth_can_write(org_id))', t);
    execute format(
      'create policy %1$s_update on %1$I for update to authenticated
         using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id))', t);
    execute format('grant select, insert, update on %I to authenticated', t);
  end loop;
end $$;

grant delete on staff_documents, staff_document_recipients, venue_geofences to authenticated;
create policy staff_documents_delete on staff_documents
  for delete to authenticated using (public.auth_can_write(org_id));
create policy staff_document_recipients_delete on staff_document_recipients
  for delete to authenticated using (public.auth_can_write(org_id));
create policy venue_geofences_delete on venue_geofences
  for delete to authenticated using (public.auth_can_write(org_id));

-- Sending a document and drawing a fence are HR and administration acts.
create trigger staff_documents_section_guard
  before insert or update or delete on staff_documents
  for each row execute function public.require_section_write('PEOPLE');
create trigger venue_geofences_section_guard
  before insert or update or delete on venue_geofences
  for each row execute function public.require_section_write('PARAMETERS');

-- ── The doors a portal user comes through ───────────────────────────────────
/*
 * Every policy below is scoped to auth_employee_id() and nothing else. A staff
 * account is not a member, so without these it can read nothing at all — which
 * is the safe direction to be wrong in.
 */

create policy staff_documents_own on staff_documents
  for select to authenticated
  using (exists (
    select 1 from public.staff_document_recipients r
     where r.document_id = staff_documents.id
       and r.employee_id = public.auth_employee_id()));

create policy staff_document_recipients_own on staff_document_recipients
  for select to authenticated
  using (employee_id = public.auth_employee_id());

-- Marking something read or acknowledged is the recipient's own act.
create policy staff_document_recipients_own_update on staff_document_recipients
  for update to authenticated
  using (employee_id = public.auth_employee_id())
  with check (employee_id = public.auth_employee_id());

create policy employees_own on employees
  for select to authenticated
  using (id = public.auth_employee_id());

create policy leave_requests_own on leave_requests
  for select to authenticated
  using (employee_id = public.auth_employee_id());

create policy leave_requests_own_insert on leave_requests
  for insert to authenticated
  with check (employee_id = public.auth_employee_id());

create policy leave_attachments_own on leave_attachments
  for select to authenticated
  using (exists (
    select 1 from public.leave_requests l
     where l.id = leave_attachments.leave_request_id
       and l.employee_id = public.auth_employee_id()));

create policy leave_attachments_own_insert on leave_attachments
  for insert to authenticated
  with check (exists (
    select 1 from public.leave_requests l
     where l.id = leave_attachments.leave_request_id
       and l.employee_id = public.auth_employee_id()));

create policy shifts_own on shifts
  for select to authenticated
  using (employee_id = public.auth_employee_id() and status = 'PUBLISHED');

create policy time_entries_own on time_entries
  for select to authenticated
  using (employee_id = public.auth_employee_id());

create policy time_entries_own_insert on time_entries
  for insert to authenticated
  with check (employee_id = public.auth_employee_id());

-- Clocking out is the one update a person makes to their own punch; the
-- immutability trigger from 0026 still governs what may change.
create policy time_entries_own_update on time_entries
  for update to authenticated
  using (employee_id = public.auth_employee_id())
  with check (employee_id = public.auth_employee_id());

create policy training_assignments_own on training_assignments
  for select to authenticated
  using (employee_id = public.auth_employee_id());

create policy training_courses_assigned on training_courses
  for select to authenticated
  using (exists (
    select 1 from public.training_assignments a
     where a.course_id = training_courses.id
       and a.employee_id = public.auth_employee_id()));

create policy quiz_attempts_own on quiz_attempts
  for select to authenticated
  using (employee_id = public.auth_employee_id());

create policy quiz_attempts_own_insert on quiz_attempts
  for insert to authenticated
  with check (employee_id = public.auth_employee_id());

create policy notifications_own on notifications
  for select to authenticated
  using (employee_id = public.auth_employee_id());

create policy leave_types_readable on leave_types
  for select to authenticated
  using (org_id = public.auth_employee_org());

create policy employee_certifications_own on employee_certifications
  for select to authenticated
  using (employee_id = public.auth_employee_id());

/*
 * The exam, without its answers.
 *
 * quiz_questions carries correct_index and model_answer, and the person
 * sitting the paper must not be able to read either. There is no policy on
 * quiz_questions for them at all — this view is the only way in, and it does
 * not select those columns, so no policy mistake can expose them.
 */
create or replace view my_exam_questions as
  select
    q.id,
    q.course_id,
    q.prompt,
    q.options,
    q.kind,
    q.points,
    q.sort_order
  from public.quiz_questions q
  where exists (
    select 1 from public.training_assignments a
     where a.course_id = q.course_id
       and a.employee_id = public.auth_employee_id()
  )
  order by q.sort_order;

grant select on my_exam_questions to authenticated;

/** Who this account is, for the portal to greet and scope itself. */
create or replace view my_profile as
  select
    e.id as employee_id,
    e.org_id,
    o.name as venue_name,
    e.employee_number,
    e.first_name,
    e.last_name,
    e.work_email,
    e.employment_status,
    d.name as department,
    j.title as job_title,
    m.first_name || ' ' || m.last_name as manager_name
  from public.employees e
  join public.organizations o on o.id = e.org_id
  left join public.departments d on d.id = e.department_id
  left join public.job_roles j on j.id = e.job_role_id
  left join public.employees m on m.id = e.manager_id
  where e.id = public.auth_employee_id();

grant select on my_profile to authenticated;

comment on function public.auth_employee_id() is
  'The employee record for the signed-in user. A staff account is not an org member.';
comment on table staff_documents is
  'What HR sends staff: newsletters, rotas, training material, policies to acknowledge.';
comment on view my_exam_questions is
  'An exam without its answers. The only route a candidate has to the questions.';
comment on column time_entries.outside_geofence is
  'True when the punch had no location, or was accepted before a fence existed.';
