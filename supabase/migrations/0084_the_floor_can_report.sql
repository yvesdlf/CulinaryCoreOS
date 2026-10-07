-- ---------------------------------------------------------------------------
-- 0084 · The floor can report, check and clean from the staff portal
-- ---------------------------------------------------------------------------
-- Staff-portal users are not members of the venue (AGENTS.md §7), so every
-- policy denies them by default and a door exists only where a migration opens
-- one. Until now the portal opened their rota, leave, training and inbox, and
-- nothing else: a porter could not report a leaking fridge, a commis could not
-- log a fridge temperature, a room attendant could not mark a room clean. The
-- kitchen review ranked that first among the reasons a pilot venue would give
-- up in its first week.
--
-- Three doors, each a definer function that asks one question first — is the
-- caller an employee of this venue — and then does one job, and a few views
-- that show the caller only their own share. Nothing here widens a table
-- policy: a non-member still cannot read or write any table directly.
--
--   raise_my_request   the shared front door (0066), as the employee
--   record_my_check    a HACCP record; the breach is decided here, from the
--                      form's own limits, not by the screen
--   start_my_room /    the attendant's own assigned rooms; finishing marks
--   finish_my_room     the room clean, unless an urgent job blocks it
--   inspect_room       somebody else's finished room, never your own
--
-- Tests: supabase/tests/30_portal_frontline.sql.
-- ---------------------------------------------------------------------------

-- The employee behind the session, or a refusal. Every door starts here.
create or replace function public.require_employee()
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare me uuid := public.auth_employee_id();
begin
  if me is null then
    raise exception 'this is for staff of the venue: no staff record is linked to this login'
      using errcode = '42501',
            hint = 'Ask your manager to add your work email to your staff record.';
  end if;
  return me;
end;
$$;

-- ── 1 · Requests ─────────────────────────────────────────────────────────────

create or replace view public.my_request_types as
select t.id, t.name, t.description, t.default_priority,
       t.to_unit_id, b.name as unit_name
  from public.request_types t
  left join public.business_units b on b.id = t.to_unit_id
 where t.org_id = public.auth_employee_org()
   and t.active;

create or replace view public.my_requests as
select r.id, r.reference, r.title, r.detail, r.status, r.priority,
       r.created_at, r.resolution, b.name as unit_name
  from public.requests r
  left join public.business_units b on b.id = r.business_unit_id
 where r.raised_by_employee_id = public.auth_employee_id();

