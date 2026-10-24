-- ---------------------------------------------------------------------------
-- A payroll file that cannot pay somebody twice
-- ---------------------------------------------------------------------------
-- Gap list item twenty-four. Time has been recorded since 0026 and costed
-- since 0064, and nothing has ever produced a file a bureau can take — so the
-- hours get retyped, which is the one place in this system where a typo
-- becomes somebody's wages.
--
-- Before any of that, a defect that had to be fixed first.
--
-- `attendance` applies an approved time correction: it joins the correction
-- and uses the corrected clock-in, clock-out and break. `labour_cost_daily`,
-- written later and for a different screen, reads `time_entries` raw. So an
-- approved correction moved the attendance figure and left the pay figure
-- exactly where it was. Somebody whose four-hour punch was corrected to eight
-- showed eight hours worked and was costed — and would have been paid — for
-- four. AGENTS.md §4 says a punch that can be quietly edited is one nobody
-- can rely on; this is the same failure from the other side, a correction
-- that is accepted and then quietly ignored.
--
-- So both now read one view, `time_entries_effective`, and there is one
-- answer to "how many hours was that".
--
-- Then the export itself, where the catastrophic failure is not an incorrect
-- figure but a repeated one. Paying a fortnight twice costs the venue the
-- fortnight and costs somebody their trust in the system; it is also, in most
-- places, very hard to claw back. So an exported period cannot be exported
-- again, and an overlapping one is refused by name. Re-running a period is
-- possible — payroll genuinely does need re-runs — and requires superseding
-- the earlier run explicitly, with a reason, which stays on the record.
--
-- The lines are stored rather than recomputed, for the same reason the
-- carry-over is: this is what was paid. A recomputation in March against a
-- rate somebody has since corrected would disagree with the bank.
-- ---------------------------------------------------------------------------

/*
 * The hours, once.
 *
 * `attendance` had this logic and `labour_cost_daily` had its own; one of
 * them was wrong and nothing said which. An open punch has no hours at all —
 * null, not zero, because somebody still clocked in and a zero would say
 * they worked a shift of no length.
 */
create or replace view time_entries_effective
with (security_invoker = true) as
  select
    t.id,
    t.org_id,
    t.employee_id,
    t.shift_id,
    coalesce(c.corrected_clock_in_at, t.clock_in_at)   as clock_in_at,
    coalesce(c.corrected_clock_out_at, t.clock_out_at) as clock_out_at,
    coalesce(c.corrected_break_minutes, t.break_minutes) as break_minutes,
    (c.id is not null)                                  as corrected,
    c.reason                                            as correction_reason,
    t.source,
    (coalesce(c.corrected_clock_out_at, t.clock_out_at) is null) as still_open,
    case
      when coalesce(c.corrected_clock_out_at, t.clock_out_at) is null then null
      else greatest(
        round(
          (extract(epoch from
             coalesce(c.corrected_clock_out_at, t.clock_out_at)
             - coalesce(c.corrected_clock_in_at, t.clock_in_at)) / 3600.0
          )::numeric
          - coalesce(c.corrected_break_minutes, t.break_minutes) / 60.0, 3),
        0)
    end as hours
  from public.time_entries t
  left join lateral (
    select * from public.time_corrections tc
     where tc.time_entry_id = t.id and tc.status = 'APPROVED'
     order by tc.decided_at desc limit 1
  ) c on true;

grant select on time_entries_effective to authenticated;

