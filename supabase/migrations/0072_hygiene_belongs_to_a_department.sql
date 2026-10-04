-- ---------------------------------------------------------------------------
-- Hygiene is not only the kitchen's
-- ---------------------------------------------------------------------------
-- Gap 24: "the bar, housekeeping and stewarding have no forms of their own,
-- though they all have legal obligations."
--
-- `haccp_forms` has had a `section` column since 0039 — a free-text label like
-- 'Facilities' or 'Temperature' — and nothing that says *whose* form it is.
-- Every venue therefore has one hygiene list, the kitchen writes it, and the
-- bar's glasswasher temperatures, housekeeping's chemical dilutions and
-- stewarding's pot-wash records are either on the kitchen's list or nowhere.
--
-- Two changes, and the second is the one that matters.
--
-- ## A form belongs to a department
--
-- One nullable column. Null means the whole venue, which is what every form in
-- every venue means today, so nothing changes for anybody — the same shape
-- 0062 used for the unit axis on permissions and for the same reason: an
-- access or compliance migration that silently changes what existing rows mean
-- is the one thing it must not do.
--
-- It also makes the overdue list answerable per department, which is the thing
-- a bar manager cannot get today: "what am *I* behind on" currently returns
-- the kitchen's fridge temperatures.
--
-- ## A failed check raises a job by itself
--
-- This is the half that changes behaviour rather than shape. A breach recorded
-- on a form is a sentence in a box; the fridge is still broken, and whether
-- anybody tells maintenance depends on whether the person who found it also
-- remembers to walk round and say so. Every venue that has ever failed an
-- inspection has a record of a breach nobody acted on.
--
-- So a breach on a form marked `raises_job` creates a request — not a work
-- order directly, and that is deliberate. 0066's front door exists so a
-- department can hand something to another department without knowing how that
-- department works; routing hygiene straight into `work_orders` would bypass
-- the routing, the response clock and the escalation that already exist, and
-- would have to reimplement all three the first time a breach needed to go to
-- housekeeping rather than maintenance.
--
-- The request carries the breach detail and points back at the record.
-- ---------------------------------------------------------------------------

alter table haccp_forms
  add column if not exists business_unit_id uuid
    references business_units(id) on delete set null,
  add column if not exists raises_job boolean not null default false,
  add column if not exists raises_request_type_id uuid
    references request_types(id) on delete set null;

comment on column haccp_forms.business_unit_id is
  'Whose form it is. Null means the whole venue, which is what every form meant before 0072.';
comment on column haccp_forms.raises_job is
  'Whether a breach on this form opens a request by itself, rather than relying on somebody walking round.';

create index if not exists idx_haccp_forms_unit
  on haccp_forms(business_unit_id) where business_unit_id is not null;

alter table haccp_records
  add column if not exists business_unit_id uuid
    references business_units(id) on delete set null,
  add column if not exists raised_request_id uuid
    references requests(id) on delete set null;

comment on column haccp_records.raised_request_id is
  'The request a breach on this record opened. Null where there was no breach, or the form does not raise one.';

create index if not exists idx_haccp_records_unit
  on haccp_records(business_unit_id, covers_date desc);

/*
 * A record inherits its form's department, never the client's.
 *
 * The same rule as every other inherited column in this schema: a record filed
 * under a department other than its form's would make "what is the bar behind
 * on" answer with somebody else's paperwork.
 */
create or replace function public.set_haccp_record_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select f.business_unit_id into new.business_unit_id
    from public.haccp_forms f where f.id = new.form_id;
  return new;
end;
$$;

create trigger haccp_records_unit
  before insert or update of form_id on haccp_records
  for each row execute function public.set_haccp_record_unit();

update haccp_records r
   set business_unit_id = f.business_unit_id
  from public.haccp_forms f
 where f.id = r.form_id and r.business_unit_id is distinct from f.business_unit_id;

-- ── A breach opens a request ────────────────────────────────────────────────

