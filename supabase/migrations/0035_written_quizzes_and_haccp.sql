-- ---------------------------------------------------------------------------
-- Written quiz answers, observation checklists, and HACCP control forms
-- ---------------------------------------------------------------------------
-- Shaped by Manuza's actual paperwork rather than by what was easy to build.
--
-- The real quizzes are written, not multiple choice: "Please write the correct
-- answer (1 point per question)", then things like "List 3 items in Sushi
-- Boat". A machine cannot mark that, and pretending otherwise would either
-- reject correct answers phrased differently or accept anything. So a question
-- is now either auto-marked or marked by a named person, and a written paper
-- sits unmarked until somebody marks it.
--
-- Each quiz is also paired with an Observation Checklist — a supervisor
-- watching someone do the job. That is a different assessment from a written
-- one and is recorded as such, because passing a paper about carrying three
-- plates is not the same as carrying three plates.
--
-- The HACCP forms are the venue's own control sheets: cleaning schedules,
-- hand-washing logs, cook and reheat temperatures, cooling, defrosting, sushi
-- rice pH, CCP monitoring, non-conformities, allergen testing, chemical
-- inventory. They are logs with a due rhythm, and the thing worth building is
-- not the form but the answer to "what has not been done".
-- ---------------------------------------------------------------------------

create type question_kind as enum ('MULTIPLE_CHOICE', 'WRITTEN');

alter table quiz_questions
  add column if not exists kind question_kind not null default 'MULTIPLE_CHOICE',
  -- What a good written answer contains, for whoever marks it. Not shown to
  -- the person taking the quiz.
  add column if not exists model_answer text,
  add column if not exists points integer not null default 1;

-- A written question has no options, so the existing constraints must relax.
alter table quiz_questions alter column options drop not null;
alter table quiz_questions alter column correct_index drop not null;
alter table quiz_questions drop constraint if exists quiz_questions_options;
alter table quiz_questions drop constraint if exists quiz_questions_correct;
alter table quiz_questions add constraint quiz_questions_shape check (
  (kind = 'MULTIPLE_CHOICE'
     and options is not null and cardinality(options) >= 2
     and correct_index between 0 and cardinality(options) - 1)
  or (kind = 'WRITTEN')
);

-- The model answer must never reach the person being tested.
revoke select on quiz_questions from authenticated;
grant select (id, org_id, course_id, prompt, options, sort_order, kind, points)
  on quiz_questions to authenticated;

/*
 * A written answer, and its mark.
 *
 * Separate rows rather than more JSON on the attempt, because each one is
 * marked individually by a person and needs to carry who marked it.
 */
create table if not exists quiz_written_answers (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  attempt_id uuid not null references quiz_attempts(id) on delete cascade,
  question_id uuid not null references quiz_questions(id) on delete cascade,

  answer text not null,
  awarded_points numeric(6,2),
  marker_comment text,
  marked_by_email text,
  marked_at timestamptz,

  constraint quiz_written_answers_unique unique (attempt_id, question_id)
);

alter table quiz_attempts
  -- A paper with written questions is not finished when it is handed in.
  add column if not exists awaiting_marking boolean not null default false;

/**
 * Mark the written answers on an attempt and settle its score.
 *
 * The marker cannot be the person who sat it. A quiz that decides whether
 * somebody may work a station is close enough to a review to deserve the same
 * rule as leave, time corrections and appraisals.
 */
