-- ---------------------------------------------------------------------------
-- A blank address is not everybody's address
-- ---------------------------------------------------------------------------
-- Found by writing the missing half of a test. `31_the_four_defects.sql`
-- proved that somebody who is not a participant cannot read a case; nothing
-- proved that somebody who *is* one can. Covering that direction meant
-- exercising the branch of `can_see_case` nobody had:
--
--     or lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
--
-- `coalesce(..., '')` turns a token with no email claim into the empty
-- string, and a participant row with an empty email compares equal to it. So
-- any caller whose token carries no address could read any case that had one
-- such row — matched not because they were named on it, but because neither
-- of them was anybody.
--
-- Narrow, and real. A token without an email is not exotic: a phone sign-up
-- has none, and neither does a service token minted for a background job.
-- The participant side needs a row with `email = ''`, which nothing creates
-- deliberately — the column is `not null`, which stops null and says nothing
-- about empty — but a CSV import of a case file with a missing column
-- produces exactly that, silently, and the first symptom would be somebody
-- reading a grievance they are not party to.
--
-- Two changes, because either alone leaves the other half of the hole:
--
--   the function   stops a blank from matching, whatever is in the table
--   the constraint stops the blank existing, whatever calls the insert
--
-- The function is the control. The constraint is so the bad row never gets
-- written in the first place and nobody has to notice it later.
-- ---------------------------------------------------------------------------

/*
 * `nullif(..., '')` rather than `coalesce(..., '')`.
 *
 * A missing address is now null, and null is not equal to anything —
 * including another missing address. That is the whole fix: the comparison
 * stops being true for two callers who are both nobody.
 *
 * The owner exception below is 0048's and unchanged; it is restated only
 * because a function body cannot be amended in place.
 */
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
       and (p.user_id = (select auth.uid())
            or lower(nullif(p.email, ''))
               = lower(nullif((select auth.jwt()) ->> 'email', '')))
  )
  -- An owner can always reach a case, because somebody has to be able to when
  -- the participants have left. It is a deliberate, single exception.
  or exists (
    select 1 from public.organization_members m
     join public.hr_cases c on c.org_id = m.organization_id
    where c.id = p_case and m.user_id = (select auth.uid()) and m.role = 'OWNER'
  );
$$;

/*
 * `not null` was already there and was never the question. An address that is
 * present but empty is not an address, and a participant who cannot be
 * identified is not a participant — the row has no meaning the application
 * can act on, so the right place to refuse it is here rather than in whatever
 * writes it next.
 */
alter table hr_case_participants
  add constraint hr_case_participants_email_is_an_address
  check (email <> '');
