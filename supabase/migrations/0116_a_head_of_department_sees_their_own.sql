-- ---------------------------------------------------------------------------
-- A head of department sees their own department, and only their own
-- ---------------------------------------------------------------------------
-- 0114 gave payroll one audience: anyone with Pay read saw every wage in the
-- venue. That is right for the general manager, HR and finance, and wrong for
-- the executive chef — who needs the kitchen's figures to run the kitchen and
-- has no business reading what front of house is paid.
--
-- No new concept is needed for this, and resisting the urge to invent one is
-- most of the work. `member_access` has carried `business_unit_id` since
-- 0062, `set_section_access` already takes a unit, and the administration
-- screen already grants one. A "department" in this schema *is* a business
-- unit — `departments` is a view over `business_units` and has been since
-- 0058. So the head of a department is a member holding Pay on that unit and
-- nothing else, which the section grid has always been able to say. Payroll
-- was simply not listening.
--
-- Three things that had to change.
--
--   A line now carries the unit as a reference, not only as text. 0114 copied
--   `business_unit_code` onto the line deliberately — a file is a record of
--   what was sent, and a unit renamed afterwards does not change what was.
--   That is still true and the column stays. But an access rule keyed on a
--   text code is a rule that breaks when somebody edits a code, and it would
--   break *open* or *closed* unpredictably. The id is for the rule; the code
--   remains the record.
--
--   The run header needs its own question. A run has no unit, and
--   `can_read_section('PAY', org)` with no unit matches only unscoped grants
--   — so a head of department holding Pay on the kitchen alone scored NONE
--   and could not see that the run existed, let alone their own lines in it.
--   That is the same trap 0107 fell into from the other direction, and it is
--   why `can_read_pay_anywhere` exists.
--
--   `labour_cost_daily` had the unit argument hard-coded to null, which meant
--   the same person could not see their own department's labour cost either.
--
-- What deliberately does not change: building and exporting a run still need
-- Pay write across the organisation. A run spans every employee, including
-- the ones a head of department cannot see, and somebody who cannot see the
-- whole file must not be the one who sends it.
-- ---------------------------------------------------------------------------

alter table payroll_lines
  add column if not exists business_unit_id uuid
    references business_units(id) on delete set null;

create index if not exists idx_payroll_lines_unit
  on payroll_lines(org_id, business_unit_id);

/*
 * Backfill from the code that was copied onto the line, not from the
 * employee's unit today.
 *
 * Somebody who has moved department since the run was built belongs, for the
 * purposes of that run, to the department that paid them — and the code on
 * the line is the only record of which that was. Reading it off the employee
 * now would quietly re-file historic wages under whoever manages them
 * currently.
 *
 * A line whose code matches nothing is left null, which closes rather than
 * opens: only an organisation-wide Pay grant will see it.
 */
update payroll_lines l
   set business_unit_id = b.id
  from business_units b
 where b.org_id = l.org_id
   and lower(b.code) = lower(l.business_unit_code)
   and l.business_unit_id is null;

/*
 * A rate is read through the unit of the person it belongs to.
 *
 * `pay_rates` is guarded by Pay and its policy was organisation-wide, which
 * would have left a head of department seeing their team's payroll lines and
 * none of the rates behind them — the partial grant 0062 warns about, where a
 * permission reads as given and behaves as refused on half the section.
 *
 * `security definer` because the lookup crosses into `employees`, which is
 * guarded by People: a head of department holding Pay and not People would
 * otherwise have the rate hidden by a policy on a table they are not even
 * asking about.
 */