/*
 * The pay figure, now reading the same hours attendance does.
 *
 * Replaced, not dropped, and the two new columns go on the end — which is
 * the only shape change `create or replace view` accepts. The first draft
 * dropped it with `cascade` and took `unit_labour_against_revenue`,
 * `unit_profit_daily`, `unit_overview`, `venue_overview` and
 * `accounting_export` with it: five views, silently, in a migration whose
 * stated subject was payroll. `cascade` on a view this far down the stack is
 * never the right tool.
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
    -- Carried out, because a day where somebody forgot to clock out is a day
    -- whose figure is short and nothing else would say so.
    w.open_punches,
    w.any_corrected as hours_were_corrected
  from worked w
  join public.employees e on e.id = w.employee_id
  left join lateral public.pay_rate_on(w.employee_id, w.on_date) r(basis, amount) on true
  where public.can_read_section('PAY', w.org_id, null::uuid);

grant select on labour_cost_daily to authenticated;

do $$ begin
  create type payroll_status as enum ('DRAFT', 'EXPORTED', 'SUPERSEDED');
exception when duplicate_object then null; end $$;

create table if not exists payroll_runs (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  period_from date not null,
  period_to date not null,
  status payroll_status not null default 'DRAFT',

  built_at timestamptz not null default now(),
  built_by_email text,
  exported_at timestamptz,
  exported_by_email text,

  /* A re-run names the run it replaces and says why. */
  supersedes_id uuid references payroll_runs(id) on delete set null,
  reason text,
  note text,

  constraint payroll_runs_order check (period_to >= period_from)
);

create index if not exists idx_payroll_runs_period
  on payroll_runs(org_id, period_from, period_to);

create table if not exists payroll_lines (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  run_id uuid not null references payroll_runs(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete restrict,

  /* Copied, not joined. A bureau's file is a record of what was sent, and an
     employee renamed or reassigned afterwards does not change what was. */
  employee_number text,
  employee_name text,
  business_unit_code text,

  basis pay_basis,
  hours numeric(10,3),
  rate numeric(18,5),
  gross numeric(18,5),

  /* Said on the line, so a short figure explains itself on the file. */
  open_punches integer not null default 0,
  corrections_applied integer not null default 0,
  days_worked integer not null default 0,

  constraint payroll_lines_once unique (run_id, employee_id)
);

create index if not exists idx_payroll_lines_run on payroll_lines(run_id);

drop trigger if exists payroll_runs_set_org on payroll_runs;
create trigger payroll_runs_set_org before insert on payroll_runs
  for each row execute function public.set_org_id();
drop trigger if exists payroll_lines_set_org on payroll_lines;
create trigger payroll_lines_set_org before insert on payroll_lines
  for each row execute function public.set_org_id();

/*
 * Build a run. Returns its id.
 *
 * A draft, deliberately: building and sending are different acts, and the
 * figures want reading before anybody presses the second one.
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
    raise exception 'you do not have edit access to Pay' using errcode = '42501';
  end if;

  if p_to < p_from then
    raise exception 'a pay period ends after it starts';
  end if;

  /*
   * The control this file exists for. An overlapping exported run means
   * somebody is about to be paid twice for the same days, which costs the
   * venue the period and is very hard to get back.
   *
   * Superseding is allowed, because payroll genuinely does need re-runs —
   * but it names the run being replaced and says why, and both stay on the
   * record.
   */
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
     business_unit_code, basis, hours, rate, gross,
     open_punches, corrections_applied, days_worked)
  select
    p_org, run, d.employee_id,
    e.employee_number,
    btrim(e.first_name || ' ' || e.last_name),
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
  group by d.employee_id, e.employee_number, e.first_name, e.last_name, b.code;

  return run;
end $$;

revoke all on function public.build_payroll_run(uuid, date, date, uuid, text) from public;
grant execute on function public.build_payroll_run(uuid, date, date, uuid, text) to authenticated;

/*
 * Send it.
 *
 * Separate from building, and it is what makes the period unrepeatable. The
 * earlier run it supersedes is marked rather than deleted: a file was sent
 * to a bureau and no amount of tidying up here unsends it.
 */
