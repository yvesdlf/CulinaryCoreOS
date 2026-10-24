-- ---------------------------------------------------------------------------
-- 0083 · What the re-checks of 0076–0082 found
-- ---------------------------------------------------------------------------
-- Three agents re-examined the fixes: a security re-audit, a GDPR re-check and
-- a reality check of every claim the pull requests made. This closes what they
-- found that the earlier migrations left open. The cross-venue rewrite in
-- anonymise_person was fixed in 0080 itself, before it merged.
--
-- Tests: supabase/tests/29_rechecks.sql, and 24_ownership.sql, rewritten.
-- ---------------------------------------------------------------------------

-- 1 · A work email is an identity, so it is an administrator's to change ----

/*
 * auth_employee_id() resolves a login to the record whose work email matches
 * a confirmed address. So changing a colleague's work email to your own made
 * you them — leave, payslips, notifications, the portal. Every CHEF holds
 * People write by default, and 24_ownership.sql once asserted this as
 * correct with a chef who happened to be unconfirmed. Adding staff with an
 * address stays open to People writers; changing one is not.
 */
create or replace function public.guard_work_email()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and new.work_email is distinct from old.work_email
     and not public.auth_is_admin(new.org_id) then
    raise exception 'only an owner or administrator can change somebody''s work email'
      using errcode = '42501',
            hint = 'The work email decides whose staff record a login opens.';
  end if;
  return new;
end;
$$;

create trigger employees_guard_work_email
  before update of work_email on public.employees
  for each row execute function public.guard_work_email();

-- 2 · Notifications, approvals and request history ---------------------------

/*
 * Outside the 0079 registry because none had a write guard, so every member
 * read every notification — leave dates and requester emails, quiz names and
 * scores — whatever their grid said.
 */
create or replace function public.notification_section(p_kind public.notification_kind)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when p_kind::text in ('REQUISITION_SUBMITTED', 'REQUISITION_DECIDED', 'ORDER_SENT',
                          'ORDER_ACKNOWLEDGED', 'DELIVERY_RECORDED', 'DELIVERY_SHORT',
                          'INVOICE_ON_HOLD', 'INVOICE_APPROVED') then 'PURCHASING'
    when p_kind::text = 'REQUEST_UNANSWERED' then 'REQUESTS'
    else 'PEOPLE'
  end;
$$;

alter policy notifications_read on public.notifications
  using ((supplier_id is null
          and public.can_read_section(public.notification_section(kind), org_id))
         or (supplier_id is not null and supplier_id = public.auth_supplier_id()));
alter policy notifications_update on public.notifications
  using ((supplier_id is null
          and public.can_read_section(public.notification_section(kind), org_id))
         or (supplier_id is not null and supplier_id = public.auth_supplier_id()));

-- Every approval recorded today is a purchasing document.
alter policy approval_events_read on public.approval_events
  using (public.can_read_section('PURCHASING', org_id));
create trigger approval_events_section_guard
  before insert or update or delete on public.approval_events
  for each row execute function public.require_section_write('PURCHASING');

insert into public.section_read_rules (table_name, section_code, shared_because) values
  ('approval_events', 'PURCHASING', null),
  ('notifications',   null, 'gated per notification kind by notification_section(), see 0083'),
  ('request_events',  null, 'the history of the shared front door, read like requests themselves (0066)');

-- 3 · Views with elevated rights answer to the section, not the venue -------

/*
 * Sixteen definer views filtered on venue membership and nothing else, so
 * they read straight past the 0079 gates on the tables beneath them — the
 * task board showed a dismissal note to somebody with no People access.
 * Their tables now say who may read what, so reading as the caller is the
 * whole fix. The three that stay definer say why below and in 23_exposure.
 */
alter view public.asset_health                 set (security_invoker = true);
alter view public.budget_positions             set (security_invoker = true);
alter view public.contract_attention           set (security_invoker = true);
alter view public.employee_task_board          set (security_invoker = true);
alter view public.haccp_outstanding            set (security_invoker = true);
alter view public.housekeeping_board           set (security_invoker = true);
alter view public.housekeeping_replenishment   set (security_invoker = true);
alter view public.housekeeping_workload        set (security_invoker = true);
alter view public.lot_forward_trace            set (security_invoker = true);
alter view public.maintenance_due              set (security_invoker = true);
alter view public.maintenance_manning          set (security_invoker = true);
alter view public.product_supplier_options     set (security_invoker = true);
alter view public.production_records_effective set (security_invoker = true);
alter view public.production_usage_actual      set (security_invoker = true);
alter view public.purchasing_chain             set (security_invoker = true);
alter view public.rfq_comparison               set (security_invoker = true);

/*
 * The access grid joins login accounts, which only a definer view may read,
 * so it stays definer and asks for Administration itself.
 */