create or replace function public.raise_my_request(
  p_type uuid, p_title text, p_detail text default null, p_priority text default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  me uuid := public.require_employee();
  new_id uuid;
begin
  if not exists (select 1 from public.request_types t
                  where t.id = p_type and t.org_id = public.auth_employee_org() and t.active) then
    raise exception 'that kind of request is not one this venue takes';
  end if;
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'say what the request is about';
  end if;

  -- Department, venue, number and response time come from the type and the
  -- triggers (0066); the raiser comes from the session.
  insert into public.requests (request_type_id, title, detail, priority,
                               raised_by_employee_id, raised_by_email)
  values (p_type, btrim(p_title), nullif(btrim(p_detail), ''),
          nullif(p_priority, '')::public.work_order_priority,
          me, auth.jwt() ->> 'email')
  returning id into new_id;
  return new_id;
end;
$$;

-- ── 2 · HACCP checks ─────────────────────────────────────────────────────────

/*
 * The forms of the employee's venue, and of their own department where a form
 * belongs to one.
 */
create or replace view public.my_haccp_forms as
select f.id, f.code, f.title, f.section, f.frequency, f.fields, f.is_ccp
  from public.haccp_forms f
 where f.org_id = public.auth_employee_org()
   and f.active
   and (f.business_unit_id is null
        or f.business_unit_id = (select e.business_unit_id from public.employees e
                                  where e.id = public.auth_employee_id()));

create or replace view public.my_checks_today as
select r.id, r.form_id, f.title, r.completed_at, r.breach, r.breach_detail
  from public.haccp_records r
  join public.haccp_forms f on f.id = r.form_id
 where r.org_id = public.auth_employee_org()
   and r.covers_date = current_date
   and lower(r.completed_by_email) = lower(coalesce(auth.jwt() ->> 'email', ''));

/*
 * The breach is worked out here, from the limits on the form, and not taken
 * from the screen: a reading outside its limit is a breach whether or not the
 * person typing it says so. Each one is written out — "Fridge 2 read 9 °C,
 * above its limit of 5 °C" — because that is what an inspector reads.
 */
create or replace function public.record_my_check(
  p_form uuid, p_values jsonb,
  p_shift text default null, p_location text default null,
  p_corrective_action text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  me uuid := public.require_employee();
  form record;
  field jsonb;
  raw text;
  reading numeric;
  unit text;
  problems text[] := '{}';
  new_id uuid;
begin
  select f.* into form from public.my_haccp_forms f where f.id = p_form;
  if form is null then
    raise exception 'that check is not one set for you';
  end if;

  for field in select * from jsonb_array_elements(coalesce(form.fields, '[]'::jsonb)) loop
    continue when field ->> 'type' <> 'number';
    raw := btrim(coalesce(p_values ->> (field ->> 'label'), ''));
    continue when raw = '';
    begin
      reading := replace(raw, ',', '.')::numeric;
    exception when others then
      raise exception '% must be a number, not "%"', field ->> 'label', raw;
    end;
    unit := coalesce(' ' || nullif(field ->> 'unit', ''), '');
    if field ->> 'min' is not null and reading < (field ->> 'min')::numeric then
      problems := problems || format('%s read %s%s, below its limit of %s%s',
        field ->> 'label', reading, unit, field ->> 'min', unit);
    elsif field ->> 'max' is not null and reading > (field ->> 'max')::numeric then
      problems := problems || format('%s read %s%s, above its limit of %s%s',
        field ->> 'label', reading, unit, field ->> 'max', unit);
    end if;
  end loop;

  -- enforce_haccp_breach refuses a breach without a corrective action; the
  -- same rule, said before the insert so the message names the reading.
  if coalesce(array_length(problems, 1), 0) > 0 and coalesce(btrim(p_corrective_action), '') = '' then
    raise exception 'out of limits: %. Say what you did about it.', array_to_string(problems, '; ')
      using hint = 'A recorded breach with no corrective action is evidence you knew.';
  end if;

  insert into public.haccp_records (org_id, form_id, covers_date, shift, location, values,
                                    breach, breach_detail, corrective_action,
                                    completed_by_email, business_unit_id)
  values (public.auth_employee_org(), p_form, current_date,
          nullif(p_shift, ''), nullif(p_location, ''), coalesce(p_values, '{}'::jsonb),
          coalesce(array_length(problems, 1), 0) > 0,
          nullif(array_to_string(problems, '; '), ''),
          nullif(btrim(p_corrective_action), ''),
          coalesce(auth.jwt() ->> 'email', 'unknown'),
          (select f.business_unit_id from public.haccp_forms f where f.id = p_form))
  returning id into new_id;

  return jsonb_build_object('id', new_id,
                            'breach', coalesce(array_length(problems, 1), 0) > 0,
                            'detail', array_to_string(problems, '; '));
end;
$$;

-- ── 3 · Rooms ───────────────────────────────────────────────────────────────

create or replace view public.my_rooms as
select t.id as task_id, t.kind, t.status, t.standard_minutes, t.started_at, t.finished_at,
       r.id as room_id, r.room_number, r.floor, r.state as room_state
  from public.housekeeping_tasks t
  left join public.rooms r on r.id = t.room_id
 where t.assigned_to = public.auth_employee_id()
   and t.task_date = current_date;

-- Finished today by somebody else, waiting for a second pair of eyes.
create or replace view public.rooms_to_inspect as
select t.id as task_id, t.kind, t.finished_at,
       r.room_number, r.floor, e.first_name as cleaned_by
  from public.housekeeping_tasks t
  left join public.rooms r on r.id = t.room_id
  left join public.employees e on e.id = t.assigned_to
 where t.org_id = public.auth_employee_org()
   and t.task_date = current_date
   and t.status = 'DONE'
   and t.assigned_to is distinct from public.auth_employee_id();

create or replace function public.start_my_room(p_task uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  me uuid := public.require_employee();
  task record;
begin
  select * into task from public.housekeeping_tasks where id = p_task;
  if task is null or task.assigned_to is distinct from me then
    raise exception 'that room is not on your sheet';
  end if;
  if task.status <> 'PENDING' then
    raise exception 'that room is already %', lower(task.status::text);
  end if;

  update public.housekeeping_tasks
     set status = 'IN_PROGRESS', started_at = now(), updated_at = now()
   where id = p_task;
  if task.room_id is not null then
    update public.rooms
       set state = 'IN_PROGRESS', state_changed_at = now(),
           state_changed_by_email = auth.jwt() ->> 'email', updated_at = now()
     where id = task.room_id and state = 'DIRTY';
  end if;
end;
$$;

/*
 * The task is done when the attendant says so. The room is released as clean
 * in the same call — unless an urgent maintenance job is open on it, which the
 * release rule (enforce_room_release) refuses. Then the work still counts, the
 * room stays as it was, and the reason comes back to say so: the attendant
 * did their job, and the leaking tap is somebody else's.
 */
create or replace function public.finish_my_room(p_task uuid, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  me uuid := public.require_employee();
  task record;
  blocked text;
begin
  select * into task from public.housekeeping_tasks where id = p_task;
  if task is null or task.assigned_to is distinct from me then
    raise exception 'that room is not on your sheet';
  end if;
  if task.status not in ('PENDING', 'IN_PROGRESS') then
    raise exception 'that room is already %', lower(task.status::text);
  end if;

  update public.housekeeping_tasks
     set status = 'DONE', finished_at = now(),
         actual_minutes = case when started_at is null then null
                               else round(extract(epoch from now() - started_at) / 60) end,
         note = coalesce(nullif(btrim(p_note), ''), note),
         updated_at = now()
   where id = p_task;

  if task.room_id is not null then
    begin
      update public.rooms
         set state = 'CLEAN', state_changed_at = now(),
             state_changed_by_email = auth.jwt() ->> 'email', updated_at = now()
       where id = task.room_id;
    exception when others then
      blocked := sqlerrm;
    end;
  end if;

  return jsonb_build_object('room_released', blocked is null, 'reason', blocked);
end;
$$;

create or replace function public.inspect_room(
  p_task uuid, p_passed boolean, p_score numeric default null, p_findings text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare me uuid := public.require_employee();
begin
  if not exists (select 1 from public.housekeeping_tasks t
                  where t.id = p_task and t.org_id = public.auth_employee_org()) then
    raise exception 'that room is not in your venue';
  end if;
  if not exists (select 1 from public.housekeeping_tasks t
                  where t.id = p_task and t.status = 'DONE') then
    raise exception 'that room has not been finished yet';
  end if;
  -- The rest — not your own room, findings on a failure, moving the task and
  -- the room — is the inspection's own triggers (0035).
  insert into public.housekeeping_inspections (org_id, task_id, passed, score, findings,
                                               inspector_employee_id)
  values (public.auth_employee_org(), p_task, p_passed, p_score,
          nullif(btrim(p_findings), ''), me);
end;
$$;

-- Only reached through the doors above, which run as the owner.
revoke execute on function public.require_employee() from authenticated;

-- The views are the portal's only reading of these tables, and each filters
-- to the caller's own share; signed-in callers only.
grant select on public.my_request_types, public.my_requests, public.my_haccp_forms,
                public.my_checks_today, public.my_rooms, public.rooms_to_inspect
  to authenticated;
