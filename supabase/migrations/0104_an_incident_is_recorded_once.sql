-- ---------------------------------------------------------------------------
-- An incident is recorded once, and not everybody sees it
-- ---------------------------------------------------------------------------
-- `hr_cases` covers conduct, grievances and investigations about a person.
-- Nothing covers the other half: a guest who was ill, an allergen served by
-- mistake, a near miss with a fryer, a theft. Those are recorded in a
-- notebook behind the pass or not at all, and the one that matters most —
-- an allergen incident — is the one a regulator will ask to see.
--
-- Why not reuse `hr_cases`: its visibility is participation-based, which is
-- right for a grievance and wrong here. A guest complaint should be visible
-- to whoever runs the floor without anybody adding them to it, and an
-- allergen incident should be visible to the kitchen. Bolting a second
-- visibility model onto that table would make both harder to reason about,
-- and 0086 is a reminder of how badly participation-based visibility goes
-- wrong when it is loosened.
--
-- Severity drives who is told rather than a separate flag, because two
-- fields that must agree eventually disagree.
--
-- The close-out is the part people skip. An incident with no action and no
-- owner is a note; the status cannot reach CLOSED without both, for the
-- same reason a HACCP breach cannot be saved without saying what was done.
-- ---------------------------------------------------------------------------

do $$ begin
  create type incident_kind as enum
    ('GUEST_COMPLAINT', 'ALLERGEN', 'INJURY', 'NEAR_MISS', 'ILLNESS',
     'SECURITY', 'PROPERTY', 'OTHER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type incident_severity as enum ('LOW', 'MODERATE', 'SERIOUS', 'CRITICAL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type incident_status as enum
    ('OPEN', 'INVESTIGATING', 'ACTIONED', 'CLOSED', 'WITHDRAWN');
exception when duplicate_object then null; end $$;

create table if not exists incidents (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  business_unit_id uuid references business_units(id) on delete set null,
  location_id uuid references locations(id) on delete set null,

  reference text,
  kind incident_kind not null,
  severity incident_severity not null default 'LOW',
  status incident_status not null default 'OPEN',

  occurred_at timestamptz not null default now(),
  summary text not null,
  detail text,

  /*
   * Who it happened to, and who was involved.
   *
   * `employee_id` is nullable because most incidents are about a guest, and
   * a guest is deliberately not a record in this system — a name and a
   * contact on an incident is enough, and creating a guest table to hold
   * one complaint would be a larger promise than anybody made.
   */
  employee_id uuid references employees(id) on delete set null,
  guest_name text,
  guest_contact text,

  /* The dish, where one is implicated. An allergen incident always has one. */
  recipe_id uuid references recipes(id) on delete set null,
  allergens text[],

  reported_by_email text,
  owner_employee_id uuid references employees(id) on delete set null,
  action_taken text,
  closed_by_email text,
  closed_at timestamptz,
  withdrawn_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint incidents_summarised check (btrim(summary) <> '')
);

create index if not exists idx_incidents_open
  on incidents(org_id, status, occurred_at desc) where status <> 'CLOSED';
create index if not exists idx_incidents_kind on incidents(org_id, kind, occurred_at desc);

/*
 * An allergen incident names its allergens.
 *
 * `AGENTS.md` §8: the dangerous failure is a confident claim, and an
 * allergen incident recorded without saying which allergen is a record
 * nobody can act on — not for the guest, not for the kitchen, and not for
 * the regulator who asks what happened.
 */
create or replace function public.enforce_incident()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'ALLERGEN'
     and (new.allergens is null or array_length(new.allergens, 1) is null) then
    raise exception 'an allergen incident has to say which allergen'
      using hint = 'Naming it is the point of the record.';
  end if;

  if new.status = 'CLOSED' then
    if btrim(coalesce(new.action_taken, '')) = '' then
      raise exception 'an incident cannot be closed without saying what was done'
        using hint = 'A closed incident with no action is a note.';
    end if;
    if new.owner_employee_id is null then
      raise exception 'an incident cannot be closed without an owner'
        using hint = 'Somebody has to have been responsible for it.';
    end if;
    new.closed_by_email := coalesce(auth.jwt() ->> 'email', new.closed_by_email);
    new.closed_at := coalesce(new.closed_at, now());
  end if;

  if tg_op = 'INSERT' and auth.uid() is not null then
    new.reported_by_email := coalesce(new.reported_by_email, auth.jwt() ->> 'email');
  end if;

  return new;
end $$;

/*
 * A serious one tells somebody, now.
 *
 * Severity drives this rather than a separate "notify" flag: two fields
 * that have to agree eventually disagree, and the one that gets forgotten
 * is the one that would have sent the message.
 */
create or replace function public.announce_incident()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.severity in ('SERIOUS', 'CRITICAL')
     and (tg_op = 'INSERT' or new.severity is distinct from old.severity) then
    perform public.notify(
      new.org_id,
      'REQUEST_UNANSWERED'::public.notification_kind,
      initcap(replace(new.severity::text, '_', ' ')) || ' incident: ' || new.summary,
      coalesce(new.detail, new.summary),
      'ADMIN'::public.org_role,
      null, 'incidents', new.id);
  end if;
  return new;
end $$;

drop trigger if exists incidents_set_org on incidents;
create trigger incidents_set_org before insert on incidents
  for each row execute function public.set_org_id();
drop trigger if exists incidents_touch on incidents;
create trigger incidents_touch before update on incidents
  for each row execute function public.set_updated_at();
drop trigger if exists incidents_zz_enforce on incidents;
create trigger incidents_zz_enforce before insert or update on incidents
  for each row execute function public.enforce_incident();
drop trigger if exists incidents_announce on incidents;
create trigger incidents_announce after insert or update on incidents
  for each row execute function public.announce_incident();

alter table incidents enable row level security;

/*
 * Who sees what.
 *
 * An allergen incident is a kitchen matter and a guest complaint is a floor
 * matter, so both are readable with Hygiene or Administration. An injury or
 * an illness is about a person and reads as People — GDPR Article 9 health
 * data, which is why it is not simply open to anyone with Hygiene.
 */
drop policy if exists incidents_read on incidents;
create policy incidents_read on incidents for select to authenticated
  using (
    case
      when kind in ('INJURY', 'ILLNESS') then
        public.can_read_section('PEOPLE', org_id)
        or employee_id = public.auth_employee_id()
      else
        public.can_read_section('HYGIENE', org_id)
        or public.can_read_section('ADMIN', org_id)
    end
  );
drop policy if exists incidents_write on incidents;
create policy incidents_write on incidents for insert to authenticated
  with check (public.auth_can_write(org_id));
drop policy if exists incidents_update on incidents;
create policy incidents_update on incidents for update to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));

