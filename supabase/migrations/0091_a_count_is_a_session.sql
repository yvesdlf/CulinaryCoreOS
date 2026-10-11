-- ---------------------------------------------------------------------------
-- A stock count is a session, not a pile of movements
-- ---------------------------------------------------------------------------
-- `stock_movements` has had a COUNT kind since 0016, and
-- `apps/web/src/engine/count-sheet.ts` already prints a sheet somebody walks
-- the store with. What has never existed is the thing in between: a session
-- that freezes what the books said, collects what was found, shows the
-- difference, gets approved by somebody other than the counter, and only
-- then moves stock.
--
-- Without it, a count is a row typed straight into the ledger. Nobody can
-- say what the books claimed at the moment of counting, nothing shows the
-- variance, and the person counting is the person adjusting.
--
-- This is the first item on the gap list in `docs/programme/GAP_RECONCILIATION.md`
-- because actual food cost, stock valuation and theoretical-versus-actual
-- all wait on it.
--
-- Four rules, each of which already cost something somewhere in this
-- repository:
--
--  1. A blank is not a zero. `AGENTS.md` §10: on a count sheet, "I did not
--     count this" and "there are none" are different statements, and
--     treating the first as the second writes off the shelf. `counted_qty`
--     is therefore nullable and an uncounted line posts nothing at all.
--
--  2. The expected figure is frozen when the session opens. Recomputing it
--     at posting time would quietly absorb every delivery that arrived while
--     somebody was walking the store, and the variance — the only number
--     anybody opens this screen for — would come out as zero.
--
--  3. Nobody approves their own count. `AGENTS.md` §5. And the approver is
--     taken from the session rather than from a column the client writes,
--     which is the whole of 0085.
--
--  4. Posting appends. `AGENTS.md` §4. The adjustment is a new movement, the
--     counted figure stays on the line, and both remain readable.
-- ---------------------------------------------------------------------------

