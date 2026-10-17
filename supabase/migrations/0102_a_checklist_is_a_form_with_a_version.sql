-- ---------------------------------------------------------------------------
-- A checklist is a form with a version, and a run of it is evidence
-- ---------------------------------------------------------------------------
-- `checklist_templates` already exists and is not this. It is the onboarding
-- and offboarding task list from 0030 — one row per task, with a due offset
-- and a blocking flag — and it stays exactly as it is. What is missing is
-- the general thing both briefs describe: a form somebody fills in, over and
-- over, and whose answers are the record that it was filled in.
--
-- Opening and closing checks, line checks before service, room inspections,
-- supplier audits. All the same shape, all currently done on paper or not at
-- all.
--
-- Modelled on `haccp_forms`, which has been a forms builder since 0035 with
-- its items in a `fields` jsonb. Deliberately the same shape rather than a
-- third convention: this codebase already has two ways to describe a form
-- and a third would be the one that drifts. The difference is that a HACCP
-- form is a legal record of a critical control point, and this one is not —
-- which is why they stay separate tables rather than one with a flag.
--
-- Two rules the versioning exists for.
--
-- A template is versioned and a run keeps the version it was filled in
-- against. Change the questions and last month's runs must still read as
-- the answers to the questions that were asked, not to the ones that exist
-- now. An inspector reading a closing check from March is entitled to see
-- March's questions.
--
-- A failed item that matters raises a request, through the existing front
-- door (0066) rather than a second notification path. A checklist that
-- records a broken fridge and tells nobody is a worse outcome than no
-- checklist, because it creates a record that somebody knew.
-- ---------------------------------------------------------------------------

do $$ begin
  create type checklist_run_status as enum ('OPEN', 'COMPLETED', 'ABANDONED');
exception when duplicate_object then null; end $$;

create table if not exists checklist_forms (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  business_unit_id uuid references business_units(id) on delete set null,

  code text,
  title text not null,
  category text,
  /*
   * The questions, as `haccp_forms.fields` does it. Each item:
   *   { key, label, type, required, min, max, options, raises_request }
   * `key` is what an answer refers to, so renaming a label does not orphan
   * every answer ever given.
   */
  items jsonb not null default '[]'::jsonb,

  /*
   * Bumped whenever the items change. A run records the version it used, so
   * a form can be edited without rewriting what people answered.
   */
  version integer not null default 1,
  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint checklist_forms_titled check (btrim(title) <> ''),
  constraint checklist_forms_items_array check (jsonb_typeof(items) = 'array')
);