create or replace function public.mark_written_answers(
  p_attempt uuid, p_marks jsonb, p_pass_mark numeric default 80
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_org uuid; subject_user uuid; the_course uuid; the_employee uuid;
  auto_correct numeric := 0; auto_total numeric := 0;
  written_awarded numeric := 0; written_total numeric := 0;
  pct numeric; q record; marker text;
begin
  select a.org_id, a.course_id, a.employee_id, e.user_id
    into target_org, the_course, the_employee, subject_user
    from public.quiz_attempts a
    join public.employees e on e.id = a.employee_id
   where a.id = p_attempt;
  if target_org is null then raise exception 'attempt not found'; end if;
  if not public.auth_can_write(target_org) then
    raise exception 'not allowed to mark here';
  end if;

  marker := coalesce(auth.jwt() ->> 'email', '');
  if subject_user is not null and subject_user = auth.uid() then
    raise exception 'a quiz cannot be marked by the person who sat it'
      using hint = 'Ask a supervisor to mark it.';
  end if;

  -- Award each written answer.
  for q in select id, question_id from public.quiz_written_answers
            where attempt_id = p_attempt loop
    update public.quiz_written_answers
       set awarded_points = coalesce((p_marks ->> q.question_id::text)::numeric, 0),
           marked_by_email = marker, marked_at = now()
     where id = q.id;
  end loop;

  select coalesce(sum(w.awarded_points), 0),
         coalesce(sum(qq.points), 0)
    into written_awarded, written_total
    from public.quiz_written_answers w
    join public.quiz_questions qq on qq.id = w.question_id
   where w.attempt_id = p_attempt;

  -- Whatever the auto-marked half already scored.
  select coalesce(count(*) filter (
           where (a.answers ->> qq.id::text)::integer = qq.correct_index), 0),
         coalesce(count(*), 0)
    into auto_correct, auto_total
    from public.quiz_attempts a
    join public.quiz_questions qq
      on qq.course_id = a.course_id and qq.kind = 'MULTIPLE_CHOICE'
   where a.id = p_attempt;

  pct := case when (auto_total + written_total) = 0 then 0
              else round(((auto_correct + written_awarded)
                          / (auto_total + written_total)) * 100, 2) end;

  update public.quiz_attempts
     set score = pct, passed = pct >= p_pass_mark, awaiting_marking = false
   where id = p_attempt;

  if pct >= p_pass_mark then
    update public.training_assignments
       set completed_on = current_date, score = pct, passed = true
     where course_id = the_course and employee_id = the_employee
       and completed_on is null;
  end if;

  return jsonb_build_object('score', pct, 'passed', pct >= p_pass_mark);
end;
$$;

grant execute on function public.mark_written_answers(uuid, jsonb, numeric) to authenticated;

-- ── Observation checklists ──────────────────────────────────────────────────
-- A supervisor watching somebody do the job, which is not the same assessment
-- as a paper about it.

create table if not exists observation_checklists (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  course_id uuid references training_courses(id) on delete set null,

  observed_on date not null default current_date,
  observer_email text not null,
  -- Each item: { "item": "...", "met": true, "note": "..." }
  items jsonb not null default '[]'::jsonb,
  overall_met boolean,
  comments text,

  created_at timestamptz not null default now()
);

create index if not exists idx_observation_checklists_employee
  on observation_checklists(employee_id, observed_on desc);

-- ── HACCP control forms ─────────────────────────────────────────────────────

create type haccp_frequency as enum (
  'PER_SHIFT', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'AS_NEEDED'
);

/*
 * The catalogue of forms this venue keeps, numbered as their own paperwork
 * numbers them so an inspector asking for "3.1" finds 3.1.
 */
create table if not exists haccp_forms (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  code text not null,          -- 1.1, 3.7, 4.5 …
  section text not null,       -- Facilities, Personal Hygiene, Temperature …
  title text not null,
  frequency haccp_frequency not null default 'DAILY',
  -- What the form asks for, so a completion can be checked against it.
  fields jsonb not null default '[]'::jsonb,
  -- Whether missing one is a critical control point failure or an oversight.
  is_ccp boolean not null default false,
  active boolean not null default true,

  created_at timestamptz not null default now()
);

create unique index if not exists idx_haccp_forms_code
  on haccp_forms(org_id, lower(code));

create table if not exists haccp_records (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  form_id uuid not null references haccp_forms(id) on delete cascade,

  covers_date date not null,
  shift text,
  location text,

  -- The filled-in form.
  values jsonb not null default '{}'::jsonb,
  -- Set when a reading is outside its limit — a fridge at 9 °C, a cook
  -- temperature under 75. The reason the record exists.
  breach boolean not null default false,
  breach_detail text,
  corrective_action text,

  completed_by_email text not null,
  completed_at timestamptz not null default now(),
  -- Countersigned by a supervisor, which several of these forms require.
  verified_by_email text,
  verified_at timestamptz,

  constraint haccp_records_unique unique (form_id, covers_date, shift, location)
);

create index if not exists idx_haccp_records_date
  on haccp_records(org_id, covers_date desc);
create index if not exists idx_haccp_records_breach
  on haccp_records(org_id, covers_date desc) where breach;

/*
 * A breach must carry a corrective action.
 *
 * Recording that the walk-in was at 9 °C and doing nothing about it is worse
 * than not recording it: it is evidence you knew.
 */
create or replace function public.enforce_haccp_breach()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.breach and btrim(coalesce(new.corrective_action, '')) = '' then
    raise exception 'a breach must record what was done about it'
      using hint = 'A recorded breach with no corrective action is evidence you knew.';
  end if;
  return new;
end;
$$;

create trigger haccp_records_enforce
  before insert or update on haccp_records
  for each row execute function public.enforce_haccp_breach();

/** What is due and not done, worst first. */
create or replace view haccp_outstanding as
  select
    f.id as form_id, f.org_id, f.code, f.section, f.title,
    f.frequency, f.is_ccp,
    (select max(r.covers_date) from public.haccp_records r where r.form_id = f.id)
      as last_completed,
    (current_date - coalesce(
      (select max(r.covers_date) from public.haccp_records r where r.form_id = f.id),
      current_date - 365)) as days_since
  from public.haccp_forms f
  where f.active and f.org_id in (select public.auth_org_ids());

grant select on haccp_outstanding to authenticated;

do $$
declare t text;
begin
  foreach t in array array['quiz_written_answers','observation_checklists',
                           'haccp_forms','haccp_records']
  loop
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

create trigger observation_checklists_set_org before insert on observation_checklists
  for each row execute function public.set_org_id();
create trigger haccp_forms_set_org before insert on haccp_forms
  for each row execute function public.set_org_id();

create or replace function public.set_haccp_record_org_id()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent_org uuid;
begin
  select f.org_id into parent_org from public.haccp_forms f where f.id = new.form_id;
  if parent_org is null then raise exception 'form not found'; end if;
  new.org_id := parent_org;
  return new;
end;
$$;

create trigger haccp_records_set_org before insert on haccp_records
  for each row execute function public.set_haccp_record_org_id();

create or replace function public.set_written_answer_org_id()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent_org uuid;
begin
  select a.org_id into parent_org from public.quiz_attempts a where a.id = new.attempt_id;
  if parent_org is null then raise exception 'attempt not found'; end if;
  new.org_id := parent_org;
  return new;
end;
$$;

create trigger quiz_written_answers_set_org before insert on quiz_written_answers
  for each row execute function public.set_written_answer_org_id();

-- ── Manuza's own control sheets ─────────────────────────────────────────────
-- Codes and titles taken from the venue's HACCP workbooks so an inspector
-- asking for 3.1 finds 3.1. Temperature and pH forms are marked as critical
-- control points; the rest are records.

insert into haccp_forms (org_id, code, section, title, frequency, is_ccp)
select o.id, f.code, f.section, f.title, f.freq::haccp_frequency, f.ccp
from organizations o
cross join (values
  ('1.1','Facilities','Cleaning Schedule Checklist','WEEKLY',false),
  ('1.2','Facilities','Cleaning Supplies Store Check','WEEKLY',false),
  ('2.1','Personal Hygiene','Grooming Standard Acknowledgement','ANNUAL',false),
  ('2.2','Personal Hygiene','Hand Washing Log','PER_SHIFT',false),
  ('2.3','Personal Hygiene','Steward Grooming Check','DAILY',false),
  ('3.1','Temperature','Cook & Reheat Temperature Record','PER_SHIFT',true),
  ('3.2','Temperature','Cooling Temperature Record','PER_SHIFT',true),
  ('3.3','Temperature','Defrosting Record','DAILY',true),
  ('3.4','Temperature','Dry Ager Temperature & Humidity','DAILY',true),
  ('3.5','Temperature','Food Transfer Traceability','DAILY',false),
  ('3.6','Temperature','Sushi Rice pH Record','PER_SHIFT',true),
  ('3.7','Temperature','Temperature Monitoring','PER_SHIFT',true),
  ('4.1','HACCP System','HACCP Team Member Register','ANNUAL',false),
  ('4.2','HACCP System','CCP Monitoring Record','DAILY',true),
  ('4.3','HACCP System','Food Area Visitor Form','AS_NEEDED',false),
  ('4.4','HACCP System','Food Recall Record','AS_NEEDED',true),
  ('4.5','HACCP System','Non-Conformity Record','AS_NEEDED',false),
  ('4.6','HACCP System','Planning of Change','AS_NEEDED',false),
  ('4.7','HACCP System','Food Waiver Form','AS_NEEDED',false),
  ('5.1','Allergens','Allergen Testing Log','MONTHLY',true),
  ('5.2','Allergens','Menu Allergen Matrix Review','QUARTERLY',true),
  ('6.1','Chemicals','Chemical Inventory','MONTHLY',false),
  ('6.2','Chemicals','Chemical List & Usage','QUARTERLY',false),
  ('6.3','Chemicals','Chemical Store Taking','MONTHLY',false)
) as f(code, section, title, freq, ccp)
on conflict do nothing;

comment on table haccp_forms is
  'The venue''s own control sheets, numbered as their paperwork numbers them.';
comment on table haccp_records is
  'A completed form. A breach must carry a corrective action, enforced by trigger.';
comment on function public.mark_written_answers(uuid, jsonb, numeric) is
  'Marks written answers. The marker cannot be the person who sat the quiz.';