do $$ begin
  create type stocktake_status as enum
    ('OPEN', 'COUNTING', 'SUBMITTED', 'APPROVED', 'POSTED', 'CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type stocktake_kind as enum ('FULL', 'PARTIAL', 'SPOT');
exception when duplicate_object then null; end $$;

create table if not exists stocktakes (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  business_unit_id uuid references business_units(id) on delete set null,
  location_id uuid references locations(id) on delete set null,

  reference text,
  kind stocktake_kind not null default 'FULL',
  status stocktake_status not null default 'OPEN',

  /*
   * The instant the books were frozen. Every line's expected quantity is the
   * ledger as at this moment, and the adjustment is dated here too — so a
   * delivery that landed while somebody was counting stays real and is not
   * silently cancelled out by the count.
   */
  snapshot_at timestamptz not null default now(),

  note text,
  opened_by uuid references auth.users(id) on delete set null,
  opened_by_email text,
  submitted_by_email text,
  submitted_at timestamptz,
  approved_by_email text,
  approved_at timestamptz,
  posted_at timestamptz,
  cancelled_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_stocktakes_org on stocktakes(org_id, status, snapshot_at desc);

create table if not exists stocktake_lines (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  stocktake_id uuid not null references stocktakes(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,

  -- What the ledger said at snapshot_at. Written once, when the line is made.
  expected_qty numeric(18,5) not null,

  /*
   * Null until somebody counts it, and null is a real answer: this shelf was
   * not reached. Posting skips it. A zero here means the opposite — somebody
   * looked and there was none — and posts the full write-off.
   */
  counted_qty numeric(18,5),
  count_unit text not null,
  counted_by_email text,
  counted_at timestamptz,

  note text,
  created_at timestamptz not null default now(),

  constraint stocktake_lines_unique unique (stocktake_id, product_id),
  constraint stocktake_lines_counted check (counted_qty is null or counted_qty >= 0)
);

create index if not exists idx_stocktake_lines_take on stocktake_lines(stocktake_id);

drop trigger if exists stocktakes_set_org on stocktakes;
create trigger stocktakes_set_org before insert on stocktakes
  for each row execute function public.set_org_id();
drop trigger if exists stocktakes_touch on stocktakes;
create trigger stocktakes_touch before update on stocktakes
  for each row execute function public.set_updated_at();
/*
 * Its own helper rather than `set_child_org_from_parent`, which is hardcoded
 * to goods receipts and supplier invoices. Adding a third branch to it is the
 * shape `AGENTS.md` §2 warns about — five migrations rewrote
 * `seed_organization_defaults` that way and the fifth dropped the fourth's
 * line. The codebase already keeps one small helper per table.
 *
 * The first draft reached for `set_line_org_id`, which is the recipe-lines
 * one and expects a `recipe_id`; every assertion in 33_stocktake.sql that
 * depended on a line existing went red with `record "new" has no field
 * "recipe_id"`.
 */
create or replace function public.set_stocktake_line_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare parent_org uuid;
begin
  select s.org_id into parent_org
    from public.stocktakes s where s.id = new.stocktake_id;
  if parent_org is null then
    raise exception 'the count this line belongs to does not exist';
  end if;
  new.org_id := parent_org;
  return new;
end;
$$;

drop trigger if exists stocktake_lines_set_org on stocktake_lines;
create trigger stocktake_lines_set_org before insert on stocktake_lines
  for each row execute function public.set_stocktake_line_org();

/*
 * Who may move it on, and who may not.
 *
 * The approver is read from the session, never from the row. 0085 is the
 * reason: the same trigger for purchasing approvals took the approver from
 * the columns the client sent, and a chef cleared ninety-nine million by
 * typing the owner's name into one.
 */
create or replace function public.enforce_stocktake_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'SUBMITTED' then
    if caller <> '' then
      new.submitted_by_email := auth.jwt() ->> 'email';
    end if;
    new.submitted_at := now();
    return new;
  end if;

  if new.status = 'APPROVED' then
    if old.status <> 'SUBMITTED' then
      raise exception 'a count is approved after it is submitted, not before'
        using hint = 'Submit the count first.';
    end if;
    -- Segregation of duties. Matched on the address because that is what the
    -- submitter is recorded by.
    if caller <> '' and lower(coalesce(old.submitted_by_email, '')) = caller then
      raise exception 'the person who counted this cannot approve it'
        using hint = 'Segregation of duties: ask someone else to approve.';
    end if;
    if caller <> '' then
      new.approved_by_email := auth.jwt() ->> 'email';
    end if;
    new.approved_at := now();
    return new;
  end if;

  if new.status = 'POSTED' and old.status <> 'APPROVED' then
    raise exception 'a count is posted after it is approved'
      using hint = 'It has to be approved first.';
  end if;

  return new;
end;
$$;

drop trigger if exists stocktakes_decision on stocktakes;
create trigger stocktakes_decision before update on stocktakes
  for each row execute function public.enforce_stocktake_decision();

/*
 * A counted line is frozen once the count leaves the floor.
 *
 * Without this the figure a manager approved and the figure that posts can
 * differ, which makes the approval decorative.
 */
create or replace function public.enforce_stocktake_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare st public.stocktake_status;
begin
  select s.status into st from public.stocktakes s
   where s.id = coalesce(new.stocktake_id, old.stocktake_id);

  if st in ('APPROVED', 'POSTED', 'CANCELLED') then
    raise exception 'this count is % and its lines can no longer change', lower(st::text);
  end if;

  if tg_op = 'UPDATE' and new.counted_qty is distinct from old.counted_qty then
    new.counted_at := now();
    if auth.uid() is not null then
      new.counted_by_email := auth.jwt() ->> 'email';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists stocktake_lines_guard on stocktake_lines;
create trigger stocktake_lines_guard before insert or update or delete on stocktake_lines
  for each row execute function public.enforce_stocktake_line();

/*
 * Opening a count freezes the books.
 *
 * Lines are built here rather than by the client so that the expected figure
 * and the snapshot cannot disagree: both come from one statement, reading
 * the ledger as at `snapshot_at`.
 *
 * `stock_unit` is coalesced because it is nullable and `stock_movements.unit`
 * is not — a count that cannot post is not worth opening, and this exact
 * null took a seeding script down earlier in this project.
 */
create or replace function public.open_stocktake(p_stocktake uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  n integer;
begin
  select * into s from public.stocktakes where id = p_stocktake;
  if s is null then
    raise exception 'no such count';
  end if;
  if not public.can_write_section('INVENTORY', s.org_id) then
    raise exception 'you do not have edit access to INVENTORY' using errcode = '42501';
  end if;
  if s.status <> 'OPEN' then
    raise exception 'this count has already been opened';
  end if;

  insert into public.stocktake_lines
    (org_id, stocktake_id, product_id, expected_qty, count_unit)
  select s.org_id, s.id, p.id,
         coalesce((select sum(m.quantity) from public.stock_movements m
                    where m.product_id = p.id
                      and m.occurred_at <= s.snapshot_at), 0),
         coalesce(p.stock_unit, p.total_unit, p.pack_unit)
    from public.products p
   where p.org_id = s.org_id
     and p.status = 'ACTIVE'
     and coalesce(p.stock_unit, p.total_unit, p.pack_unit) is not null
  on conflict (stocktake_id, product_id) do nothing;

  get diagnostics n = row_count;
  update public.stocktakes set status = 'COUNTING' where id = p_stocktake;
  return n;
end;
$$;

revoke all on function public.open_stocktake(uuid) from public;
grant execute on function public.open_stocktake(uuid) to authenticated;

/*
 * Posting.
 *
 * The adjustment is the difference, not the count: `stock_movements` is a
 * ledger and `product_stock.on_hand` is the sum of it, so writing the counted
 * figure as a movement would add it to what is already there.
 *
 * Dated `snapshot_at` for the reason in the table comment — a delivery that
 * arrived mid-count is real and must survive the adjustment.
 *
 * Lines nobody counted are skipped, and lines where the count agrees with the
 * books write nothing: a movement of zero is noise in a ledger people read.
 */
create or replace function public.post_stocktake(p_stocktake uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  n integer := 0;
begin
  select * into s from public.stocktakes where id = p_stocktake;
  if s is null then
    raise exception 'no such count';
  end if;
  if not public.can_write_section('INVENTORY', s.org_id) then
    raise exception 'you do not have edit access to INVENTORY' using errcode = '42501';
  end if;
  if s.status <> 'APPROVED' then
    raise exception 'a count is posted after it is approved'
      using hint = 'It has to be approved first.';
  end if;

  insert into public.stock_movements
    (org_id, product_id, kind, quantity, unit, reason, note,
     actor_id, actor_email, occurred_at, business_unit_id)
  select s.org_id, l.product_id, 'COUNT',
         l.counted_qty - l.expected_qty,
         l.count_unit,
         'stocktake',
         'Count ' || coalesce(s.reference, s.id::text),
         (select auth.uid()), auth.jwt() ->> 'email',
         s.snapshot_at, s.business_unit_id
    from public.stocktake_lines l
   where l.stocktake_id = s.id
     and l.counted_qty is not null
     and l.counted_qty <> l.expected_qty;

  get diagnostics n = row_count;
  update public.stocktakes set status = 'POSTED', posted_at = now()
   where id = p_stocktake;
  return n;
end;
$$;

revoke all on function public.post_stocktake(uuid) from public;
grant execute on function public.post_stocktake(uuid) to authenticated;

alter table stocktakes enable row level security;
alter table stocktake_lines enable row level security;

drop policy if exists stocktakes_read on stocktakes;
create policy stocktakes_read on stocktakes for select to authenticated
  using (public.can_read_section('INVENTORY', org_id));
drop policy if exists stocktakes_write on stocktakes;
create policy stocktakes_write on stocktakes for insert to authenticated
  with check (public.auth_can_write(org_id));
drop policy if exists stocktakes_update on stocktakes;
create policy stocktakes_update on stocktakes for update to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));

drop policy if exists stocktake_lines_read on stocktake_lines;
create policy stocktake_lines_read on stocktake_lines for select to authenticated
  using (public.can_read_section('INVENTORY', org_id));
drop policy if exists stocktake_lines_write on stocktake_lines;
create policy stocktake_lines_write on stocktake_lines for insert to authenticated
  with check (public.auth_can_write(org_id));
drop policy if exists stocktake_lines_update on stocktake_lines;
create policy stocktake_lines_update on stocktake_lines for update to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));

grant select, insert, update on stocktakes to authenticated;
grant select, insert, update on stocktake_lines to authenticated;

-- No delete grant on either. A count that happened is a record of what was
-- on the shelf; it is cancelled, not removed.

drop trigger if exists stocktakes_section_guard on stocktakes;
create trigger stocktakes_section_guard
  before insert or update or delete on stocktakes
  for each row execute function public.require_section_write('INVENTORY');
drop trigger if exists stocktake_lines_section_guard on stocktake_lines;
create trigger stocktake_lines_section_guard
  before insert or update or delete on stocktake_lines
  for each row execute function public.require_section_write('INVENTORY');

delete from public.section_read_rules
 where table_name in ('stocktakes', 'stocktake_lines');
insert into public.section_read_rules (table_name, section_code) values
  ('stocktakes', 'INVENTORY'),
  ('stocktake_lines', 'INVENTORY');

/*
 * The variance report, which is the only reason anybody opens a count.
 *
 * Sorted by absolute money rather than by quantity: four hundred missing
 * cocktail sticks is not the line to look at first.
 *
 * security_invoker, so it carries the policies of the tables beneath it
 * rather than its owner's — 0077 went through the whole schema for this.
 */
create or replace view stocktake_variance
with (security_invoker = true) as
  select
    l.org_id,
    l.stocktake_id,
    s.reference,
    s.status,
    s.snapshot_at,
    l.id                as stocktake_line_id,
    l.product_id,
    p.name              as product_name,
    p.category,
    l.expected_qty,
    l.counted_qty,
    l.count_unit,
    case when l.counted_qty is null then null
         else l.counted_qty - l.expected_qty end          as difference_qty,
    p.gross_price_per_unit,
    -- Cast to the scale money is stored at everywhere else. numeric times
    -- numeric widens, and a variance report that prints -400.0000000000
    -- beside -400.00000 on the next screen reads as two different numbers.
    case when l.counted_qty is null then null
         else ((l.counted_qty - l.expected_qty)
               * coalesce(p.gross_price_per_unit, 0))::numeric(18,5)
    end                                                   as difference_value,
    -- Null and zero read the same in a total but mean opposite things, so the
    -- report says which it is rather than leaving somebody to guess.
    l.counted_qty is null as not_counted
  from public.stocktake_lines l
  join public.stocktakes s on s.id = l.stocktake_id
  join public.products p   on p.id = l.product_id;

grant select on stocktake_variance to authenticated;

comment on table stocktakes is
  'A stock count as a session: books frozen, counted, approved by somebody else, then posted. See 0091.';
comment on view stocktake_variance is
  'Expected against counted, by value. A line nobody counted is marked, not treated as zero. See 0091.';