create or replace function public.pay_unit_of_employee(p_employee uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.business_unit_id from public.employees e where e.id = p_employee;
$$;

revoke all on function public.pay_unit_of_employee(uuid) from public, anon;
grant execute on function public.pay_unit_of_employee(uuid) to authenticated;

drop policy if exists pay_rates_read on pay_rates;
create policy pay_rates_read on pay_rates for select to authenticated
  using (public.can_read_section('PAY', org_id,
                                 public.pay_unit_of_employee(employee_id)));

/*
 * Pay can now be scoped to a unit, and this is why that is now true.
 *
 * 0062 refuses a unit-scoped grant in a section where nothing carries a unit
 * — a grant that would read as "the kitchen" on the screen that wrote it and
 * behave as "refuse everything" afterwards. Pay was on the wrong side of
 * that test for a good reason: until the column above existed, no table
 * guarded by `require_section_write('PAY')` had a business unit on it. Now
 * both of its wage-bearing tables do, and both policies consult it.
 *
 * Set directly rather than by calling `refresh_section_unit_scoping()`, and
 * that is a deliberate narrowing of this migration's blast radius. Running
 * the refresh today also flips HYGIENE, INVENTORY and MENU — not because
 * anything about them changed here, but because it has not been run since
 * 0062 and their tables have gained unit columns since. Their read policies
 * do **not** consult the unit, so flipping them would manufacture exactly
 * the failure 0062 exists to prevent, in three sections, inside a payroll
 * change. It is a real problem and it is written up in
 * `docs/programme/GAP_RECONCILIATION.md` rather than fixed in passing.
 */
update public.app_sections set scopes_by_unit = true where code = 'PAY';

/*
 * Does this person hold Pay anywhere in the venue — unscoped, or on any one
 * unit?
 *
 * Needed because a payroll run carries no unit of its own, so there is no
 * unit to ask about. `security definer` so it can read `member_access`
 * without the caller needing to, and so a policy built on it cannot recurse
 * through another table's policies.
 *
 * It gates the *header* only: the period, its status, and who exported it.
 * No wage is reachable through it — those are on the lines, which are asked
 * about one unit at a time.
 */
create or replace function public.can_read_pay_anywhere(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.can_read_section('PAY', p_org)
    or exists (
      select 1
        from public.member_access a
       where a.user_id = (select auth.uid())
         and a.org_id = p_org
         and a.section_code = 'PAY'
         and a.level <> 'NONE'
    );
$$;

revoke all on function public.can_read_pay_anywhere(uuid) from public, anon;
grant execute on function public.can_read_pay_anywhere(uuid) to authenticated;

/*
 * The header: visible to anybody who holds Pay anywhere.
 *
 * A head of department who cannot see the run cannot reach their own lines
 * in it, and a payroll screen that is empty for them is indistinguishable
 * from one that is broken.
 */
drop policy if exists payroll_runs_read on payroll_runs;
create policy payroll_runs_read on payroll_runs for select to authenticated
  using (public.can_read_pay_anywhere(org_id));

/*
 * The lines: one unit at a time.
 *
 * `can_read_section` with a unit returns the better of the unscoped grant and
 * the grant for that unit, so this one policy serves both audiences — the
 * general manager, HR and finance hold Pay unscoped and see everything, and
 * the executive chef holds Pay on the kitchen and sees the kitchen.
 *
 * A line with no unit is seen only by the unscoped holders, which is the
 * right way round: an employee filed under no department is not quietly
 * everybody's.
 */
drop policy if exists payroll_lines_read on payroll_lines;
create policy payroll_lines_read on payroll_lines for select to authenticated
  using (public.can_read_section('PAY', org_id, business_unit_id));

/*
 * Writing still needs Pay across the venue.
 *
 * `build_payroll_run` already refuses anybody without it, and this is the
 * same rule stated where it is enforced: a run spans every employee,
 * including the ones a head of department cannot see, and somebody who
 * cannot see the whole file must not be the one who sends it.
 */
drop policy if exists payroll_lines_write on payroll_lines;
create policy payroll_lines_write on payroll_lines for all to authenticated
  using (public.auth_can_write(org_id) and public.can_read_section('PAY', org_id))
  with check (public.auth_can_write(org_id) and public.can_read_section('PAY', org_id));

/*
 * The unit goes onto the line as it is built.
 *
 * Only this one clause changes; everything else is 0114's and is repeated
 * because a function body cannot be amended in part. The clash check, the
 * supersede rule and the organisation-wide write check are unchanged.
 */
create or replace function public.build_payroll_run(
  p_org uuid, p_from date, p_to date, p_supersedes uuid default null,
  p_reason text default null
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  clash record;
  run uuid;
begin
  if not public.can_write_section('PAY', p_org) then
    raise exception 'building a payroll run needs Pay access across the venue'
      using errcode = '42501',
            hint = 'A run covers every employee, including the ones a head of department cannot see.';
  end if;

  if p_to < p_from then
    raise exception 'a pay period ends after it starts';
  end if;

  select * into clash
    from public.payroll_runs r
   where r.org_id = p_org
     and r.status = 'EXPORTED'
     and r.period_from <= p_to
     and r.period_to >= p_from
     and (p_supersedes is null or r.id <> p_supersedes)
   limit 1;

  if clash.id is not null then
    raise exception
      'the days % to % were already exported on % and would be paid twice',
      clash.period_from, clash.period_to, clash.exported_at::date
      using hint = 'To re-run them, supersede that run and say why.';
  end if;

  if p_supersedes is not null
     and coalesce(btrim(p_reason), '') = '' then
    raise exception 'say why this run replaces the earlier one'
      using hint = 'This is the record of why a pay period was run again.';
  end if;

  insert into public.payroll_runs
    (org_id, period_from, period_to, built_by_email, supersedes_id, reason)
  values (p_org, p_from, p_to, auth.jwt() ->> 'email', p_supersedes, p_reason)
  returning id into run;

  insert into public.payroll_lines
    (org_id, run_id, employee_id, employee_number, employee_name,
     business_unit_id, business_unit_code, basis, hours, rate, gross,
     open_punches, corrections_applied, days_worked)
  select
    p_org, run, d.employee_id,
    e.employee_number,
    btrim(e.first_name || ' ' || e.last_name),
    e.business_unit_id,
    b.code,
    max(d.basis::text)::public.pay_basis,
    round(sum(d.hours), 3),
    max(d.rate),
    round(sum(d.cost), 5),
    coalesce(sum(d.open_punches), 0)::int,
    count(*) filter (where d.hours_were_corrected)::int,
    count(*)::int
  from public.labour_cost_daily d
  join public.employees e on e.id = d.employee_id
  left join public.business_units b on b.id = e.business_unit_id
  where d.org_id = p_org
    and d.on_date between p_from and p_to
  group by d.employee_id, e.employee_number, e.first_name, e.last_name,
           e.business_unit_id, b.code;

  return run;
end $$;

/*
 * The daily figure, asked about the right unit.
 *
 * 0114 passed `null::uuid` here, which means "the unscoped grant only" — so a
 * head of department holding Pay on the kitchen saw no labour cost at all,
 * including the kitchen's. Replaced rather than dropped: the columns are
 * unchanged, and `cascade` on this view takes five others with it, which 0114
 * found out the hard way.
 */
create or replace view labour_cost_daily
with (security_invoker = true) as
  with worked as (
    select
      t.org_id,
      t.employee_id,
      (t.clock_in_at at time zone 'UTC')::date as on_date,
      sum(t.hours) as hours,
      count(*) filter (where t.still_open) as open_punches,
      bool_or(t.corrected) as any_corrected
    from public.time_entries_effective t
    where t.clock_out_at is not null
    group by t.org_id, t.employee_id, (t.clock_in_at at time zone 'UTC')::date
  )
  select
    w.org_id,
    w.employee_id,
    e.business_unit_id,
    w.on_date,
    round(w.hours, 3) as hours,
    r.basis,
    r.amount as rate,
    case r.basis
      when 'HOURLY' then round(w.hours * r.amount, 2)
      when 'MONTHLY' then round(r.amount / extract(day from
             (date_trunc('month', w.on_date::timestamptz) + interval '1 month -1 day')), 2)
    end as cost,
    w.open_punches,
    w.any_corrected as hours_were_corrected
  from worked w
  join public.employees e on e.id = w.employee_id
  left join lateral public.pay_rate_on(w.employee_id, w.on_date) r(basis, amount) on true
  where public.can_read_section('PAY', w.org_id, e.business_unit_id);

grant select on labour_cost_daily to authenticated;

/*
 * What a reader is actually seeing.
 *
 * A head of department looking at a run sees their own lines and no sign
 * that there are others — and a total that looks like the venue's. This says
 * which units they can see, so a partial view is legible as a partial view.
 * It names units rather than counting hidden lines: the count would be a
 * fact about other departments' headcount, which is the thing being withheld.
 */
create or replace view my_pay_scope
with (security_invoker = true) as
  select
    o.id                                   as org_id,
    public.can_read_section('PAY', o.id)   as sees_whole_venue,
    coalesce(
      array_agg(b.name order by b.name)
        filter (where b.id is not null),
      array[]::text[]
    )                                      as units_visible
  from public.organizations o
  left join public.member_access a
    on a.org_id = o.id
   and a.user_id = (select auth.uid())
   and a.section_code = 'PAY'
   and a.level <> 'NONE'
   and a.business_unit_id is not null
  left join public.business_units b on b.id = a.business_unit_id
 where o.id in (select public.auth_org_ids())
 group by o.id;

grant select on my_pay_scope to authenticated;

comment on column payroll_lines.business_unit_id is
  'The reference the access rule uses. `business_unit_code` beside it is the record of what was sent and does not move when a code is edited. See 0116.';
comment on function public.can_read_pay_anywhere(uuid) is
  'Gates the payroll run header only. A run carries no unit, so a head of department holding Pay on one unit would otherwise be unable to see that the run exists — and an empty payroll screen is indistinguishable from a broken one.';
comment on view my_pay_scope is
  'Which units the reader can see wages for, so a partial view is legible as one. Names units rather than counting hidden lines: the count is a fact about other departments. See 0116.';