grant select, insert, update on incidents to authenticated;

-- No delete. An incident that happened happened; it is withdrawn, with a
-- reason, and stays readable.

drop trigger if exists incidents_section_guard on incidents;
create trigger incidents_section_guard
  before insert or update or delete on incidents
  for each row execute function public.require_section_write('HYGIENE');

delete from public.section_read_rules where table_name = 'incidents';
insert into public.section_read_rules (table_name, section_code, shared_because)
values ('incidents', null,
        'read by Hygiene or Administration, and health ones by People — see the policy');

/*
 * Allergen incidents, which are the ones a regulator asks about.
 *
 * Their own view because they are read as a set: what was served, to whom,
 * which allergen, and what was done. 1169/2011 is the instrument.
 */
create or replace view allergen_incidents
with (security_invoker = true) as
  select
    i.org_id,
    i.id as incident_id,
    i.reference,
    i.occurred_at,
    i.severity,
    i.status,
    i.allergens,
    i.recipe_id,
    r.name as dish,
    i.guest_name,
    i.summary,
    i.action_taken,
    i.closed_at,
    (i.status <> 'CLOSED') as still_open
  from public.incidents i
  left join public.recipes r on r.id = i.recipe_id
  where i.kind = 'ALLERGEN';

grant select on allergen_incidents to authenticated;

comment on table incidents is
  'Guest complaints, allergen incidents, injuries, near misses. hr_cases is the one about a person''s conduct; this is everything else. See 0104.';
comment on view allergen_incidents is
  'Allergen incidents as a set, which is how a 1169/2011 question is asked. See 0104.';
