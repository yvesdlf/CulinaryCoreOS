-- ---------------------------------------------------------------------------
-- Letting staff actually use the portal
-- ---------------------------------------------------------------------------
-- Three things 0041 left broken, all found by signing in as a commis chef and
-- trying to do the things the brief describes.
--
-- 1. mark_quiz_attempt() refuses anybody without write access to the venue,
--    which is every portal user. A member of staff could see the exam and
--    could not sit it. The rule should never have been "may write to the
--    organisation" — it is "this is your own paper, or you are marking
--    somebody else's".
--
-- 2. Signing up created a personal organisation for every member of staff.
--    handle_new_user() already skips that for somebody holding an invitation;
--    it should skip it for somebody who is already on the payroll too. A chef
--    signing in to see their rota should not become the owner of an empty
--    venue.
--
-- 3. A staff member could raise a leave request but not attach the sick note
--    to it, because leave_attachments needs the request to exist first and
--    nothing let them add one afterwards. Fixed by letting the owner of a
--    request that is still undecided attach to it.
-- ---------------------------------------------------------------------------

/*
 * Sit an exam, or mark somebody else's.
 *
 * Marked here rather than in the browser, and this is the whole reason the
 * function exists: the answers live in a table the candidate cannot read, so
 * the grading has to happen somewhere they cannot see. A score computed in
 * JavaScript is a score the candidate can edit.
 */
create or replace function public.mark_quiz_attempt(
  p_course uuid,
  p_employee uuid,
  p_answers jsonb,
  p_pass_mark numeric default 80
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  total integer; correct integer := 0; q record; given integer;
  pct numeric; target_org uuid; own boolean;
begin
  select e.org_id into target_org from public.employees e where e.id = p_employee;
  if target_org is null then raise exception 'employee not found'; end if;

  own := (p_employee = public.auth_employee_id());

  -- Your own paper, or you are entitled to record one for somebody else.
  if not own and not public.auth_can_write(target_org) then
    raise exception 'not allowed to record an attempt here';
  end if;

  -- And it must actually have been set for them, or anybody could sit — and
  -- pass — a course nobody asked them to do, and collect the certificate.
  if own and not exists (
    select 1 from public.training_assignments a
     where a.course_id = p_course and a.employee_id = p_employee
  ) then
    raise exception 'that course has not been assigned to you';
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

/*
 * Somebody already on the payroll is joining their venue, not starting one.
 *
 * Same reasoning as the invitation case 0025 added, and the same failure if it
 * is missing: an organisation nobody wanted, which then competes with the real
 * one in auth_default_org_id() and shows the wrong name in the header.
 */
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_org_id uuid;
  base_slug text;
  final_slug text;
  n int := 0;
begin
  -- Someone with an invitation waiting is joining a venue, not starting one.
  if exists (
    select 1 from public.organization_invitations i
     where lower(i.email) = lower(new.email)
       and i.accepted_at is null
       and i.revoked_at is null
       and i.expires_at > now()
  ) then
    return new;
  end if;

  -- And neither is somebody who already appears on a payroll.
  if exists (
    select 1 from public.employees e
     where e.work_email is not null
       and lower(e.work_email) = lower(new.email)
  ) then
    -- Link the account to the record while we are here, so the portal
    -- recognises them on their first sign-in rather than on their second.
    update public.employees e
       set user_id = new.id
     where lower(e.work_email) = lower(new.email)
       and e.user_id is null;
    return new;
  end if;

  base_slug := regexp_replace(lower(split_part(new.email, '@', 1)), '[^a-z0-9]+', '-', 'g');
  if base_slug is null or base_slug = '' then
    base_slug := 'org';
  end if;

  final_slug := base_slug;
  while exists (select 1 from public.organizations o where o.slug = final_slug) loop
    n := n + 1;
    final_slug := base_slug || '-' || n::text;
  end loop;

  insert into public.organizations (name, slug)
  values (coalesce(new.raw_user_meta_data ->> 'organization_name', base_slug), final_slug)
  returning id into new_org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_org_id, new.id, 'OWNER');

  return new;
end;
$$;

-- A sick note is attached after the request is raised, not with it.
drop policy if exists leave_attachments_own_insert on leave_attachments;
create policy leave_attachments_own_insert on leave_attachments
  for insert to authenticated
  with check (exists (
    select 1 from public.leave_requests l
     where l.id = leave_attachments.leave_request_id
       and l.employee_id = public.auth_employee_id()
       -- Only while it is still open. Adding evidence to a decision already
       -- made is how a record stops matching what was decided on.
       and l.status = 'REQUESTED'));

comment on function public.mark_quiz_attempt(uuid, uuid, jsonb, numeric) is
  'Marks an attempt where the candidate cannot see the answers. Own paper, or you may mark others.';