do $$
declare def text := pg_get_viewdef('public.member_access_grid'::regclass);
begin
  def := rtrim(btrim(def), ';');
  execute format('create or replace view public.member_access_grid as select g.* from (%s) g where public.can_read_section(%L, g.org_id)', def, 'ADMIN');
end $$;

-- 4 · Payslips: the recipient and People, not the whole venue ----------------

alter policy staff_documents_read on storage.objects
  using (bucket_id = 'staff-documents' and (
    public.can_read_section('PEOPLE', public.storage_path_org(name))
    or exists (select 1 from public.staff_document_recipients r
                where r.employee_id = public.auth_employee_id()
                  and r.document_id::text = split_part(name, '/', 2))));

-- 5 · Two functions that trusted the caller ----------------------------------

create or replace function public.next_document_reference(p_type text, p_unit text, p_org uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  target_org uuid := coalesce(p_org, public.auth_default_org_id());
  code text := public.unit_code(p_unit);
  kind text := upper(regexp_replace(coalesce(p_type, ''), '[^A-Za-z]', '', 'g'));
  today date := current_date;
  seq integer;
begin
  if target_org is null then
    raise exception 'no organization for the current user';
  end if;
  if kind = '' then
    raise exception 'a document type is required';
  end if;

  -- The same membership question next_reference_stem asks since 0077: a
  -- direct call for a venue that is not the caller's draws from its sequence.
  if pg_trigger_depth() = 0
     and auth.uid() is not null
     and target_org not in (select public.auth_org_ids()) then
    raise exception 'not a member of that organization' using errcode = '42501';
  end if;

  insert into public.document_sequences (org_id, doc_type, unit_code, day, last_seq)
  values (target_org, kind, code, today, 1)
  on conflict (org_id, doc_type, unit_code, day)
  do update set last_seq = public.document_sequences.last_seq + 1
  returning last_seq into seq;

  return kind || '-' || code || '-' ||
         to_char(today, 'YYMMDD') || '-' ||
         lpad(seq::text, 3, '0');
end;
$$;

alter table public.training_courses add column pass_mark numeric not null default 80
  check (pass_mark > 0 and pass_mark <= 100);

create or replace function public.mark_quiz_attempt(p_course uuid, p_employee uuid, p_answers jsonb, p_pass_mark numeric DEFAULT 80)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
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

  -- The pass mark is the course's, not the caller's: an employee marking
  -- their own paper sent 80 because the screen did, and could have sent 0.
  select c.pass_mark into p_pass_mark from public.training_courses c where c.id = p_course;

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

-- 6 · Logs the client may not write -----------------------------------------

/*
 * Written by definer triggers only; a client insert could add an event that
 * never happened. 0081 made the actor honest, this makes the event so.
 */
revoke insert, update, delete on public.parameter_changes from authenticated;
revoke insert, update, delete on public.work_order_events from authenticated;
revoke insert, update, delete on public.room_state_events from authenticated;

-- The screen writes these two itself, so they get the section guard instead.
create trigger recipe_status_events_section_guard
  before insert or update or delete on public.recipe_status_events
  for each row execute function public.require_section_write('RECIPES');
insert into public.section_read_rules (table_name, section_code, shared_because)
values ('recipe_status_events', null, 'the history of the shared catalogue, read like recipes themselves');

-- 7 · Your own private record -------------------------------------------------

/*
 * 0079 rewrote this policy's membership clause into a People gate, and the
 * employee's own row went with it: a member reading their own bank details
 * needed People access. The self clause was always meant to stand alone.
 */
alter policy employee_private_read on public.employee_private
  using (employee_id = public.auth_employee_id()
         or (public.can_read_section('PEOPLE', org_id)
             and exists (select 1 from public.organization_members m
                          where m.organization_id = employee_private.org_id
                            and m.user_id = (select auth.uid())
                            and m.role in ('OWNER', 'ADMIN'))));

-- 8 · Supplier invitations need a proved address too ------------------------

create or replace function public.accept_supplier_invitation(invitation_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare inv public.supplier_users; caller_email text;
begin
  select lower(coalesce(auth.jwt() ->> 'email', '')) into caller_email;
  if caller_email = '' then raise exception 'not signed in'; end if;

  -- A proved address, as accept_invitation requires since 0081.
  if not exists (select 1 from auth.users u
                  where u.id = auth.uid() and u.email_confirmed_at is not null) then
    raise exception 'confirm your email address before accepting an invitation';
  end if;

  select * into inv from public.supplier_users
   where id = invitation_id
     and lower(email) = caller_email
     and accepted_at is null
     and revoked_at is null
     and expires_at > now();

  if inv is null then
    raise exception 'this invitation is not available'
      using hint = 'It may have been used, revoked, or expired.';
  end if;

  update public.supplier_users
     set accepted_at = now(), user_id = auth.uid()
   where id = inv.id;
  return inv.supplier_id;
end;
$$;
