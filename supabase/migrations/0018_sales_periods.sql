-- ---------------------------------------------------------------------------
-- Sales periods — units sold per dish, for menu engineering
-- ---------------------------------------------------------------------------
-- A menu engineering analysis is only worth acting on if everybody is looking
-- at the same numbers. Held in a browser, an import is one person's private
-- reading of a file nobody else has, and it disappears when they close the
-- tab. So a period is a record.
--
-- The period is the unit, not the line. "April" is the thing a chef compares
-- against March and reruns after fixing a mis-named dish; deleting and
-- reimporting it whole is the normal correction, which is why the lines
-- cascade with it.
--
-- Unlike the stock ledger these rows are not append-only. A sales figure is a
-- statement about a month that can simply be wrong — a POS re-run, a dish
-- renamed after the fact — and correcting it is not a transaction that needs
-- an audit trail of its own.
-- ---------------------------------------------------------------------------

create table if not exists sales_periods (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  name text not null,
  starts_on date not null,
  ends_on date not null,

  -- Where the figures came from, so a made-up period is never mistaken for a
  -- POS export once both exist.
  source text not null default 'IMPORT',
  -- The file it was read from, for answering "which export was this".
  source_file text,

  actor_id uuid,
  actor_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sales_periods_dates check (ends_on >= starts_on)
);

create table if not exists sales_lines (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  period_id uuid not null references sales_periods(id) on delete cascade,
  recipe_id uuid not null references recipes(id) on delete cascade,

  units_sold numeric(18,3) not null,
  -- What the till actually took, after discounts. Null when the export did not
  -- carry it; the analysis works from cost and menu price either way.
  net_sales numeric(18,5),

  created_at timestamptz not null default now(),

  -- One figure per dish per period. A POS listing an item under two revenue
  -- centres is a question for the operator, not something to sum silently.
  constraint sales_lines_unique unique (period_id, recipe_id),
  constraint sales_lines_not_negative check (units_sold >= 0)
);

create index if not exists idx_sales_lines_period on sales_lines(period_id);
create index if not exists idx_sales_lines_recipe on sales_lines(recipe_id);
create index if not exists idx_sales_periods_org on sales_periods(org_id, starts_on desc);

-- ── Tenancy ─────────────────────────────────────────────────────────────────

create trigger sales_periods_set_org
  before insert on sales_periods
  for each row execute function public.set_org_id();

/*
 * Lines take the period's organization rather than the caller's default, so a
 * line can never end up in a different tenant from the period owning it.
 *
 * This gets its own function rather than reusing set_line_org_id, which
 * branches on table name between sub-recipe lines and recipe lines. A sales
 * line would fall through to its recipe branch and happen to work, because it
 * also has a recipe_id — the right answer for the wrong reason, and one that
 * breaks silently the next time that function is edited.
 */
create or replace function public.set_sales_line_org_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_org uuid;
begin
  select p.org_id into parent_org
    from public.sales_periods p where p.id = new.period_id;
  if parent_org is null then
    raise exception 'sales period not found for sales line';
  end if;
  new.org_id := parent_org;
  return new;
end;
$$;

create trigger sales_lines_set_org
  before insert on sales_lines
  for each row execute function public.set_sales_line_org_id();

alter table sales_periods enable row level security;
alter table sales_lines enable row level security;

create policy sales_periods_read on sales_periods
  for select to authenticated
  using (org_id in (select public.auth_org_ids()));
create policy sales_periods_write on sales_periods
  for insert to authenticated
  with check (public.auth_can_write(org_id));
create policy sales_periods_update on sales_periods
  for update to authenticated
  using (public.auth_can_write(org_id))
  with check (public.auth_can_write(org_id));
create policy sales_periods_delete on sales_periods
  for delete to authenticated
  using (public.auth_can_write(org_id));

create policy sales_lines_read on sales_lines
  for select to authenticated
  using (org_id in (select public.auth_org_ids()));
create policy sales_lines_write on sales_lines
  for insert to authenticated
  with check (public.auth_can_write(org_id));
create policy sales_lines_delete on sales_lines
  for delete to authenticated
  using (public.auth_can_write(org_id));

grant select, insert, update, delete on sales_periods to authenticated;
grant select, insert, delete on sales_lines to authenticated;

comment on table sales_periods is
  'A period of trading whose dish sales have been recorded, for menu engineering.';
comment on column sales_periods.source is
  'IMPORT for a POS export, SAMPLE for generated figures.';
