-- ---------------------------------------------------------------------------
-- A decision records who actually made it
-- ---------------------------------------------------------------------------
-- 0053 read `decided_by_email` from the row being written and only compared it
-- against the employee when the client had bothered to set it. So a manager
-- approving a loan could send the employee's own address, and the trigger's
-- self-approval check — which compares the *caller's* JWT email — passed
-- happily. The row then said Budi approved Budi's loan.
--
-- Found by trying it: a manager set decided_by_email to the employee's address
-- and the write succeeded.
--
-- Nothing catastrophic follows from it, which is exactly why it is worth
-- fixing now. It does not grant anybody an approval they could not otherwise
-- make. What it corrupts is the record of who made it, and a segregation-of-
-- duties control whose audit trail can be written by the person being audited
-- is decoration.
--
-- The fix is to stop reading the field. Where there is a signed-in caller, the
-- decision is recorded as theirs and whatever the client sent is discarded.
-- The field remains writable only with no session at all — a migration or an
-- administrator at the console, where there is no JWT to take a name from.
--
-- Same change on the community board, which had the same shape.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_staff_request_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  subject_user uuid;
  subject_email text;
  caller text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if new.status not in ('APPROVED', 'REJECTED') then
    return new;
  end if;

  /*
   * The caller's own identity, never the client's claim about it.
   *
   * Taking it from the row let a manager file their decision under the
   * employee's name, which is the one thing the record has to be right about.
   */
  if caller <> '' then
    new.decided_by_email := caller;
  elsif coalesce(new.decided_by_email, '') = '' then
    raise exception 'a decision must record who made it';
  end if;

  select e.user_id, lower(coalesce(e.work_email, ''))
    into subject_user, subject_email
    from public.employees e where e.id = new.employee_id;

  if (subject_user is not null and auth.uid() is not null and subject_user = auth.uid())
     or (subject_email <> '' and subject_email = lower(new.decided_by_email))
  then
    raise exception 'you cannot decide your own request'
      using hint = 'Ask your line manager.';
  end if;

  if new.decided_at is null then new.decided_at := now(); end if;
  return new;
end;
$$;

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
    -- A post always starts pending, whatever the client asked for.
    if new.status <> 'WITHDRAWN' then new.status := 'PENDING'; end if;
    return new;
  end if;

  if new.status = old.status then return new; end if;
  -- Withdrawing is the poster's own act and needs nobody's permission.
  if new.status = 'WITHDRAWN' then return new; end if;

  select e.user_id, lower(coalesce(e.work_email, ''))
    into poster_user, poster_email
    from public.employees e where e.id = new.employee_id;

  if caller <> '' then
    new.approved_by_email := caller;
  end if;

  if (poster_user is not null and auth.uid() is not null and poster_user = auth.uid())
     or (poster_email <> '' and poster_email = lower(coalesce(new.approved_by_email, '')))
  then
    raise exception 'you cannot approve your own post'
      using hint = 'Your line manager sees it on their tasks.';
  end if;

  if new.status = 'PUBLISHED' and new.approved_at is null then
    new.approved_at := now();
  end if;
  return new;
end;
$$;

comment on function public.enforce_staff_request_decision() is
  'Records the decision against the caller, never the address the client sent.';
