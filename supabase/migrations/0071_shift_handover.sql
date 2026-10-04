-- ---------------------------------------------------------------------------
-- Handover
-- ---------------------------------------------------------------------------
-- Gap 14: "what broke, who is coming, which guest is unhappy — all of it lives
-- in WhatsApp, which is exactly what this is meant to replace."
--
-- The roadmap calls it "small, and probably the most-used screen in the
-- product", and both halves of that are the design brief. Small, because a
-- handover anybody has to think about is a handover that goes back to
-- WhatsApp. Most-used, because it is the only record in this schema that is
-- written at the end of every shift by everybody.
--
-- ## Why WhatsApp wins, and what has to be true to beat it
--
-- WhatsApp wins because it takes four seconds and the other person definitely
-- reads it. It loses because nothing is searchable, nothing is linked to the
-- job it is about, and the person who comes back from four days off has no way
-- to catch up.
--
-- So three positions:
--
-- **An item can be a pointer rather than a sentence.** "The tap is still
-- broken" retyped every night for a week is four sentences that cannot be
-- counted, chased or closed. An item that names the request is the same note
-- and is also the thing itself: when the request is resolved, every handover
-- that mentioned it says so.
--
-- **Published is append-only.** A handover is a record of what was said at the
-- time, and what somebody knew at ten o'clock is the whole point of reading it
-- later. Before it is published it is a draft and belongs to whoever is
-- writing it; after, it belongs to the record.
--
-- **Acknowledgement is a separate act by a different person.** "I have read
-- this" is the one fact a WhatsApp message cannot give you — the blue ticks
-- say it reached a phone. Here it is a row with a name and a time, and a
-- handover nobody acknowledged is visible as exactly that.
--
-- ## One per department per day per service
--
-- Not per person. Two chefs finishing the same shift write one handover
-- between them, which is what happens in a kitchen, and a model that demanded
-- one each would be filled in by neither.
-- ---------------------------------------------------------------------------

create type handover_status as enum ('DRAFT', 'PUBLISHED');

create type handover_item_kind as enum (
  'BROKEN',     -- Something is not working
  'GUEST',      -- Somebody is unhappy, or somebody is coming
  'STOCK',      -- Ran out, running out, delivery arrived short
  'PEOPLE',     -- Who is off, who is covering, who is new
  'SAFETY',     -- Anything a food-safety or security person must know
  'NOTE'        -- Everything else, deliberately last
);

create table if not exists handovers (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  business_unit_id uuid not null references business_units(id) on delete restrict,

  on_date date not null default current_date,
  /*
   * Lunch and dinner are two handovers in a restaurant and one in a hotel's
   * back office. Null means the day, which is the shape a venue with one shift
   * gets without configuring anything.
   */
  service text,

  status handover_status not null default 'DRAFT',

  written_by_employee_id uuid references employees(id) on delete set null,
  written_by_email text,
  published_at timestamptz,

  /* Read by whom, and when. Not a flag: the name is the point. */
  acknowledged_by_employee_id uuid references employees(id) on delete set null,
  acknowledged_by_email text,
  acknowledged_at timestamptz,

  summary text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint handovers_one_per_service unique (business_unit_id, on_date, service),
  constraint handovers_published_has_a_time
    check ((status = 'PUBLISHED') = (published_at is not null))
);

create index if not exists idx_handovers_unit on handovers(business_unit_id, on_date desc);
create index if not exists idx_handovers_unread
  on handovers(org_id, published_at desc)
  where status = 'PUBLISHED' and acknowledged_at is null;

create table if not exists handover_items (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  handover_id uuid not null references handovers(id) on delete cascade,

  kind handover_item_kind not null default 'NOTE',
  note text not null,

  /*
   * The thing itself, where there is one.
   *
   * An item that names a request is not a copy of it: the handover says "this
   * is outstanding" and the request says what has happened to it since. A week
   * of handovers each retyping "the tap is still broken" is four sentences
   * that cannot be counted, chased or closed, and a venue reading them learns
   * nothing it could not have learned from the first.
   */
  request_id uuid references requests(id) on delete set null,
  work_order_id uuid references work_orders(id) on delete set null,

  created_at timestamptz not null default now(),

  constraint handover_items_note check (btrim(note) <> ''),
  -- One pointer at most. An item about two things is two items.
  constraint handover_items_one_link
    check (num_nonnulls(request_id, work_order_id) <= 1)
);

create index if not exists idx_handover_items_handover
  on handover_items(handover_id, kind);

-- ── What the client is not trusted to state ─────────────────────────────────

create or replace function public.enforce_handover()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  unit_org uuid;
  caller_email text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  select b.org_id into unit_org
    from public.business_units b where b.id = new.business_unit_id;
  if unit_org is null then
    raise exception 'there is no such department to hand over';
  end if;
  new.org_id := unit_org;

  if tg_op = 'INSERT' then
    if caller_email is not null then
      new.written_by_email := caller_email;
    elsif coalesce(btrim(new.written_by_email), '') = '' then
      raise exception 'a handover must record who wrote it';
    end if;
    if new.status = 'PUBLISHED' and new.published_at is null then
      new.published_at := now();
    end if;
    return new;
  end if;

  new.updated_at := now();

  /*
   * Published is a one-way door, and what was said stays said.
   *
   * A handover is read by somebody who was not there, to learn what was known
   * at the time. Editing it afterwards does not correct the record, it
   * replaces it — and the person who acted on the first version is left
   * holding a decision nobody can account for. A correction is the next
   * handover, or an item added to this one.
   */
  if old.status = 'PUBLISHED' then
    if new.summary is distinct from old.summary
       or new.status is distinct from old.status
       or new.on_date is distinct from old.on_date
       or new.service is distinct from old.service
       or new.business_unit_id is distinct from old.business_unit_id
    then
      raise exception 'a published handover does not change'
        using hint = 'Add an item to it, or write the next one. Both leave a record.';
    end if;
  end if;

  if new.status = 'PUBLISHED' and old.status = 'DRAFT' then
    new.published_at := now();
  end if;

  /*
   * Acknowledging is a different person's act, and the name is the point —
   * this is the one fact a message on a phone cannot give you.
   */
  if new.acknowledged_at is null and old.acknowledged_at is null
     and (new.acknowledged_by_email is distinct from old.acknowledged_by_email
          or new.acknowledged_by_employee_id is distinct from old.acknowledged_by_employee_id)
  then
    if new.status <> 'PUBLISHED' then
      raise exception 'a draft cannot be read by the next shift yet';
    end if;
    new.acknowledged_at := now();
    new.acknowledged_by_email := coalesce(caller_email, new.acknowledged_by_email);
  end if;

  return new;