create table if not exists checklist_runs (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  form_id uuid not null references checklist_forms(id) on delete restrict,
  /* The questions as they were, not as they are. */
  form_version integer not null,
  items_at_the_time jsonb not null,

  business_unit_id uuid references business_units(id) on delete set null,
  location_id uuid references locations(id) on delete set null,
  /* What it was about, where it was about something: a room, an asset. */
  entity_type text,
  entity_id uuid,

  status checklist_run_status not null default 'OPEN',
  started_by_email text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by_email text,
  passed boolean,
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists checklist_answers (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  run_id uuid not null references checklist_runs(id) on delete cascade,

  item_key text not null,
  value text,
  passed boolean,
  note text,
  answered_by_email text,
  answered_at timestamptz not null default now(),

  constraint checklist_answers_unique unique (run_id, item_key)
);

create index if not exists idx_checklist_runs_form on checklist_runs(org_id, form_id, started_at desc);
create index if not exists idx_checklist_answers_run on checklist_answers(run_id);

/*
 * Editing the questions bumps the version.
 *
 * Done here rather than asked of the caller, because a version somebody has
 * to remember to increment is one that silently stops being incremented —
 * and then last month's runs quietly start reading against this month's
 * questions.
 */
create or replace function public.bump_checklist_version()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.items is distinct from old.items then
    new.version := old.version + 1;
  end if;
  return new;
end $$;

create or replace function public.set_checklist_child_org()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent_org uuid;
begin
  if tg_table_name = 'checklist_runs' then
    select f.org_id into parent_org from public.checklist_forms f where f.id = new.form_id;
    if parent_org is null then raise exception 'no such checklist'; end if;
  else
    select r.org_id into parent_org from public.checklist_runs r where r.id = new.run_id;
    if parent_org is null then raise exception 'no such checklist run'; end if;
  end if;
  new.org_id := parent_org;
  return new;
end $$;

/*
 * A run takes a copy of the questions when it starts.
 *
 * Copied rather than referenced by version number, because a form that is
 * later deleted or whose history is not kept would otherwise leave answers
 * with nothing to answer.
 */
create or replace function public.snapshot_checklist_items()
returns trigger language plpgsql security definer set search_path = '' as $$
declare f record;
begin
  select version, items into f from public.checklist_forms where id = new.form_id;
  new.form_version := coalesce(new.form_version, f.version);
  new.items_at_the_time := coalesce(new.items_at_the_time, f.items);
  if auth.uid() is not null then
    new.started_by_email := coalesce(new.started_by_email, auth.jwt() ->> 'email');
  end if;
  return new;
end $$;

/*
 * Whether an answer passes, from the question as it was asked.
 *
 * Read from the run's own snapshot rather than the live form, so an answer
 * given in March is judged against March's limits.
 */
create or replace function public.assess_checklist_answer()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  run record;
  n numeric;
begin
  select * into run from public.checklist_runs r where r.id = new.run_id;

  select i into item
    from jsonb_array_elements(run.items_at_the_time) i
   where i ->> 'key' = new.item_key
   limit 1;

  if item is null then
    raise exception 'this checklist has no item called %', new.item_key
      using hint = 'The questions are fixed when the run starts.';
  end if;

  if auth.uid() is not null then
    new.answered_by_email := coalesce(new.answered_by_email, auth.jwt() ->> 'email');
  end if;

  -- An unanswered required item is not a pass, and is not a fail either: it
  -- is unanswered, which `complete_checklist_run` below refuses to close on.
  if new.value is null or btrim(new.value) = '' then
    new.passed := null;
    return new;
  end if;

  case item ->> 'type'
    when 'yes_no' then
      new.passed := lower(btrim(new.value)) in ('yes', 'true', 'y', 'ok');
    when 'number', 'temperature' then
      begin
        n := new.value::numeric;
      exception when others then
        raise exception '% is not a number for %', new.value, new.item_key;
      end;
      new.passed :=
        (item ->> 'min' is null or n >= (item ->> 'min')::numeric)
        and (item ->> 'max' is null or n <= (item ->> 'max')::numeric);
    else
      -- Text, choice, photo, signature: answering is passing. There is
      -- nothing to compare them against, and inventing a rule would make
      -- the pass rate mean something different per item type.
      new.passed := true;
  end case;

  return new;
end $$;

/*
 * Closing a run.
 *
 * Refuses while a required item is unanswered, because a checklist with
 * gaps is not evidence that anything was checked — it is evidence that
 * somebody pressed a button.
 *
 * A failed item that the form says should raise a request raises one,
 * through the existing front door rather than a second path.
 */
create or replace function public.complete_checklist_run(p_run uuid, p_note text default null)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  run record;
  missing text;
  failed_count integer;
  rt record;
  item jsonb;
  ans record;
begin
  select * into run from public.checklist_runs where id = p_run;
  if run is null then raise exception 'no such checklist run'; end if;
  if not public.can_write_section('HYGIENE', run.org_id) then
    raise exception 'you do not have edit access to HYGIENE' using errcode = '42501';
  end if;
  if run.status <> 'OPEN' then
    raise exception 'this checklist has already been closed';
  end if;

  select string_agg(i ->> 'label', ', ') into missing
    from jsonb_array_elements(run.items_at_the_time) i
   where coalesce((i ->> 'required')::boolean, false)
     and not exists (
       select 1 from public.checklist_answers a
        where a.run_id = p_run and a.item_key = i ->> 'key'
          and a.passed is not null);

  if missing is not null then
    raise exception 'still to answer: %', missing
      using hint = 'A checklist with gaps is not evidence it was done.';
  end if;

  select count(*) into failed_count
    from public.checklist_answers a where a.run_id = p_run and a.passed is false;

  -- Anything that failed and asks to be chased, raised once per run.
  for ans in
    select a.item_key from public.checklist_answers a
     where a.run_id = p_run and a.passed is false
  loop
    select i into item
      from jsonb_array_elements(run.items_at_the_time) i
     where i ->> 'key' = ans.item_key limit 1;

    if coalesce((item ->> 'raises_request')::boolean, false) then
      select * into rt from public.request_types
       where org_id = run.org_id and active
       order by (code = coalesce(item ->> 'request_type_code', '')) desc
       limit 1;

      if rt.id is not null then
        insert into public.requests
          (org_id, request_type_id, business_unit_id, title, detail,
           location_id, priority, raised_by_email)
        values (run.org_id, rt.id, run.business_unit_id,
                'Checklist: ' || (item ->> 'label'),
                'Failed on a checklist run. Answer was "' ||
                  coalesce((select value from public.checklist_answers
                             where run_id = p_run and item_key = ans.item_key), '') || '".',
                run.location_id,
                coalesce(rt.default_priority, 'NORMAL'),
                coalesce(auth.jwt() ->> 'email', run.started_by_email));
      end if;
    end if;
  end loop;

  update public.checklist_runs
     set status = 'COMPLETED',
         completed_at = now(),
         completed_by_email = coalesce(auth.jwt() ->> 'email', started_by_email),
         passed = (failed_count = 0),
         note = coalesce(p_note, note),
         updated_at = now()
   where id = p_run;

  return failed_count = 0;
end $$;

revoke all on function public.complete_checklist_run(uuid, text) from public;
grant execute on function public.complete_checklist_run(uuid, text) to authenticated;

drop trigger if exists checklist_forms_set_org on checklist_forms;
create trigger checklist_forms_set_org before insert on checklist_forms
  for each row execute function public.set_org_id();
drop trigger if exists checklist_forms_touch on checklist_forms;
create trigger checklist_forms_touch before update on checklist_forms
  for each row execute function public.set_updated_at();
drop trigger if exists checklist_forms_zz_version on checklist_forms;
create trigger checklist_forms_zz_version before update on checklist_forms
  for each row execute function public.bump_checklist_version();

drop trigger if exists checklist_runs_set_org on checklist_runs;
create trigger checklist_runs_set_org before insert on checklist_runs
  for each row execute function public.set_checklist_child_org();
drop trigger if exists checklist_runs_zz_snapshot on checklist_runs;
create trigger checklist_runs_zz_snapshot before insert on checklist_runs
  for each row execute function public.snapshot_checklist_items();
drop trigger if exists checklist_runs_touch on checklist_runs;
create trigger checklist_runs_touch before update on checklist_runs
  for each row execute function public.set_updated_at();

drop trigger if exists checklist_answers_set_org on checklist_answers;
create trigger checklist_answers_set_org before insert on checklist_answers
  for each row execute function public.set_checklist_child_org();
drop trigger if exists checklist_answers_zz_assess on checklist_answers;
create trigger checklist_answers_zz_assess before insert or update on checklist_answers
  for each row execute function public.assess_checklist_answer();

alter table checklist_forms enable row level security;
alter table checklist_runs enable row level security;
alter table checklist_answers enable row level security;

drop policy if exists checklist_forms_read on checklist_forms;
create policy checklist_forms_read on checklist_forms for select to authenticated
  using (public.can_read_section('HYGIENE', org_id));
drop policy if exists checklist_forms_write on checklist_forms;
create policy checklist_forms_write on checklist_forms for insert to authenticated
  with check (public.auth_can_write(org_id));
drop policy if exists checklist_forms_update on checklist_forms;
create policy checklist_forms_update on checklist_forms for update to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));

