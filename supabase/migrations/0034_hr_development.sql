-- ---------------------------------------------------------------------------
-- Training, competency, performance and discipline
-- ---------------------------------------------------------------------------
-- The rest of the employee lifecycle, and the part where the HR brief is most
-- insistent about restraint.
--
-- Three positions, all enforced rather than intended.
--
--   Discipline is a restricted case, not a note on a profile. Only the people
--   named on a case may read it, plus owners. A grievance readable by whoever
--   opens the staff list is how an HR system becomes the thing people are
--   afraid of, and the brief calls this out specifically.
--
--   A review cannot be signed off by its own subject. Same reasoning as
--   approving your own leave or your own time correction, and it matters more
--   because a review decides pay and promotion.
--
--   Nothing here scores anybody automatically. A competency is assessed by a
--   named person against observable criteria with evidence; a quiz is marked
--   because the answers are known. There is no computed "talent score",
--   because the brief prohibits exactly that and it would be the first thing
--   somebody asked for.
-- ---------------------------------------------------------------------------

-- ── Training content ────────────────────────────────────────────────────────

create table if not exists training_courses (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  code text not null,
  title text not null,
  description text,
  -- What holding this course grants, so completing it can satisfy a job role's
  -- required certification rather than somebody typing the certificate twice.
  grants_certification text,
  -- How long the resulting certificate lasts. Null means it does not expire.
  valid_months integer,
  -- Content governance: an out-of-date SOP taught confidently is worse than
  -- none, so a course carries a version and an owner.
  version integer not null default 1,
  owner_email text,
  retired_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_training_courses_code
  on training_courses(org_id, lower(code));

create table if not exists training_assignments (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  course_id uuid not null references training_courses(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,

  assigned_on date not null default current_date,
  due_on date,
  completed_on date,
  score numeric(6,2),
  passed boolean,

  created_at timestamptz not null default now(),
  constraint training_assignments_unique unique (course_id, employee_id)
);

create index if not exists idx_training_assignments_open
  on training_assignments(org_id, due_on) where completed_on is null;

/*
 * Completing a course issues its certificate.
 *
 * Otherwise the training record and the certification record drift apart, and
 * the rota check — which reads certifications — keeps refusing somebody who
 * did the course last week.
 */
create or replace function public.issue_certificate_on_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare grants text; months integer;
begin
  if new.completed_on is null or coalesce(new.passed, true) = false then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.completed_on is not null then
    return null;
  end if;

  select c.grants_certification, c.valid_months into grants, months
    from public.training_courses c where c.id = new.course_id;
  if grants is null then return null; end if;

  insert into public.employee_certifications
    (org_id, employee_id, kind, reference, issued_on, expires_on)
  values (new.org_id, new.employee_id, grants,
          'Training ' || new.course_id::text, new.completed_on,
          case when months is null then null
               else new.completed_on + (months || ' months')::interval end);
  return null;
end;
$$;

create trigger training_assignments_issue_certificate
  after insert or update on training_assignments
  for each row execute function public.issue_certificate_on_completion();

-- ── Quizzes ─────────────────────────────────────────────────────────────────

create table if not exists quiz_questions (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  course_id uuid not null references training_courses(id) on delete cascade,

  prompt text not null,
  -- Options as an ordered array; the index of the right one is separate so a
  -- question can be shown without shipping its answer to the browser.
  options text[] not null,
  correct_index integer not null,
  explanation text,
  sort_order integer not null default 0,

  constraint quiz_questions_options check (cardinality(options) >= 2),
  constraint quiz_questions_correct
    check (correct_index >= 0 and correct_index < cardinality(options))
);

create index if not exists idx_quiz_questions_course
  on quiz_questions(course_id, sort_order);

create table if not exists quiz_attempts (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  course_id uuid not null references training_courses(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,

  answers jsonb not null default '[]'::jsonb,
  score numeric(6,2),
  passed boolean,
  attempted_at timestamptz not null default now()
);

create index if not exists idx_quiz_attempts_employee
  on quiz_attempts(employee_id, course_id, attempted_at desc);

/**
 * Mark an attempt.
 *
 * Server-side because the correct answers must never reach the browser: a
 * quiz marked in the client is a quiz anybody can pass by reading the page.
 */
create or replace function public.mark_quiz_attempt(
  p_course uuid, p_employee uuid, p_answers jsonb, p_pass_mark numeric default 80
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  total integer; correct integer := 0; q record; given integer;
  pct numeric; target_org uuid;
begin
  select e.org_id into target_org from public.employees e where e.id = p_employee;
  if target_org is null then raise exception 'employee not found'; end if;
  if not public.auth_can_write(target_org) then
    raise exception 'not allowed to record an attempt here';
  end if;

  select count(*) into total from public.quiz_questions where course_id = p_course;
  if total = 0 then raise exception 'that course has no questions'; end if;

  for q in select id, correct_index from public.quiz_questions
            where course_id = p_course loop
    given := (p_answers ->> q.id::text)::integer;
    if given is not null and given = q.correct_index then
      correct := correct + 1;
    end if;
  end loop;

  pct := round((correct::numeric / total) * 100, 2);

  insert into public.quiz_attempts
    (org_id, course_id, employee_id, answers, score, passed)
  values (target_org, p_course, p_employee, p_answers, pct, pct >= p_pass_mark);

  -- A pass completes the assignment, which issues the certificate.
  if pct >= p_pass_mark then
    update public.training_assignments
       set completed_on = current_date, score = pct, passed = true
     where course_id = p_course and employee_id = p_employee
       and completed_on is null;
  end if;

  return jsonb_build_object(
    'score', pct, 'correct', correct, 'total', total, 'passed', pct >= p_pass_mark);
end;
$$;

grant execute on function public.mark_quiz_attempt(uuid, uuid, jsonb, numeric) to authenticated;

-- ── Competency ──────────────────────────────────────────────────────────────

create table if not exists competencies (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  -- What "good" looks like, in words somebody can be measured against. A
  -- competency without observable criteria is an opinion with a job title.
  criteria text not null,
  job_role_id uuid references job_roles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_competencies_name
  on competencies(org_id, lower(name));

create table if not exists competency_assessments (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  competency_id uuid not null references competencies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,

  -- 1 learning, 2 doing with support, 3 independent, 4 teaching others.
  level integer not null,
  evidence text,
  assessed_by_email text not null,
  assessed_on date not null default current_date,

  constraint competency_assessments_level check (level between 1 and 4),
  constraint competency_assessments_evidence check (btrim(coalesce(evidence,'')) <> '')
);

create index if not exists idx_competency_assessments
  on competency_assessments(employee_id, assessed_on desc);

-- ── Performance reviews ─────────────────────────────────────────────────────

create type review_status as enum ('DRAFT', 'SELF_REVIEW', 'MANAGER_REVIEW', 'COMPLETE');

create table if not exists performance_reviews (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,

  period_start date not null,
  period_end date not null,
  kind text not null default 'ANNUAL',   -- PROBATION | 30_60_90 | QUARTERLY | ANNUAL

  status review_status not null default 'DRAFT',
  self_comments text,
  manager_comments text,
  -- Deliberately no numeric rating. The brief prohibits opaque scoring, and a
  -- number invites ranking people against each other rather than against what
  -- the job asks.
  agreed_actions text,

  reviewer_email text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint performance_reviews_period check (period_end >= period_start)
);

create index if not exists idx_performance_reviews_employee
  on performance_reviews(employee_id, period_end desc);

/*
 * A review cannot be completed by the person it is about.
 *
 * Same reasoning as leave and time corrections, and it matters more: a review
 * decides pay and promotion.
 */
create or replace function public.enforce_review_signoff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare subject_user uuid;
begin
  if new.status <> 'COMPLETE' or old.status = 'COMPLETE' then
    return new;
  end if;
  if new.reviewer_email is null then
    raise exception 'a completed review must record who reviewed it';
  end if;

  select e.user_id into subject_user
    from public.employees e where e.id = new.employee_id;

  if subject_user is not null and subject_user = auth.uid() then
    raise exception 'a review cannot be completed by the person it is about'
      using hint = 'Segregation of duties: a review decides pay and promotion.';
  end if;

  if new.completed_at is null then new.completed_at := now(); end if;
  return new;
end;
$$;

create trigger performance_reviews_enforce
  before update on performance_reviews
  for each row execute function public.enforce_review_signoff();

-- ── Discipline and grievances ───────────────────────────────────────────────

create type case_kind as enum ('CONDUCT', 'PERFORMANCE', 'GRIEVANCE', 'INVESTIGATION', 'RECOGNITION');
create type case_status as enum ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'WITHDRAWN', 'ESCALATED');

/*
 * A restricted case, not a note on a profile.
 *
 * The access model here is narrower than anything else in the system, on
 * purpose. A grievance readable by whoever opens the staff list is how an HR
 * system becomes the thing people are afraid of.
 */
create table if not exists hr_cases (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,

  reference text not null,
  kind case_kind not null,
  status case_status not null default 'OPEN',
  summary text not null,
  detail text,
  outcome text,

  opened_by_email text,
  opened_on date not null default current_date,
  closed_on date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_hr_cases_reference
  on hr_cases(org_id, lower(reference));

-- Who may see a case. Everybody else, including other admins, may not.
create table if not exists hr_case_participants (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  case_id uuid not null references hr_cases(id) on delete cascade,
  user_id uuid,
  email text not null,
  role text not null default 'PARTICIPANT',   -- OWNER | PARTICIPANT | WITNESS
  added_at timestamptz not null default now()
);

-- A unique INDEX, not a constraint: a constraint cannot be built on an
-- expression, and lower(email) is one.
create unique index if not exists idx_hr_case_participants_unique
  on hr_case_participants(case_id, lower(email));
create index if not exists idx_hr_case_participants_user
  on hr_case_participants(user_id);

/** Whether the caller may see this case. */
create or replace function public.can_see_case(p_case uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.hr_case_participants p
     where p.case_id = p_case
       and (p.user_id = auth.uid()
            or lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  )
  -- An owner can always reach a case, because somebody has to be able to when
  -- the participants have left. It is a deliberate, single exception.
  or exists (
    select 1 from public.organization_members m
     join public.hr_cases c on c.org_id = m.organization_id
    where c.id = p_case and m.user_id = auth.uid() and m.role = 'OWNER'
  );
$$;

grant execute on function public.can_see_case(uuid) to authenticated;

-- ── Tenancy ─────────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['training_courses','training_assignments','quiz_questions',
                           'quiz_attempts','competencies','competency_assessments',
                           'performance_reviews']
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
    execute format(
      'create policy %1$s_delete on %1$I for delete to authenticated
         using (public.auth_can_write(org_id))', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

-- The correct answers are not readable by the people taking the quiz. The
-- marking function is SECURITY DEFINER and reads them; nobody else can.
revoke select on quiz_questions from authenticated;
grant select (id, org_id, course_id, prompt, options, sort_order)
  on quiz_questions to authenticated;

create trigger hr_cases_set_org before insert on hr_cases
  for each row execute function public.set_org_id();

create or replace function public.set_case_participant_org_id()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent_org uuid;
begin
  select c.org_id into parent_org from public.hr_cases c where c.id = new.case_id;
  if parent_org is null then raise exception 'case not found'; end if;
  new.org_id := parent_org;
  return new;
end;
$$;

create trigger hr_case_participants_set_org before insert on hr_case_participants
  for each row execute function public.set_case_participant_org_id();

alter table hr_cases enable row level security;
alter table hr_case_participants enable row level security;

create policy hr_cases_read on hr_cases
  for select to authenticated
  using (org_id in (select public.auth_org_ids()) and public.can_see_case(id));
create policy hr_cases_insert on hr_cases
  for insert to authenticated with check (public.auth_can_write(org_id));
create policy hr_cases_update on hr_cases
  for update to authenticated
  using (public.can_see_case(id)) with check (public.can_see_case(id));

create policy hr_case_participants_read on hr_case_participants
  for select to authenticated using (public.can_see_case(case_id));
create policy hr_case_participants_insert on hr_case_participants
  for insert to authenticated with check (public.auth_can_write(org_id));

grant select, insert, update on hr_cases to authenticated;
grant select, insert on hr_case_participants to authenticated;

comment on table hr_cases is
  'Restricted. Readable only by named participants and organisation owners.';
comment on table performance_reviews is
  'No numeric rating on purpose: the brief prohibits opaque scoring.';
comment on function public.mark_quiz_attempt(uuid, uuid, jsonb, numeric) is
  'Marks server-side. The correct answers never reach the browser.';
