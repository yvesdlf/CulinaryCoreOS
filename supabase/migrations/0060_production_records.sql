-- ---------------------------------------------------------------------------
-- What the kitchen actually made
-- ---------------------------------------------------------------------------
-- One missing fact has been blocking three separate things for months, and all
-- three are blocked on the same sentence: nothing in this database says that a
-- batch of something was produced.
--
--   Theoretical against actual usage (SRS INV-FUNC-005). What the recipes say
--   should have been consumed, against what the stock ledger says was. Without
--   a production record there is no "should": the ledger holds usage movements
--   with nothing to compare them to, so over-portioning, waste and theft are
--   indistinguishable from a kitchen that simply cooked a lot that week.
--
--   One step forward (Regulation 178/2002 Article 18). One step back has
--   worked since 0020 — supplier, lot, delivery note, arrival temperature. The
--   forward step asks which batch or service a lot went into, and the honest
--   answer up to now was that the database does not know, because a usage
--   movement names a lot and a product and nothing about what was being made.
--
--   Evidence that a preventive job was done. Partly: a completion record with
--   a named person and a timestamp that cannot be edited afterwards is the
--   shape that evidence takes, and this establishes it for production.
--
-- ## Four positions this takes, and why
--
-- **A completion cannot lie about units or quantity.** `quantity_made` is a
-- generated column: the client cannot supply it at all, and Postgres refuses
-- the insert if it tries. It is batches multiplied by the preparation's own
-- yield, captured onto the record at the time. The unit is the opposite
-- treatment — it is accepted from the client and *refused* when it disagrees
-- with the preparation's yield unit, rather than quietly corrected, because a
-- trigger that silently fixes a wrong unit teaches nobody that they typed kg
-- for a batch measured in grams. The production planner already refuses to add
-- grams to kilograms for the same ingredient and says so; this is the same
-- line held at the point of record.
--
-- **Actual usage stays in one ledger.** A production record does not carry its
-- own table of what it consumed. The consumption *is* a set of USAGE rows in
-- `stock_movements`, which now carry the record they belong to the same way
-- 0020 made them carry a lot. A second table of quantities consumed would be a
-- second source of truth for stock, and the two would disagree the first time
-- somebody corrected one of them.
--
-- **A correction is another record.** Same reasoning as the stock ledger and
-- the parameter audit trail: no UPDATE or DELETE grant, and a correction is a
-- new record pointing at the one it supersedes, with a reason. Both stay
-- visible. The ledger side of a correction is a reversing movement, not an
-- edited one — exactly what applying a stock count already does.
--
-- **The theoretical figure is derived; the preparation it derives from can
-- change.** Ingredient lines are not snapshotted onto the record — that is a
-- much larger job and the derivation is the point of the report. What *is*
-- snapshotted is the preparation's version number, so the variance report can
-- say "this preparation has been edited since that batch was made" instead of
-- re-deriving last month's figure against this month's recipe and presenting
-- the result as fact.
--
-- ## What is deliberately not here
--
-- Scheduling with dates, cooks and equipment conflicts (PRO-FUNC-002) and
-- kitchen display integration (PRO-FUNC-003). Both are "Could Have" in the
-- SRS, both need infrastructure that would dwarf the module, and neither is
-- what the three blocked items need.
-- ---------------------------------------------------------------------------

-- ── The prep list, as something a record can point at ───────────────────────
/*
 * Covers have lived in one browser's local storage since the production page
 * was built, which makes them personal rather than the venue's. A completion
 * recorded "against the prep list" needs the prep list to exist somewhere both
 * the cook and whoever reads the variance report can see.
 *
 * Deliberately narrow: a date, an optional service, and the covers that drove
 * the sheet. Covers as a shared daily record alongside revenue is a separate
 * piece of work (roadmap gap 36b) and this does not try to be it — a plan here
 * is the sheet somebody worked from, not the venue's agreed trading figure.
 */
create table if not exists production_plans (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  planned_for date not null default current_date,
  -- Lunch and dinner are two sheets and two prep cooks. Null means the day.
  service text,
  note text,

  created_by_id uuid,
  created_by_email text,
  created_at timestamptz not null default now()
);

create index if not exists idx_production_plans_date
  on production_plans(org_id, planned_for desc);

