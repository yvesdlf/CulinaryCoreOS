-- ---------------------------------------------------------------------------
-- Let the section guard stand aside for portal users
-- ---------------------------------------------------------------------------
-- The reasoning is in 0044's header; the enum values it adds have to be
-- committed before anything can reference them, which is why this is a
-- separate file.
-- ---------------------------------------------------------------------------

create or replace function public.require_section_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  section text := tg_argv[0];
  row_org uuid;
begin
  -- No session means a cascade, a migration, or an administrator with direct
  -- database access; the same reasoning as the membership guard.
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  row_org := coalesce(
    (to_jsonb(new) ->> 'org_id')::uuid,
    (to_jsonb(old) ->> 'org_id')::uuid,
    public.auth_default_org_id());

  /*
   * Somebody who is not a member of this venue is not governed by the section
   * model at all. That is the staff portal: a chef has no membership and no
   * section grant by design, and their access is the row-level policies added
   * in 0041, every one of which is scoped to their own employee record.
   *
   * Refusing them here refused a chef their own clock-in, using a message
   * about edit access to a section they are not supposed to know exists.
   */
  if not exists (
    select 1 from public.organization_members m
     where m.user_id = auth.uid() and m.organization_id = row_org
  ) then
    return coalesce(new, old);
  end if;

  if not public.can_write_section(section, row_org) then
    raise exception 'you do not have edit access to %',
      coalesce((select s.name from public.app_sections s where s.code = section), section)
      using hint = 'Ask an administrator for edit rights to this section.';
  end if;
  return coalesce(new, old);
end;
$$;

/*
 * The exam result notice, with a kind that exists.
 *
 * Both audiences the brief asks for: HR keeps the training record, and the
 * line manager is the one deciding whether somebody works the section
 * tomorrow. A manager who learns of a failed food-safety exam at the next
 * quarterly review has learned it too late to act on.
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
  verdict text;
begin
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

  verdict := case when new.passed then 'passed' else 'did not pass' end;

  perform public.notify(
    new.org_id, 'EXAM_MARKED'::public.notification_kind,
    format('%s %s %s %s', emp.first_name, emp.last_name, verdict,
           coalesce(course_title, 'a course')),
    format('Scored %s%%.', round(new.score)),
    'ADMIN'::public.org_role, null, 'quiz_attempt', new.id);

  if emp.manager_id is not null then
    insert into public.notifications
      (org_id, kind, subject, body, employee_id, entity_type, entity_id)
    values (
      new.org_id, 'EXAM_MARKED'::public.notification_kind,
      format('%s %s %s %s', emp.first_name, emp.last_name, verdict,
             coalesce(course_title, 'a course')),
      format('Scored %s%%. You are their line manager.', round(new.score)),
      emp.manager_id, 'quiz_attempt', new.id);
  end if;

  return new;
end;
$$;
