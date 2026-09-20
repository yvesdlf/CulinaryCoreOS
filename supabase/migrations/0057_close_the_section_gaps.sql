-- ---------------------------------------------------------------------------
-- The tables the section grid never covered
-- ---------------------------------------------------------------------------
-- 0036 wired each section to its tables by listing them explicitly, and said
-- so: "listed explicitly rather than guessed from names, so adding a table is
-- a deliberate decision about which section owns it."
--
-- The cost of that choice is that a table added later is outside the grid
-- until somebody remembers, and nothing tells them. Thirty-one tables had no
-- guard. An audit against a probe user — CHEF role, every section explicitly
-- NONE — found sixteen it could write, and four of them defeat a control that
-- exists elsewhere in this database.
--
-- Proved by outcome rather than by the absence of an error, which is the trap
-- this repository keeps falling into: the probe ran the write, then read the
-- row back as the superuser.
--
--   job_roles.required_certifications  ->  EMPTY
--       This is the array the rota checks before publishing a shift, and the
--       one work-order assignment checks before sending a technician. Emptying
--       it makes both checks pass for everybody. A control that anybody can
--       erase the input to is not a control; 852/2004 Annex II Chapter XII was
--       being enforced against a value any signed-in user could blank.
--
--   quiz_questions.correct_index       ->  changed
--       The candidate can edit the answer to their own food-safety exam.
--
--   board_posts.status                 ->  PUBLISHED
--       0053 claimed "there is no path that writes PUBLISHED from the client".
--       There is. The trigger refuses only the *poster*, so anybody else
--       signed in could publish somebody's phone number and asking price to
--       the whole venue. The trigger was right and incomplete: it enforced
--       "not by you" and nothing enforced "by somebody whose job it is".
--
--   leave_types.annual_entitlement_days -> 99 for every type
--       Everybody's balance, rewritten.
--
-- Also writable, and fixed here: department_approvers (who may approve spend),
-- hiring_requests.status (approving a hire), observation_checklists.overall_met
-- (whether somebody passed a practical), staff_document_recipients
-- (acknowledging a policy on somebody else's behalf), checklist_templates,
-- departments, employee_exits, leave_attachments, collection_recipes,
-- rfq_suppliers, organization_invitations, message_deliveries, and
-- parameter_changes — the audit trail of protected-parameter edits.
--
-- ## Two kinds of fix, because these are two kinds of table
--
-- Most are configuration and take the ordinary section guard.
--
-- Some are self-service: an employee has to be able to write their own row,
-- and a blanket guard would break the staff portal for exactly the people it
-- exists for. Those get a rule that says who: the subject may write their own,
-- anybody else needs the section. That distinction is the reason this is not
-- one loop over a list.
-- ---------------------------------------------------------------------------

-- ── Messaging gets a section of its own ─────────────────────────────────────
/*
 * It never had one. `message_channels` sits under venue parameters, which is
 * where a channel's credentials belong, but the outbound queue belonged
 * nowhere and so was writable by anyone.
 */
insert into app_sections (code, name, description, sort_order, is_core) values
  ('MESSAGING', 'Messaging',
   'The outbound queue and what has been sent to suppliers and staff.', 115, false)
on conflict (code) do update set
  name = excluded.name, description = excluded.description,
  sort_order = excluded.sort_order, is_core = excluded.is_core;

-- ── Configuration tables ────────────────────────────────────────────────────
/*
 * Listed explicitly, the same way 0036 did, and for the same reason: which
 * section owns a table is a decision, not something to infer from its name.
 */
do $$
declare
  m record;
  t text;
begin
  for m in select * from (values
    -- People and their qualifications. job_roles first, because it is the one
    -- that other controls read.
    ('PEOPLE', array['job_roles','leave_types','departments','checklist_templates',
                     'quiz_questions','observation_checklists','employee_exits',
                     'hiring_requests']),
    -- Who may approve what is a finance parameter, not an HR one.
    ('PARAMETERS', array['department_approvers']),
    -- An invitation is an access grant.
    ('ADMIN', array['organization_invitations']),
    ('MESSAGING', array['message_deliveries']),
    -- Children whose siblings were already guarded. recipe_lines carried the
    -- guard and collection_recipes did not, which is the shape of an omission
    -- rather than a decision.
    ('RECIPES', array['collection_recipes']),
    ('PURCHASING', array['rfq_suppliers'])
  ) as v(section, tables)
  loop
    foreach t in array m.tables loop
      if to_regclass('public.' || t) is not null then
        execute format(
          'drop trigger if exists %1$s_section_guard on public.%1$I', t);
        execute format(
          'create trigger %1$s_section_guard before insert or update or delete
             on public.%1$I for each row
             execute function public.require_section_write(%2$L)', t, m.section);
      end if;
    end loop;
  end loop;
end $$;

-- ── The audit trail of parameter edits does not move ────────────────────────
/*
 * `parameter_changes` records the value before and after every change to a
 * protected number, and it carried an UPDATE grant. A record of who changed
 * the food-cost target that the same person can rewrite afterwards is not a
 * record. The same reasoning as the approval ledger and stock movements: a
 * correction is another row.
 */
revoke update, delete on parameter_changes from authenticated;

-- ── Self-service, where the subject writes their own row ────────────────────

/*
 * The staff board.
 *
 * Posting and withdrawing are the poster's own acts and need nobody. Deciding
 * — publishing or rejecting — is a moderator's act and needs People.
 *
 * 0053's rule stays exactly as it was and is not weakened: you still cannot
 * approve your own post. What is added is the other half, which was missing:
 * somebody else cannot approve it either unless moderating is their job.
 */
create or replace function public.enforce_board_moderation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  poster_user uuid;
  poster_email text;
  caller text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if tg_op = 'INSERT' then
    if new.status <> 'WITHDRAWN' then new.status := 'PENDING'; end if;
    return new;
  end if;

  if new.status = old.status then return new; end if;
  if new.status = 'WITHDRAWN' then return new; end if;

  select e.user_id, lower(coalesce(e.work_email, ''))
    into poster_user, poster_email
    from public.employees e where e.id = new.employee_id;

  -- Unchanged from 0053: not your own.
  if (poster_user is not null and auth.uid() is not null and poster_user = auth.uid())
     or (poster_email <> '' and caller <> '' and poster_email = caller)
  then
    raise exception 'you cannot approve your own post'
      using hint = 'Your line manager sees it on their tasks.';
  end if;

  -- New, and the hole this migration exists for: moderating is a job.
  if auth.uid() is not null and not public.can_write_section('PEOPLE') then
    raise exception 'moderating the staff board needs edit access to People'
      using hint = 'Ask an administrator, or leave it for a manager.';
  end if;

  if new.status = 'PUBLISHED' then
    new.approved_by_email := coalesce(nullif(caller, ''), new.approved_by_email);
    new.approved_at := coalesce(new.approved_at, now());
  end if;
  return new;
end;
$$;

/*
 * A sick note belongs to the person it is about.
 *
 * They upload it; HR reads it. Anybody else editing the attachment on
 * somebody's leave request has no business doing so, and it is the kind of
 * record that matters precisely when it is disputed.
 */
create or replace function public.enforce_leave_attachment_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare owner_employee uuid;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  if public.can_write_section('PEOPLE') then
    return coalesce(new, old);
  end if;

  select l.employee_id into owner_employee
    from public.leave_requests l
   where l.id = coalesce(new.leave_request_id, old.leave_request_id);

  if owner_employee is null or owner_employee is distinct from public.auth_employee_id() then
    raise exception 'that leave request is not yours'
      using hint = 'You can attach a document to your own request.';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger leave_attachments_owner
  before insert or update or delete on leave_attachments
  for each row execute function public.enforce_leave_attachment_owner();

/*
 * Reading a policy is something only the reader can do.
 *
 * `acknowledged_at` is the evidence that somebody was told. Letting a
 * colleague set it means the venue's record of who has read the allergen
 * policy is a record of who was willing to tick a box for somebody else.
 */
create or replace function public.enforce_document_receipt_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  -- HR may send, withdraw and correct; they may not acknowledge for anybody.
  if tg_op <> 'UPDATE' then
    if public.can_write_section('PEOPLE') then
      return new;
    end if;
    raise exception 'sending a staff document needs edit access to People';
  end if;

  if new.employee_id is distinct from public.auth_employee_id() then
    if (new.read_at is distinct from old.read_at)
       or (new.acknowledged_at is distinct from old.acknowledged_at) then
      raise exception 'only the person a document was sent to can acknowledge it'
        using hint = 'Acknowledgement is evidence they were told, not a box anybody may tick.';
    end if;
    if not public.can_write_section('PEOPLE') then
      raise exception 'that document was not sent to you';
    end if;
  end if;
  return new;
end;
$$;

create trigger staff_document_recipients_owner
  before insert or update or delete on staff_document_recipients
  for each row execute function public.enforce_document_receipt_owner();

comment on function public.enforce_board_moderation() is
  'A post is published by somebody other than the poster, whose job it is.';
comment on function public.enforce_leave_attachment_owner() is
  'A leave attachment is written by the person the leave belongs to, or by HR.';
comment on function public.enforce_document_receipt_owner() is
  'Only the recipient may acknowledge. HR may send; HR may not acknowledge for them.';