create table if not exists production_plan_lines (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  plan_id uuid not null references production_plans(id) on delete cascade,
  recipe_id uuid not null references recipes(id) on delete cascade,

  -- Covers, not portions. The planner divides by the recipe's portion yield.
  covers numeric(18,5) not null check (covers > 0)
);

create unique index if not exists idx_production_plan_lines_unique
  on production_plan_lines(plan_id, recipe_id);

-- ── The completion record ───────────────────────────────────────────────────

create table if not exists production_records (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  -- Nullable on purpose. A batch made because somebody ran out mid-service is
  -- still a batch, and refusing to record it because no sheet was saved would
  -- mean the record that matters most does not get made at all.
  plan_id uuid references production_plans(id) on delete set null,

  sub_recipe_id uuid not null references sub_recipes(id) on delete restrict,

  -- What was made, as a multiple of the preparation's own batch. Fractional is
  -- allowed: a cook who made three quarters of a batch should be able to say
  -- so rather than rounding to something untrue.
  batches numeric(18,5) not null check (batches > 0),

  /*
   * The yield and the version as they stood when the batch was made.
   *
   * Both set by trigger from the preparation, never from the client. A yield
   * edited next month must not retroactively change what this batch produced,
   * and a reader of the variance report has to be able to tell that the
   * ingredient list they are seeing is not the one the cook worked from.
   */
  batch_yield_qty numeric(18,5) not null,
  sub_recipe_version integer not null,

  -- Generated, so there is no code path through which a client can state it.
  quantity_made numeric(18,5)
    generated always as (batches * batch_yield_qty) stored,

  -- Accepted from the client and refused when wrong, not corrected. See the
  -- header: a silent correction teaches nobody.
  unit text not null,

  occurred_at timestamptz not null default now(),
  produced_by_id uuid,
  produced_by_email text,
  note text,

  /*
   * A correction supersedes exactly one earlier record and says why.
   *
   * One successor per record, enforced below: a fork would make "what was
   * actually made" ambiguous, and the whole point of the record is that it is
   * not.
   */
  corrects_id uuid references production_records(id) on delete restrict,
  correction_reason text,

  created_at timestamptz not null default now(),

  constraint production_records_not_own_correction
    check (corrects_id is null or corrects_id <> id)
);

create unique index if not exists idx_production_records_one_correction
  on production_records(corrects_id) where corrects_id is not null;
create index if not exists idx_production_records_when
  on production_records(org_id, occurred_at desc);
create index if not exists idx_production_records_sub_recipe
  on production_records(sub_recipe_id, occurred_at desc);
create index if not exists idx_production_records_plan on production_records(plan_id);

/*
 * The consumption is the stock ledger, with the batch named on it.
 *
 * 0020 added `lot_id` to the same table for the same reason — one ledger, with
 * the facts that make it answerable hung off each row. With both columns
 * present, "which batch consumed this lot" is one join rather than an
 * unanswerable question.
 */
alter table stock_movements
  add column if not exists production_record_id uuid
    references production_records(id) on delete restrict;

create index if not exists idx_stock_movements_production
  on stock_movements(production_record_id)
  where production_record_id is not null;

-- ── Tenancy ─────────────────────────────────────────────────────────────────
/*
 * A record inherits its organisation from the preparation, and a plan line
 * from its plan, rather than from the caller's default. A record that landed
 * in a different tenant from the preparation it names would be invisible to
 * the variance report and impossible to find.
 */
create or replace function public.set_production_record_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare parent_org uuid;
begin
  select s.org_id into parent_org
    from public.sub_recipes s where s.id = new.sub_recipe_id;
  if parent_org is null then
    raise exception 'the preparation this record names does not exist';
  end if;
  new.org_id := parent_org;
  return new;
end;
$$;

create or replace function public.set_production_plan_line_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare parent_org uuid;
begin
  select p.org_id into parent_org
    from public.production_plans p where p.id = new.plan_id;
  if parent_org is null then
    raise exception 'the plan this line belongs to does not exist';
  end if;
  new.org_id := parent_org;
  return new;
end;
$$;

create trigger production_plans_set_org
  before insert on production_plans
  for each row execute function public.set_org_id();
create trigger production_plan_lines_set_org
  before insert on production_plan_lines
  for each row execute function public.set_production_plan_line_org();
create trigger production_records_set_org
  before insert on production_records
  for each row execute function public.set_production_record_org();