drop policy if exists checklist_runs_read on checklist_runs;
create policy checklist_runs_read on checklist_runs for select to authenticated
  using (public.can_read_section('HYGIENE', org_id));
drop policy if exists checklist_runs_write on checklist_runs;
create policy checklist_runs_write on checklist_runs for insert to authenticated
  with check (public.auth_can_write(org_id));
drop policy if exists checklist_runs_update on checklist_runs;
create policy checklist_runs_update on checklist_runs for update to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));

drop policy if exists checklist_answers_read on checklist_answers;
create policy checklist_answers_read on checklist_answers for select to authenticated
  using (public.can_read_section('HYGIENE', org_id));
drop policy if exists checklist_answers_write on checklist_answers;
create policy checklist_answers_write on checklist_answers for insert to authenticated
  with check (public.auth_can_write(org_id));
drop policy if exists checklist_answers_update on checklist_answers;
create policy checklist_answers_update on checklist_answers for update to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));

grant select, insert, update on checklist_forms to authenticated;
grant select, insert, update on checklist_runs to authenticated;
grant select, insert, update on checklist_answers to authenticated;

-- No deletes anywhere. A run that happened is the evidence it happened.

drop trigger if exists checklist_forms_section_guard on checklist_forms;
create trigger checklist_forms_section_guard
  before insert or update or delete on checklist_forms
  for each row execute function public.require_section_write('HYGIENE');
drop trigger if exists checklist_runs_section_guard on checklist_runs;
create trigger checklist_runs_section_guard
  before insert or update or delete on checklist_runs
  for each row execute function public.require_section_write('HYGIENE');
drop trigger if exists checklist_answers_section_guard on checklist_answers;
create trigger checklist_answers_section_guard
  before insert or update or delete on checklist_answers
  for each row execute function public.require_section_write('HYGIENE');

delete from public.section_read_rules
 where table_name in ('checklist_forms', 'checklist_runs', 'checklist_answers');
insert into public.section_read_rules (table_name, section_code) values
  ('checklist_forms', 'HYGIENE'),
  ('checklist_runs', 'HYGIENE'),
  ('checklist_answers', 'HYGIENE');

comment on table checklist_forms is
  'A reusable form. Versioned, so a run keeps the questions it was actually asked. Not haccp_forms, which is a legal CCP record. See 0102.';
comment on column checklist_runs.items_at_the_time is
  'The questions as they were when this run started, copied rather than referenced. See 0102.';