/*
 * The change that matters.
 *
 * A breach is only a finding if somebody acts on it, and relying on the person
 * who found it to also walk round and tell maintenance is how a venue ends up
 * with a documented breach and a broken fridge.
 *
 * It raises a **request**, not a work order. 0066's front door already knows
 * how to route, promise a response time and escalate when nobody answers;
 * writing into `work_orders` directly would bypass all three, and would have to
 * reimplement them the first time a breach needed to go to housekeeping rather
 * than to maintenance. The form chooses the kind of request, so a venue decides
 * where its own breaches go.
 *
 * Only on the transition into a breach. A record edited twice must not open two
 * requests, and a record that was already a breach when it was corrected must
 * not open a second one for the same fridge.
 */
create or replace function public.raise_request_for_breach()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  form record;
  kind uuid;
  new_request uuid;
begin
  if not new.breach then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.breach then
    return new;                      -- Already raised when it first failed.
  end if;
  if new.raised_request_id is not null then
    return new;
  end if;

  select f.raises_job, f.raises_request_type_id, f.title, f.business_unit_id, f.org_id
    into form
    from public.haccp_forms f where f.id = new.form_id;
  if form is null or not form.raises_job then
    return new;
  end if;

  /*
   * The form's own kind, or the venue's fault kind as a fallback. A form
   * marked as raising a job and pointing at nothing is a venue that half
   * configured it, and the honest behaviour is to send the breach somewhere
   * rather than to drop it because a column is null.
   */
  kind := form.raises_request_type_id;
  if kind is null then
    select t.id into kind from public.request_types t
     where t.org_id = form.org_id and t.code = 'FAULT' and t.active
     limit 1;
  end if;
  if kind is null then
    return new;                      -- Nowhere to send it. See the view below.
  end if;

  insert into public.requests
    (request_type_id, title, detail, priority, raised_from_unit_id, raised_by_email)
  values
    (kind,
     'Hygiene breach: ' || form.title,
     coalesce(new.breach_detail, 'A check on this form failed.')
       || case when new.corrective_action is null then ''
               else E'\n\nWhat was done at the time: ' || new.corrective_action end
       || E'\n\nRecorded on ' || to_char(new.covers_date, 'FMDD Month YYYY')
       || coalesce(' · ' || new.location, ''),
     'HIGH',
     form.business_unit_id,
     coalesce(new.completed_by_email, 'hygiene@system'))
  returning id into new_request;

  new.raised_request_id := new_request;
  return new;
end;
$$;

/*
 * Named so it runs after `haccp_records_unit`, which sets the department the
 * request is raised from. Triggers of the same timing fire in name order, and
 * 0058 learned what happens when that is left to chance.
 */
create trigger haccp_records_raise_breach
  before insert or update on haccp_records
  for each row execute function public.raise_request_for_breach();

-- ── What the screens read ───────────────────────────────────────────────────

/*
 * What each department is behind on.
 *
 * A form with no department is the venue's and counts for everybody, which is
 * why it appears under every unit rather than under none: "the whole venue's
 * fridge log" is the bar's problem too, and listing it nowhere would be how it
 * stops being done.
 */
create or replace view hygiene_by_unit with (security_invoker = true) as
  select
    b.org_id,
    b.id as business_unit_id,
    b.code as unit_code,
    b.name as unit_name,
    f.id as form_id,
    f.code as form_code,
    f.title as form_title,
    f.frequency,
    f.is_ccp,
    f.raises_job,
    f.business_unit_id is null as venue_wide,
    (select max(r.covers_date) from public.haccp_records r where r.form_id = f.id)
      as last_completed_on,
    (select count(*) from public.haccp_records r
      where r.form_id = f.id and r.breach
        and r.covers_date >= current_date - 30) as breaches_last_30_days,
    (select count(*) from public.haccp_records r
      where r.form_id = f.id and r.breach and r.raised_request_id is null
        and r.covers_date >= current_date - 30) as breaches_nobody_was_told_about
  from public.business_units b
  join public.haccp_forms f
    on f.org_id = b.org_id
   and (f.business_unit_id = b.id or f.business_unit_id is null)
  where f.active
    and b.active
    and b.org_id in (select public.auth_org_ids());

grant select on hygiene_by_unit to authenticated;

comment on view hygiene_by_unit is
  'Which forms each department is responsible for, and what it has failed. A venue-wide form appears under every department, because it is everybody''s.';