create or replace function public.export_payroll_run(p_run uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  lines integer;
begin
  select * into r from public.payroll_runs where id = p_run;
  if r.id is null then
    raise exception 'there is no such payroll run';
  end if;

  if not public.can_write_section('PAY', r.org_id) then
    raise exception 'you do not have edit access to Pay' using errcode = '42501';
  end if;

  if r.status <> 'DRAFT' then
    raise exception 'this run was already exported on %', r.exported_at::date
      using hint = 'Build a new run that supersedes it, and say why.';
  end if;

  select count(*) into lines from public.payroll_lines where run_id = p_run;
  if lines = 0 then
    raise exception 'there is nothing to export for % to %', r.period_from, r.period_to
      using hint = 'Nobody has approved hours in that period.';
  end if;

  update public.payroll_runs
     set status = 'EXPORTED',
         exported_at = now(),
         exported_by_email = auth.jwt() ->> 'email'
   where id = p_run;

  if r.supersedes_id is not null then
    update public.payroll_runs
       set status = 'SUPERSEDED'
     where id = r.supersedes_id and status = 'EXPORTED';
  end if;

  return lines;
end $$;

revoke all on function public.export_payroll_run(uuid) from public;
grant execute on function public.export_payroll_run(uuid) to authenticated;

/*
 * The file.
 *
 * Column names are plain words rather than a bureau's codes, because there
 * is no such thing as the payroll format — every provider wants its own, and
 * a mapping step is somebody's five minutes where guessing wrong is their
 * month. Whoever maps it needs to see what each number is.
 */
create or replace view payroll_export_lines
with (security_invoker = true) as
  select
    l.org_id,
    l.run_id,
    r.period_from,
    r.period_to,
    r.status,
    l.employee_number,
    l.employee_name,
    l.business_unit_code,
    l.basis,
    l.days_worked,
    l.hours,
    l.rate,
    l.gross,
    l.open_punches,
    l.corrections_applied
  from public.payroll_lines l
  join public.payroll_runs r on r.id = l.run_id;

grant select on payroll_export_lines to authenticated;

alter table payroll_runs enable row level security;
alter table payroll_lines enable row level security;

drop policy if exists payroll_runs_read on payroll_runs;
create policy payroll_runs_read on payroll_runs for select to authenticated
  using (public.can_read_section('PAY', org_id));
drop policy if exists payroll_runs_write on payroll_runs;
create policy payroll_runs_write on payroll_runs for all to authenticated
  using (public.auth_can_write(org_id) and public.can_read_section('PAY', org_id))
  with check (public.auth_can_write(org_id));

drop policy if exists payroll_lines_read on payroll_lines;
create policy payroll_lines_read on payroll_lines for select to authenticated
  using (public.can_read_section('PAY', org_id));
drop policy if exists payroll_lines_write on payroll_lines;
create policy payroll_lines_write on payroll_lines for all to authenticated
  using (public.auth_can_write(org_id) and public.can_read_section('PAY', org_id))
  with check (public.auth_can_write(org_id));

grant select on payroll_runs to authenticated;
grant select on payroll_lines to authenticated;

drop trigger if exists payroll_runs_section_guard on payroll_runs;
create trigger payroll_runs_section_guard
  before insert or update or delete on payroll_runs
  for each row execute function public.require_section_write('PAY');
drop trigger if exists payroll_lines_section_guard on payroll_lines;
create trigger payroll_lines_section_guard
  before insert or update or delete on payroll_lines
  for each row execute function public.require_section_write('PAY');

delete from public.section_read_rules
 where table_name in ('payroll_runs', 'payroll_lines');
insert into public.section_read_rules (table_name, section_code) values
  ('payroll_runs', 'PAY'),
  ('payroll_lines', 'PAY');

comment on view time_entries_effective is
  'The hours, once. `attendance` applied approved corrections and `labour_cost_daily` did not, so a correction moved what somebody worked and not what they were paid. See 0114.';
comment on table payroll_runs is
  'An exported period cannot be exported again: paying a fortnight twice is hard to claw back. A re-run supersedes the earlier one by name, with a reason. See 0114.';
