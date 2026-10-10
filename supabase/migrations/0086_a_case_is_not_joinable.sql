-- ---------------------------------------------------------------------------
-- You cannot add yourself to an HR case to read it
-- ---------------------------------------------------------------------------
-- `can_see_case` grants sight of a case to whoever is listed in
-- `hr_case_participants`. The insert policy on that table checked only
-- `auth_can_write(org_id)`.
--
-- So the table that decides who may read a case could be written by anybody
-- who wanted to read one. Found by trying it as a CHEF:
--
--   select count(*) from hr_cases where id = '<case>';   -- 0
--   insert into hr_case_participants (org_id, case_id, user_id, email, role)
--   values ('<org>', '<case>', auth.uid(), 'chef@…', 'HR');
--   INSERT 0 1
--   select count(*) from hr_cases where id = '<case>';   -- 1
--   select detail from hr_cases where id = '<case>';
--   -- "Sensitive detail the chef is not party to."
--
-- Grievances, investigations and conduct records, readable by anybody with
-- write access to People — which, note, is every CHEF a venue creates, since
-- joining an organisation seeds WRITE on every section.
--
-- The rule it should always have had: you may bring somebody into a case only
-- if you can already see it. That is what the table is for — an investigator
-- adding HR, a manager adding a note-taker — and it is a closed loop. The
-- person who opened the case is included explicitly, because at the moment
-- they add the first participant there is nobody on the case at all.
--
-- Two mechanisms, deliberately:
--
--   - The policy is the control. It is what holds if anything reaches the
--     table by a path that is not this trigger.
--   - The trigger is the message. A bare policy violation tells somebody only
--     that a row was refused, and `AGENTS.md` asks for the refusal to be
--     legible as well as enforced.
--
-- `can_see_case` is left alone. It is correct; what was wrong was letting
-- people write the answer it reads.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_case_participant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- No session: a migration, or an administrator at the console. Same
  -- position 0054 took, for the same reason — there is no caller to check.
  if auth.uid() is null then
    return new;
  end if;

  if public.can_see_case(new.case_id) then
    return new;
  end if;

  if exists (
    select 1 from public.hr_cases c
     where c.id = new.case_id
       and lower(c.opened_by_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  ) then
    return new;
  end if;

  raise exception 'you are not party to this case'
    using hint = 'Someone already on the case can add you to it.';
end;
$$;

drop trigger if exists hr_case_participants_enforce on public.hr_case_participants;
create trigger hr_case_participants_enforce
  before insert or update on public.hr_case_participants
  for each row execute function public.enforce_case_participant();

/*
 * And the policy behind it.
 *
 * `can_see_case` is security definer, so it reads the participant list
 * without recursing through this policy.
 */
drop policy if exists hr_case_participants_insert on public.hr_case_participants;
create policy hr_case_participants_insert on public.hr_case_participants
  for insert to authenticated
  with check (
    public.auth_can_write(org_id)
    and (
      public.can_see_case(case_id)
      or exists (
        select 1 from public.hr_cases c
         where c.id = case_id
           and lower(c.opened_by_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
    )
  );

comment on function public.enforce_case_participant() is
  'A case is joinable only by somebody already on it, or by whoever opened it. See 0086.';
