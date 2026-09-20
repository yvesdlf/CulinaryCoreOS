-- ---------------------------------------------------------------------------
-- Reference numbers that say what, where and when
-- ---------------------------------------------------------------------------
--   REQ-KIT-260809-001
--   │   │   │      └── sequence, restarting each day
--   │   │   └───────── the date, yymmdd
--   │   └───────────── business unit — first three letters of its cost centre
--   └───────────────── document type
--
-- The scheme this replaces was REQ-2026-0001: a running number per year, with
-- no unit and no date. It told a buyer nothing without opening the document,
-- and by November nobody could say whether 0847 was from last week or March.
--
-- The important half of this migration is not the format. It is that the
-- sequence is allocated *here*.
--
-- It used to be computed in the browser, by reading every existing reference
-- and adding one to the highest. Two people raising a requisition in the same
-- second both read the same list, both compute 001, and the second one to save
-- is refused by the unique index — at the moment somebody is trying to place an
-- order, with an error about a constraint they have never heard of. On a busy
-- morning with a kitchen and a bar both ordering, that is not a rare race.
--
-- `insert ... on conflict do update ... returning` takes a row lock for the
-- duration of the statement, so two concurrent callers serialise and get 001
-- and 002. That is the whole mechanism, and it is why the counter lives in its
-- own table rather than being derived by counting documents — a count is a read
-- and reads do not serialise.
--
-- Existing references are left exactly as they are. A venue's purchase orders
-- keep the numbers its suppliers already have on file; the app can read both.
-- ---------------------------------------------------------------------------

create table if not exists document_sequences (
  org_id uuid not null references organizations(id) on delete cascade,
  doc_type text not null,
  unit_code text not null,
  day date not null,
  last_seq integer not null default 0,

  primary key (org_id, doc_type, unit_code, day),
  constraint document_sequences_seq check (last_seq >= 0)
);

/*
 * The unit code for a cost centre, department or free-text name.
 *
 * First three characters, letters and digits only. KITCHEN gives KIT, BAR
 * gives BAR, FOH gives FOH. A two-character unit stays two characters — "IT"
 * padded to three is unrecognisable as the IT department.
 *
 * Mirrors unitCode() in the engine. Duplicated deliberately: the browser needs
 * it to show a preview before anything is saved, and the database needs it
 * because the browser must not be the one deciding. The tests pin both.
 */
create or replace function public.unit_code(p_source text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(left(regexp_replace(upper(coalesce(p_source, '')), '[^A-Z0-9]', '', 'g'), 3), ''),
    'GEN');
$$;

/*
 * Allocate the next reference for a document type and unit, today.
 *
 * SECURITY DEFINER so it can write the counter for a caller who has no direct
 * grant on it — the counter is infrastructure, not something anybody edits.
 *
 * Returns the whole reference rather than a number, so the format lives in one
 * place. A caller that assembled it from parts could assemble it differently.
 */
create or replace function public.next_document_reference(
  p_type text,
  p_unit text,
  p_org uuid default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.next_document_reference(text, text, uuid) from public;
grant execute on function public.next_document_reference(text, text, uuid) to authenticated;
grant execute on function public.unit_code(text) to authenticated;

/*
 * The unit a requisition belongs to.
 *
 * Its cost centre, which is what "business unit" means here — the venue's cost
 * centres are Kitchen, Bar and Front of house, and their codes give exactly the
 * KIT, BAR and FOH the scheme calls for. Falling back to the department only
 * where no cost centre is set.
 */
create or replace function public.requisition_unit_code(p_requisition uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.unit_code(c.code)
    from public.requisitions r
    left join public.cost_centres c on c.id = r.cost_centre_id
   where r.id = p_requisition;
$$;

grant execute on function public.requisition_unit_code(uuid) to authenticated;

-- ── Tenancy ─────────────────────────────────────────────────────────────────
/*
 * Readable so a screen can show what the next number will be. Not writable by
 * anybody: the counter is only ever moved by the function above, which holds
 * the lock that makes it correct. A hand-edited counter reissues a reference
 * that a supplier already has.
 */
alter table document_sequences enable row level security;

create policy document_sequences_read on document_sequences
  for select to authenticated
  using (org_id in (select public.auth_org_ids()));

grant select on document_sequences to authenticated;

comment on table document_sequences is
  'Per day, per unit, per document type counter. Only next_document_reference() moves it.';
comment on function public.next_document_reference(text, text, uuid) is
  'Allocates the next reference. Race-free: the upsert locks the row for the statement.';