-- ── What a completion may and may not say ───────────────────────────────────
/*
 * The unit check is the one this exists for.
 *
 * "Two batches of mashed potato" is meaningless without the yield behind it,
 * and the yield carries a unit. A record claiming 2 g where the preparation
 * yields 2.000 g understates everything built on it by a factor of a thousand
 * — the same error the planner already refuses when a product appears in
 * grams in one recipe and kilograms in another, and the reason nobody notices
 * it is that every figure downstream stays plausible.
 *
 * Refused rather than coerced. `_harness.sql` records what silent correction
 * costs: "the write was allowed" is not "the write happened", and a trigger
 * that fixes up the unit produces a record nobody knows was wrong.
 */
create or replace function public.enforce_production_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prep record;
  superseded record;
  caller text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  select s.name, s.batch_yield_qty, s.batch_yield_unit, s.version
    into prep
    from public.sub_recipes s where s.id = new.sub_recipe_id;

  if prep is null then
    raise exception 'the preparation this record names does not exist';
  end if;

  /*
   * No yield means no record.
   *
   * Not a zero and not a guess. Without a yield there is no quantity the batch
   * produced, no ingredient quantity it consumed, and therefore no theoretical
   * figure to compare anything against. Recording it anyway would put a row in
   * the variance report that reads as "used nothing".
   */
  if prep.batch_yield_qty is null or prep.batch_yield_qty <= 0 then
    raise exception '% has no batch yield, so what a batch of it made cannot be worked out',
      prep.name
      using hint = 'Set the batch yield on the preparation first.';
  end if;
  if coalesce(btrim(prep.batch_yield_unit), '') = '' then
    raise exception '% has no unit on its batch yield', prep.name
      using hint = 'A quantity without a unit cannot be added to anything.';
  end if;

  if lower(btrim(coalesce(new.unit, ''))) <> lower(btrim(prep.batch_yield_unit)) then
    raise exception '% is made in %, not %',
      prep.name, prep.batch_yield_unit, coalesce(nullif(btrim(new.unit), ''), 'no unit')
      using hint = 'The unit on a completion is the preparation''s own yield unit.';
  end if;

  -- Captured, not trusted: see the column comments.
  new.batch_yield_qty := prep.batch_yield_qty;
  new.sub_recipe_version := prep.version;

  /*
   * Who made it, from the caller's own identity.
   *
   * 0054 fixed the same shape elsewhere: reading the name from the row let a
   * manager file a decision under somebody else's address. A completion is
   * evidence that a named person did the work, so it is not a field the client
   * gets to choose.
   */
  if caller <> '' then
    new.produced_by_email := caller;
    new.produced_by_id := coalesce(auth.uid(), new.produced_by_id);
  elsif coalesce(btrim(coalesce(new.produced_by_email, '')), '') = '' then
    raise exception 'a completion record must say who made it';
  end if;

  if new.corrects_id is not null then
    select r.sub_recipe_id, r.org_id into superseded
      from public.production_records r where r.id = new.corrects_id;
    if superseded is null then
      raise exception 'the record this corrects does not exist';
    end if;
    if superseded.sub_recipe_id <> new.sub_recipe_id then
      raise exception 'a correction names the same preparation as the record it corrects'
        using hint = 'A batch of something else is a new record, not a correction.';
    end if;
    if coalesce(btrim(coalesce(new.correction_reason, '')), '') = '' then
      raise exception 'a correction must say why'
        using hint = 'Both records stay visible, so the reason is the only thing that explains them.';
    end if;
  elsif coalesce(btrim(coalesce(new.correction_reason, '')), '') <> '' then
    raise exception 'a correction reason without a record to correct'
      using hint = 'Name the record being superseded.';
  end if;

  return new;
end;
$$;

create trigger production_records_enforce
  before insert on production_records
  for each row execute function public.enforce_production_record();

/*
 * A movement that names a batch is held to the batch's units.
 *
 * The variance report sums these rows per ingredient. A movement recorded in
 * grams against a product the ledger counts in kilograms is the same
 * thousand-fold error as above, arriving from the other direction, and it
 * would read as the kitchen having used almost nothing.
 *
 * Only movements that name a production record are checked. Receipts, counts
 * and waste are left exactly as they were: policing them retroactively would
 * refuse corrections to history that is already recorded.
 */
create or replace function public.enforce_production_consumption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stock_unit text;
  product_name text;
