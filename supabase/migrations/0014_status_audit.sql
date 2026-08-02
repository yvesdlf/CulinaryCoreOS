-- ---------------------------------------------------------------------------
-- Status audit trail
-- ---------------------------------------------------------------------------
-- SRS RCP-FUNC-006 AC6: status changes are logged. The question this answers
-- is asked after something has gone wrong — "who put this on the menu without
-- a price, and when" — so it has to be a record written at the time, not
-- something reconstructed from an updated_at column that only remembers the
-- last edit.
--
-- Append-only by policy as well as by intent: members may read their own
-- organisation's history and insert new entries, and nothing grants update or
-- delete. An audit trail that can be edited answers the same question as no
-- audit trail.
-- ---------------------------------------------------------------------------

create table if not exists recipe_status_events (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  recipe_id uuid not null references recipes(id) on delete cascade,
  from_status text,
  to_status text not null,
  -- Who, kept even if the account is later removed: the record is about what
  -- happened, and a null actor would quietly rewrite history.
  actor_id uuid,
  actor_email text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_recipe_status_events_recipe
  on recipe_status_events(recipe_id, created_at desc);

create trigger recipe_status_events_set_org
  before insert on recipe_status_events
  for each row execute function public.set_org_id();

alter table recipe_status_events enable row level security;

create policy recipe_status_events_read on recipe_status_events
  for select to authenticated
  using (org_id in (select public.auth_org_ids()));

create policy recipe_status_events_insert on recipe_status_events
  for insert to authenticated
  with check (public.auth_can_write(org_id));

-- Deliberately no update or delete policy, and no grant for them.
grant select, insert on recipe_status_events to authenticated;

comment on table recipe_status_events is
  'Append-only record of recipe status transitions. SRS RCP-FUNC-006 AC6.';