end;
$$;

create trigger handovers_enforce
  before insert or update on handovers
  for each row execute function public.enforce_handover();

/*
 * An item belongs to its handover's venue, and cannot be added to one that is
 * already published — with one exception, which is the point.
 *
 * Adding to a published handover is allowed. That is how a correction is made
 * without rewriting history: the original items stay, the new one is stamped
 * with its own time, and a reader sees both and the order they arrived in.
 * What is refused is *changing* or removing one.
 */
create or replace function public.enforce_handover_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare parent record;
begin
  if tg_op = 'DELETE' then
    select h.status into parent from public.handovers h where h.id = old.handover_id;
    if parent.status = 'PUBLISHED' then
      raise exception 'an item cannot be removed from a published handover'
        using hint = 'Add one that says it was wrong. The record is what somebody read.';
    end if;
    return old;
  end if;

  select h.org_id, h.status into parent
    from public.handovers h where h.id = new.handover_id;
  if parent is null then
    raise exception 'there is no such handover';
  end if;
  new.org_id := parent.org_id;

  if tg_op = 'UPDATE' and parent.status = 'PUBLISHED' then
    raise exception 'an item on a published handover does not change'
      using hint = 'Add one that corrects it; both stay, in the order they arrived.';
  end if;

  return new;
end;
$$;

create trigger handover_items_enforce
  before insert or update or delete on handover_items
  for each row execute function public.enforce_handover_item();

-- ── Who may write one ───────────────────────────────────────────────────────

insert into app_sections (code, name, description, sort_order, is_core)
values ('HANDOVER', 'Handover',
        'What the last shift needs the next one to know. One per department per service.',
        18, true)
on conflict (code) do nothing;

alter table handovers enable row level security;
alter table handover_items enable row level security;

/*
 * Readable by the venue. A handover the next shift cannot find is a handover
 * that goes back to WhatsApp, and a chef covering another department for a
 * night needs to read theirs without being granted anything.
 */
create policy handovers_read on handovers
  for select to authenticated using (org_id in (select public.auth_org_ids()));
create policy handovers_write on handovers
  for all to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));

create policy handover_items_read on handover_items
  for select to authenticated using (org_id in (select public.auth_org_ids()));
create policy handover_items_write on handover_items
  for all to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));

grant select, insert, update, delete on handovers to authenticated;
grant select, insert, update, delete on handover_items to authenticated;

/*
 * Guarded by HANDOVER and scoped by department, which 0062 gives for nothing
 * because the table carries `business_unit_id`. A kitchen's handover is the
 * kitchen's to write.
 */
create trigger handovers_section_guard
  before insert or update or delete on handovers
  for each row execute function public.require_section_write('HANDOVER');
create trigger handover_items_section_guard
  before insert or update or delete on handover_items
  for each row execute function public.require_section_write('HANDOVER');

select public.refresh_section_unit_scoping();

-- ── What the screens read ───────────────────────────────────────────────────

/*
 * The last handover per department, with what is still outstanding on it.
 *
 * `open_items` counts the items whose request or job is still open — not the
 * items somebody ticked, because nobody ticks anything. A handover item that
 * points at a resolved request is resolved, and one that points at nothing is
 * a sentence that was true when it was written and is nobody's to close.
 */
create or replace view handover_board with (security_invoker = true) as
  select
    h.id,
    h.org_id,
    h.business_unit_id,
    b.code as unit_code,
    b.name as unit_name,
    h.on_date,
    h.service,
    h.status,
    h.summary,
    h.written_by_email,
    h.published_at,
    h.acknowledged_by_email,
    h.acknowledged_at,
    (select count(*) from public.handover_items i where i.handover_id = h.id) as item_count,
    (select count(*) from public.handover_items i
      left join public.requests r on r.id = i.request_id
      left join public.work_orders w on w.id = i.work_order_id
     where i.handover_id = h.id
       and (r.status is not null and r.status not in ('CLOSED','REJECTED','RESOLVED')
            or w.status is not null and w.status not in ('VERIFIED','CANCELLED'))
    ) as open_items,
    /*
     * Null until it is published, because an unread draft is not unread — it
     * has not been offered to anybody yet. Conflating the two would put every
     * half-written handover on somebody's list of things to chase.
     */
    case when h.status = 'PUBLISHED' then h.acknowledged_at is null end as unread
  from public.handovers h
  join public.business_units b on b.id = h.business_unit_id;

grant select on handover_board to authenticated;

comment on table handovers is
  'What the last shift needs the next one to know. Published is append-only: it is a record of what was known.';
comment on table handover_items is
  'One line each. An item that names a request is the request, not a copy of it.';
comment on view handover_board is
  'The handovers, with what is still open on them. "Unread" is null for a draft, which has not been offered to anybody.';