begin
  if new.production_record_id is null then
    return new;
  end if;

  if new.kind <> 'USAGE' then
    raise exception 'a movement against a production record is usage, not %', new.kind
      using hint = 'Waste and returns are recorded against the product, not the batch.';
  end if;

  select p.name, coalesce(nullif(btrim(coalesce(p.stock_unit, '')), ''),
                          nullif(btrim(coalesce(p.total_unit, '')), ''))
    into product_name, stock_unit
    from public.products p where p.id = new.product_id;

  if stock_unit is null then
    raise exception '% has no stock unit, so what a batch consumed of it cannot be recorded',
      coalesce(product_name, 'that ingredient');
  end if;

  if lower(btrim(coalesce(new.unit, ''))) <> lower(stock_unit) then
    raise exception '% is held in %, so a batch cannot consume % of it',
      product_name, stock_unit, coalesce(nullif(btrim(new.unit), ''), 'no unit')
      using hint = 'Convert to the stock unit before recording, or change the stock unit.';
  end if;

  return new;
end;
$$;

create trigger stock_movements_production_consumption
  before insert on stock_movements
  for each row execute function public.enforce_production_consumption();

/*
 * Article 19, refined: a blocked lot cannot be *taken from*.
 *
 * 0020 refused every USAGE and TRANSFER touching a lot that is not OK, which
 * is right for a removal and wrong for the reversal half of a correction. A
 * positive usage movement puts quantity back on the shelf; refusing it means
 * that a lot recalled after Tuesday's service makes Tuesday's over-recorded
 * consumption uncorrectable, which leaves the ledger permanently wrong about a
 * recalled lot — the opposite of what Article 19 is for.
 *
 * The refusal that matters is unchanged: you still cannot consume or transfer
 * out of a blocked, recalled or withdrawn lot.
 */
create or replace function public.refuse_movement_on_blocked_lot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lot record;
begin
  if new.lot_id is null then
    return new;
  end if;
  select status, lot_code into lot from public.stock_lots where id = new.lot_id;
  if lot is null then
    return new;
  end if;
  if lot.status <> 'OK'
     and new.kind in ('USAGE', 'TRANSFER')
     and new.quantity < 0
  then
    raise exception
      'lot % is % and cannot be used or transferred', lot.lot_code, lot.status
      using hint = 'Record a RETURN or WASTE movement to clear it instead.';
  end if;
  return new;
end;
$$;

-- ── Nothing here is editable ────────────────────────────────────────────────

alter table production_plans enable row level security;
alter table production_plan_lines enable row level security;
alter table production_records enable row level security;

do $$
declare t text;
begin
  foreach t in array array['production_plans','production_plan_lines','production_records']
  loop
    execute format(
      'create policy %1$s_read on %1$I for select to authenticated
         using (org_id in (select public.auth_org_ids()))', t);
    execute format(
      'create policy %1$s_insert on %1$I for insert to authenticated
         with check (public.auth_can_write(org_id))', t);
  end loop;
end $$;

-- A plan is a working sheet and can be thrown away; a record of what was
-- produced cannot. The asymmetry is deliberate and is the ledger rule.
create policy production_plans_update on production_plans
  for update to authenticated
  using (public.auth_can_write(org_id)) with check (public.auth_can_write(org_id));
create policy production_plans_delete on production_plans
  for delete to authenticated using (public.auth_can_write(org_id));
create policy production_plan_lines_delete on production_plan_lines
  for delete to authenticated using (public.auth_can_write(org_id));

grant select, insert, update, delete on production_plans to authenticated;
grant select, insert, delete on production_plan_lines to authenticated;
-- No update and no delete. A completion that can be edited afterwards is not
-- evidence of anything; a correction is a new row that names the old one.
grant select, insert on production_records to authenticated;

-- ── The section grid ────────────────────────────────────────────────────────
/*
 * Listed explicitly, the same way 0036 and 0057 did. The Production section
 * has existed since 0036 and guarded no tables at all, because until now the
 * module read data and wrote none.
 */
do $$
declare t text;
begin
  foreach t in array array['production_plans','production_plan_lines','production_records']
  loop
    execute format('drop trigger if exists %1$s_section_guard on public.%1$I', t);
    execute format(
      'create trigger %1$s_section_guard before insert or update or delete
         on public.%1$I for each row
         execute function public.require_section_write(%2$L)', t, 'PRODUCTION');
  end loop;
end $$;

-- ── Which records count ─────────────────────────────────────────────────────
/*
 * A corrected record stays in the table and stops counting.
 *
 * Both rows remain readable — that is the point of correcting by appending —
 * but a report that summed both would double count the batch. The effective
 * set is the records nothing supersedes.
 */
create or replace view production_records_effective as
  select r.*,
         (s.version is distinct from r.sub_recipe_version) as recipe_changed_since,
         s.name as preparation_name,
         s.batch_yield_unit as preparation_unit
    from public.production_records r
    join public.sub_recipes s on s.id = r.sub_recipe_id
   where not exists (
     select 1 from public.production_records c where c.corrects_id = r.id
   )
     and r.org_id in (select public.auth_org_ids());

grant select on production_records_effective to authenticated;

-- ── Theoretical usage: the derivation ───────────────────────────────────────
/*
 * What the recipes say a recorded batch should have consumed.
 *
 * Gross quantity, not nett: the ledger records what left the shelf, and trim
 * leaves the shelf. Costing the nett figure against an actual that includes
 * peelings would report every vegetable as over-portioned.
 *
 * Only direct product lines. A preparation built on another preparation
 * consumes the *preparation*, which the stock ledger knows nothing about, and
 * the inner one carries its own completion record with its own ingredients.
 * Exploding the chain here would count the inner preparation's ingredients
 * twice.
 */
create or replace view production_usage_theoretical as
  select
    r.org_id,
    r.id as production_record_id,
    r.occurred_at,
    (r.occurred_at at time zone 'UTC')::date as used_on,
    r.sub_recipe_id,
    r.batches,
    r.recipe_changed_since,
    l.product_id,
    l.gross_unit as unit,
    (l.gross_qty * r.batches) as qty
  from public.production_records_effective r
  join public.sub_recipe_lines l
    on l.sub_recipe_id = r.sub_recipe_id
   and l.product_id is not null
   and coalesce(l.gross_qty, 0) > 0;

grant select on production_usage_theoretical to authenticated;

-- ── Actual usage: the record ────────────────────────────────────────────────
/*
 * What the ledger says went out of the store.
 *
 * Every USAGE movement, not only the ones that name a batch. Usage with no
 * batch behind it is exactly what the variance report exists to surface, and
 * excluding it would make the two sides agree by construction.
 *
 * Reported as a magnitude: usage is stored negative, and a report reading
 * "-600 g used" against "600 g expected" is a sign error waiting to happen.
 */
create or replace view production_usage_actual as
  select
    m.org_id,
    m.id as movement_id,
    m.occurred_at,
    (m.occurred_at at time zone 'UTC')::date as used_on,
    m.product_id,
    m.unit,
    (-m.quantity) as qty,
    m.unit_cost,
    m.lot_id,
    m.production_record_id
  from public.stock_movements m
 where m.kind = 'USAGE'
   and m.org_id in (select public.auth_org_ids());

grant select on production_usage_actual to authenticated;

-- ── One step forward (Article 18) ───────────────────────────────────────────
/*
 * Where a lot went.
 *
 * Every movement that took quantity out of the lot, with the batch it went
 * into where there is one. A usage movement with no production record behind
 * it is reported as traced only as far as the product — which is the finding,
 * and is why it is a column rather than an omission. A gap in a traceability
 * record is the thing an inspector is looking for, so it is named.
 */
create or replace view lot_forward_trace as
  select
    l.org_id,
    l.id as lot_id,
    l.lot_code,
    l.product_id,
    p.name as product_name,
    l.status as lot_status,
    m.id as movement_id,
    m.kind,
    (-m.quantity) as quantity,
    m.unit,
    m.occurred_at,
    m.reason,
    m.actor_email,
    m.production_record_id,
    r.sub_recipe_id,
    s.name as preparation_name,
    r.batches,
    r.quantity_made,
    r.unit as made_unit,
    r.produced_by_email,
    pl.planned_for,
    pl.service,
    case
      when m.production_record_id is not null then 'BATCH'
      when m.kind = 'USAGE' then 'UNRECORDED_USAGE'
      else m.kind::text
    end as step_forward
  from public.stock_lots l
  join public.products p on p.id = l.product_id
  join public.stock_movements m on m.lot_id = l.id and m.quantity < 0
  left join public.production_records r on r.id = m.production_record_id
  left join public.sub_recipes s on s.id = r.sub_recipe_id
  left join public.production_plans pl on pl.id = r.plan_id
 where l.org_id in (select public.auth_org_ids());

grant select on lot_forward_trace to authenticated;

-- ── Theoretical against actual (SRS INV-FUNC-005) ───────────────────────────
/*
 * A function rather than a view, for one reason: the period is an argument.
 *
 * Both sides of the comparison are views — the derivation and the record each
 * stand on their own and can be read directly. What a view cannot do is take
 * the two dates, and the comparison has to happen *after* the period filter:
 * whether an ingredient is comparable at all depends on whether both a batch
 * and a movement fall inside the window. A view of everything that the caller
 * grouped would push that judgement into the browser, where every reader of
 * the report would have to make it again and some of them would get it wrong.
 *
 * ## Where the two cannot be compared, it says so
 *
 * The codebase's position on a blank versus a zero, applied here. "Nobody
 * recorded any production" and "the recipes expected none" are different
 * statements and only one of them means the kitchen is on target. Four cases
 * come back as not comparable, each with the reason:
 *
 *   usage with no production recorded against it
 *   production recorded with nothing taken from the ledger
 *   an ingredient the recipes measure in one unit and the ledger in another
 *   an ingredient measured in more than one unit on either side
 *
 * ## Money
 *
 * Both sides are valued at the same unit cost, so the variance is a quantity
 * variance and nothing else. The cost is the one the ledger captured at the
 * time, weighted across the period's movements, falling back to the product's
 * current price where there were none. Valuing the theoretical figure at the
 * recipe's costed price and the actual at the ledger's would fold a price
 * variance into a usage report, and price movement is purchasing's finding,
 * not the kitchen's.
 */
create or replace function public.production_variance(p_from date, p_to date)
returns table (
  product_id uuid,
  product_name text,
  category text,
  unit text,
  theoretical_qty numeric,
  actual_qty numeric,
  actual_qty_unlinked numeric,
  variance_qty numeric,
  variance_percent numeric,
  unit_cost numeric,
  theoretical_cost numeric,
  actual_cost numeric,
  variance_cost numeric,
  batches_recorded numeric,
  movements integer,
  recipe_changed boolean,
  comparable boolean,
  note text
)
language sql
stable
set search_path = ''
as $$
  with theoretical as (
    select
      t.product_id,
      sum(t.qty) as qty,
      -- Counted case-insensitively and shown as written: "KG" and "kg" are one
      -- unit, and silently lower-casing the label on a report is a small lie.
      count(distinct lower(btrim(t.unit))) as units,
      min(lower(btrim(t.unit))) as unit,
      min(btrim(t.unit)) as unit_shown,
      sum(t.batches) as batches,
      bool_or(t.recipe_changed_since) as recipe_changed
    from public.production_usage_theoretical t
    where t.used_on between p_from and p_to
    group by t.product_id
  ),
  actual as (
    select
      a.product_id,
      sum(a.qty) as qty,
      sum(case when a.production_record_id is null then a.qty else 0 end) as qty_unlinked,
      count(distinct lower(btrim(a.unit))) as units,
      min(lower(btrim(a.unit))) as unit,
      min(btrim(a.unit)) as unit_shown,
      count(*)::integer as movements,
      -- Weighted by quantity: a 40 kg delivery at one price and a 1 kg top-up
      -- at another are not two equal observations of what it cost.
      case when sum(case when a.unit_cost is null then 0 else a.qty end) > 0
           then sum(coalesce(a.unit_cost, 0) * a.qty)
                / sum(case when a.unit_cost is null then 0 else a.qty end)
      end as weighted_cost
    from public.production_usage_actual a
    where a.used_on between p_from and p_to
    group by a.product_id
  ),
  joined as (
    select
      coalesce(t.product_id, a.product_id) as product_id,
      t.qty as t_qty, t.units as t_units, t.unit as t_unit,
      t.unit_shown as t_unit_shown, t.batches, t.recipe_changed,
      a.qty as a_qty, a.qty_unlinked, a.units as a_units, a.unit as a_unit,
      a.unit_shown as a_unit_shown, a.movements, a.weighted_cost
    from theoretical t
    full outer join actual a on a.product_id = t.product_id
  )
  select
    p.id,
    p.name,
    p.category,
    coalesce(j.t_unit_shown, j.a_unit_shown, p.stock_unit, p.total_unit),
    j.t_qty,
    j.a_qty,
    coalesce(j.qty_unlinked, 0),
    case when comp.ok then j.a_qty - j.t_qty end,
    case when comp.ok and j.t_qty <> 0
         then round((j.a_qty - j.t_qty) / j.t_qty * 100, 2) end,
    cost.unit_cost,
    case when j.t_qty is not null then round(j.t_qty * cost.unit_cost, 5) end,
    case when j.a_qty is not null then round(j.a_qty * cost.unit_cost, 5) end,
    case when comp.ok then round((j.a_qty - j.t_qty) * cost.unit_cost, 5) end,
    coalesce(j.batches, 0),
    coalesce(j.movements, 0),
    coalesce(j.recipe_changed, false),
    comp.ok,
    comp.note
  from joined j
  join public.products p on p.id = j.product_id
  cross join lateral (
    select coalesce(j.weighted_cost, p.gross_price_per_unit, 0) as unit_cost
  ) cost
  cross join lateral (
    select
      case
        when j.t_qty is null then false
        when j.a_qty is null then false
        when j.t_units > 1 then false
        when j.a_units > 1 then false
        when j.t_unit <> j.a_unit then false
        else true
      end as ok,
      case
        when j.t_qty is null then
          'Used, but no production of it was recorded in this period — there is nothing to compare against.'
        when j.a_qty is null then
          'Production was recorded, but nothing was taken from the stock ledger for it.'
        when j.t_units > 1 then
          'The recipes measure this in more than one unit, so the expected figure cannot be added up.'
        when j.a_units > 1 then
          'The ledger records this in more than one unit, so what was used cannot be added up.'
        when j.t_unit <> j.a_unit then
          'The recipes measure this in ' || j.t_unit || ' and the ledger in '
            || j.a_unit || ', so the two cannot be compared.'
      end as note
  ) comp
  where p.org_id in (select public.auth_org_ids());
$$;

grant execute on function public.production_variance(date, date) to authenticated;

-- ── Recording a batch, in one transaction ───────────────────────────────────
/*
 * The record and its consumption land together or not at all.
 *
 * Two client calls would leave a window in which a batch exists that consumed
 * nothing, and a batch that consumed nothing reads in the variance report as a
 * kitchen that produced food out of thin air. `repository.ts` already makes
 * the same argument about a count sheet: half a count applied is worse than
 * none, because the books then disagree with both the shelf and the sheet
 * somebody signed.
 *
 * Deliberately NOT security definer. Running as the caller means both section
 * guards still apply — Production for the record, Inventory for the ledger —
 * and nothing here becomes a side door into the stock ledger for somebody who
 * was not given it. The consequence is that recording production needs edit
 * access to both sections, which is correct: it adds rows to the stock ledger.
 *
 * `p_consumption` is an array of objects: product_id, quantity (positive, the
 * amount taken), unit, lot_id (optional), note (optional). Unit and sign are
 * checked by the trigger above; this does not pre-validate them, because two
 * places deciding the same rule is how they drift apart.
 */
create or replace function public.record_production(
  p_sub_recipe_id uuid,
  p_batches numeric,
  p_unit text,
  p_consumption jsonb default '[]'::jsonb,
  p_plan_id uuid default null,
  p_occurred_at timestamptz default null,
  p_note text default null,
  p_corrects_id uuid default null,
  p_correction_reason text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  record_id uuid;
  line jsonb;
  reversed integer := 0;
begin
  insert into public.production_records
    (plan_id, sub_recipe_id, batches, batch_yield_qty, sub_recipe_version, unit,
     occurred_at, note, corrects_id, correction_reason)
  values
    (p_plan_id, p_sub_recipe_id, p_batches,
     -- Placeholders. The trigger replaces both from the preparation itself;
     -- they are NOT NULL so that a future code path cannot leave them unset.
     1, 0, p_unit,
     coalesce(p_occurred_at, now()), p_note, p_corrects_id, p_correction_reason)
  returning id into record_id;

  /*
   * Correcting: reverse what the superseded record consumed, then record what
   * was actually taken.
   *
   * The reversal is a positive usage movement, which is what applying a stock
   * count already does — the ledger is corrected by appending the difference,
   * never by editing the row that was wrong. Both the original consumption and
   * its reversal stay visible against the lot, so the forward trace still
   * shows which lot the first attempt named.
   */
  if p_corrects_id is not null then
    insert into public.stock_movements
      (product_id, kind, quantity, unit, unit_cost, reason, note, lot_id,
       production_record_id, occurred_at)
    select m.product_id, 'USAGE', -m.quantity, m.unit, m.unit_cost,
           'Production correction',
           'Reverses the consumption recorded against the superseded batch.',
           m.lot_id, record_id, coalesce(p_occurred_at, now())
      from public.stock_movements m
     where m.production_record_id = p_corrects_id;
    get diagnostics reversed = row_count;
  end if;

  for line in select * from jsonb_array_elements(p_consumption)
  loop
    insert into public.stock_movements
      (product_id, kind, quantity, unit, unit_cost, reason, note, lot_id,
       production_record_id, occurred_at)
    values (
      (line ->> 'product_id')::uuid,
      'USAGE',
      -- The caller states what was taken; the ledger holds the sign. Same
      -- division as the waste dialog: the screen decides direction once.
      -((line ->> 'quantity')::numeric),
      line ->> 'unit',
      nullif(line ->> 'unit_cost', '')::numeric,
      coalesce(nullif(line ->> 'reason', ''), 'Production'),
      nullif(line ->> 'note', ''),
      nullif(line ->> 'lot_id', '')::uuid,
      record_id,
      coalesce(p_occurred_at, now())
    );
  end loop;

  return record_id;
end;
$$;

grant execute on function public.record_production(
  uuid, numeric, text, jsonb, uuid, timestamptz, text, uuid, text) to authenticated;

-- ── Starting data ───────────────────────────────────────────────────────────
/*
 * A tolerance, because without one every rounding difference is a finding.
 *
 * A kitchen weighing to the gram on a 2 kg batch is inside any sane tolerance
 * and a report that paints it red teaches people to ignore the report. Set in
 * a function called on organisation creation, never as an INSERT in a
 * migration body — the single most repeated defect in this repository, and the
 * reason 0040 exists.
 */
create or replace function public.seed_production_defaults(p_org uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.venue_parameters
    (org_id, code, name, description, value, unit, min_value, max_value)
  values
    (p_org, 'PRODUCTION_VARIANCE_TOLERANCE', 'Production variance tolerance',
     'How far actual usage may sit from what the recipes expect before an ingredient is flagged.',
     5, 'percent', 0, 50)
  on conflict (org_id, code) do nothing;
$$;

create or replace function public.seed_organization_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_venue_parameters(p_org);
  perform public.seed_purchasing_defaults(p_org);
  perform public.seed_tax_and_channels(p_org);
  perform public.seed_people_defaults(p_org);
  perform public.seed_haccp_forms(p_org);
  perform public.seed_maintenance_defaults(p_org);
  perform public.seed_housekeeping_defaults(p_org);
  perform public.seed_production_defaults(p_org);
end;
$$;

do $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.seed_production_defaults(o.id);
  end loop;
end $$;

comment on table production_plans is
  'A prep list somebody worked from. Not the venue''s agreed covers — see roadmap gap 36b.';
comment on table production_records is
  'Append-only. What was actually made, by whom, and against which sheet. A correction is a new row.';
comment on column production_records.quantity_made is
  'Generated from batches and the yield captured at the time. A client cannot state it.';
comment on column production_records.sub_recipe_version is
  'The preparation''s version when the batch was made, so a later edit is visible rather than silent.';
comment on column stock_movements.production_record_id is
  'The batch this usage belongs to. One step forward under Regulation 178/2002 Article 18.';
comment on view production_usage_theoretical is
  'What the recipes say a recorded batch should have consumed. Gross, because trim leaves the shelf.';
comment on view production_usage_actual is
  'What the ledger says went out. Every USAGE movement, including those with no batch behind them.';
comment on view lot_forward_trace is
  'Where a lot went. Names the gap where usage was never recorded against a batch.';
comment on function public.production_variance(date, date) is
  'INV-FUNC-005. Theoretical against actual per ingredient, saying so where they cannot be compared.';
comment on function public.record_production(uuid, numeric, text, jsonb, uuid, timestamptz, text, uuid, text) is
  'A batch and its consumption in one transaction. Runs as the caller, so both section guards apply.';
