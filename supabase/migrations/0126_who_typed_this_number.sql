-- ---------------------------------------------------------------------------
-- Who typed this number, and when
-- ---------------------------------------------------------------------------
-- Six things in this database are already append-only and already answer the
-- question: stock movements, recipe status, approvals, time, pay and AI usage.
-- Everything else keeps current state only. So "who changed this price" is
-- answerable for a stock adjustment and not for the price itself — which is
-- the figure every costing in the system is built on, and the one a venue
-- argues about.
--
-- This is the general answer. One ledger, written by a trigger, carrying the
-- field that changed, what it was, what it became, who did it and when.
--
-- ── Four decisions, because each of them could have been the other way ─────
--
-- 1 · A registry, not every column.
--
--    `products` carries 40 columns and most of them are computed. A price
--    edit rewrites `buying_price_per_pack` — which a person typed — and then
--    `buying_price_per_unit`, `gross_price_per_unit`, `nett_price_per_unit`,
--    `nett_qty` and the rest, which the cascade derives from it. Auditing all
--    of them records one edit as six lines, five of them consequences of the
--    first, and the one line that matters is now the hardest to find.
--
--    `audited_fields` therefore names what a person enters. The derived
--    columns are reproducible from the entered ones and from the recipe
--    engine; the entered ones are not reproducible from anything.
--
-- 2 · Some fields are recorded without their values.
--
--    An audit trail over `employee_private` would put the old value of
--    somebody's bank account and national ID into a second table — a fresh
--    copy of the most sensitive column in the database, under a different
--    read gate, which 0080's erasure would then have to find and rewrite.
--
--    For those fields the trail records that the field changed, by whom and
--    when, and nothing else. `values_withheld` says so explicitly, so
--    "withheld on purpose" can never be read as "it was empty" — a null in
--    `old_value` means one thing in a redacted row and another in a normal
--    one, and a reader who cannot tell them apart will eventually guess.
--
-- 3 · A row's creation and deletion are one line each, not one per column.
--
--    These tables have `created_at` and no `created_by`, so nothing recorded
--    who added a product, and a deletion left no trace at all. Both are worth
--    having. Neither is worth one line per column: "was nothing, now 12,5" is
--    the insert restated twelve times.
--
--    A deletion does not snapshot the row either. That would be a second copy
--    of every audited field, including the ones decision 2 deliberately
--    refuses to copy, sitting in a table with a different read gate. What is
--    recorded is that the row was deleted, by whom, and when.
--
-- 4 · The read gate is WRITE on the section, not READ.
--
--    The current value of a product price is on half the screens in the app
--    by design — a cook needs it, a costing needs it, `section_read_rules`
--    calls the catalogue shared for exactly that reason. The *history* of who
--    changed it is a supervisory question: it exists so an edit can be held to
--    account, and the people accountable for the catalogue are the people who
--    can write it. A read-only viewer gets the number they need to work from
--    and no edit trail of their colleagues.
--
--    So the gate is the section that already guards writes to that table,
--    taken from its own `_section_guard` trigger where it has one, and stated
--    by hand where it does not. `organizations` and `member_access` have no
--    section guard: writing either is an administration act (`auth_is_admin`
--    gates the first, 0036's grid logic the second), so both read as ADMIN.
-- ---------------------------------------------------------------------------

-- ── 1 · The registries ─────────────────────────────────────────────────────

/*
 * Which tables are audited, where the venue id is, what the key is, and which
 * unit the row belongs to.
 *
 * `org_column` exists because `organizations` is its own venue: the id of the
 * row *is* the org id, and a trigger that assumed `org_id` would fail on the
 * one table where the venue's own parameters live.
 *
 * `unit_column` exists for the heads of department of 0116. `auth_section_level`
 * with a null unit is reached only by an unscoped grant, so a PEOPLE grant
 * limited to the kitchen would otherwise see no history at all — not their
 * own team's, not anybody's. PEOPLE is the only scopable section among the
 * tables below whose rows carry a unit; the column generalises to the next one.
 */
create table public.audited_tables (
  table_name   text primary key,
  read_section text not null references public.app_sections(code),
  org_column   text not null default 'org_id',
  key_column   text not null default 'id',
  unit_column  text,
  because      text not null
);

/*
 * Which fields, and whether their values may be copied here.
 *
 * `values_withheld` is per field rather than per table because
 * `employee_private` is both: that somebody's home address changed is a
 * perfectly ordinary HR fact, and the address itself is not ours to duplicate.
 */
create table public.audited_fields (
  table_name      text not null references public.audited_tables(table_name)
                       on delete cascade,
  column_name     text not null,
  values_withheld boolean not null default false,
  primary key (table_name, column_name)
);

-- The registries are not secret. The suite reads them as an ordinary user,
-- and a screen offering a history tab needs to know whether there is one.
alter table public.audited_tables enable row level security;
alter table public.audited_fields enable row level security;
create policy audited_tables_read on public.audited_tables
  for select to authenticated using (true);
create policy audited_fields_read on public.audited_fields
  for select to authenticated using (true);
revoke all on public.audited_tables from anon, authenticated;
revoke all on public.audited_fields from anon, authenticated;
grant select on public.audited_tables, public.audited_fields to authenticated;

-- ── 2 · The ledger ─────────────────────────────────────────────────────────

/*
 * `record_id` carries no foreign key, deliberately. A deletion is one of the
 * three things this table records, and a reference would either refuse the
 * row or take it away again.
 *
 * `org_id` does cascade. A venue that is deleted takes its own edit history
 * with it; keeping the trail of a venue that no longer exists is keeping
 * personal data with nobody left to answer for it.
 */
create table public.field_changes (
  id               uuid primary key default uuid_generate_v4(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  /*
   * No key on the unit either, and for a sharper reason than `record_id`:
   * both ways of writing one destroy the record. `on delete set null` turns
   * an entry that said "this was the kitchen's" into one that says nothing,
   * and it does it with an UPDATE, which the append-only trigger below
   * refuses — so deleting a department would have failed outright. `cascade`
   * would delete the entry instead. The unit a row belonged to when it was
   * edited is a historical fact and does not stop being one when the
   * department is closed.
   */
  business_unit_id uuid,
  table_name       text not null,
  record_id        uuid not null,
  action           text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  field_name       text,
  old_value        text,
  new_value        text,
  values_withheld  boolean not null default false,
  changed_by       uuid,
  changed_by_email text,
  changed_at       timestamptz not null default now(),
  /*
   * A field name belongs to an update and to nothing else. Written as an
   * equivalence rather than two checks so that neither direction can be
   * forgotten: an update with no field is as wrong as a deletion with one.
   */
  constraint field_changes_field_belongs_to_an_update
    check ((action = 'UPDATE') = (field_name is not null)),
  /* Decision 2, enforced rather than trusted to the trigger. */
  constraint field_changes_withheld_means_withheld
    check (not values_withheld or (old_value is null and new_value is null))
);

/*
 * The two reads this table exists for: one record's history, newest first,
 * and a venue's recent activity. Both include `org_id` because the policy
 * filters on it, so without it every query starts by reading another venue's
 * index entries and discarding them.
 */
create index field_changes_by_record
  on public.field_changes (org_id, table_name, record_id, changed_at desc);
create index field_changes_by_venue
  on public.field_changes (org_id, changed_at desc);

alter table public.field_changes enable row level security;

/*
 * Decision 4. `coalesce(..., 'ADMIN')` is what happens to the history of a
 * table somebody later removes from the registry: it stays readable by
 * administration rather than becoming readable by nobody. A ledger that
 * silently empties when a registry row is deleted is worse than one that
 * narrows.
 */
create policy field_changes_read on public.field_changes
  for select to authenticated
  using (
    public.can_write_section(
      coalesce((select t.read_section from public.audited_tables t
                 where t.table_name = field_changes.table_name), 'ADMIN'),
      org_id, business_unit_id)
  );

/*
 * Nobody writes this table over the API. The trigger below is a definer
 * function and does not need the grant; a signed-in user holding INSERT could
 * write an edit that never happened and attribute it to a colleague, which is
 * worse than having no trail, because it is a trail that looks real.
 */
revoke all on public.field_changes from anon, authenticated;
grant select on public.field_changes to authenticated;

/*
 * Append-only, enforced. The grants above already stop the API; this stops
 * everything else that runs as the owner — a migration, a seeder, a function
 * written next year that means well.
 *
 * 0080's erasure switches user triggers off on the tables it rewrites, which
 * is how the pseudonymisation of `changed_by_email` gets through. That is
 * intended: an erasure that cannot reach the audit trail leaves behind the
 * address it was asked to remove.
 *
 * ── The cascade is the other exception, and it had to be found ─────────────
 *
 * `org_id` cascades, so deleting a venue deletes its history — and a cascade
 * is a DELETE, which fires this trigger. The first version refused it, which
 * made the foreign key impossible to honour: `supabase db reset` stopped
 * dead, because `seed.sql` deletes the organisations it is about to rebuild.
 * An append-only table hanging off a cascading key has to be able to tell a
 * cascade from somebody tidying the record.
 *
 * The test is the parent's absence, not the caller's identity. By the time
 * referential integrity issues the child delete, the venue row is already
 * gone, and no ordinary delete can produce that state — the key would have
 * refused it first. So "the venue this belongs to no longer exists" is
 * exactly the cascade, and nothing else.
 *
 * TRUNCATE is not covered and is not meant to be: only the owner of the table
 * holds it, and a development database has to stay rebuildable. A ledger
 * nobody can rebuild is a ledger nobody develops against.
 */
create or replace function public.field_changes_are_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and not exists (select 1 from public.organizations o where o.id = old.org_id) then
    return old;
  end if;
  raise exception 'the edit history cannot be %',
    case tg_op when 'UPDATE' then 'rewritten' else 'deleted' end
    using hint = 'It is append-only. A correction is a new edit, which records itself.';
end $$;

create trigger field_changes_append_only
  before update or delete on public.field_changes
  for each row execute function public.field_changes_are_append_only();

-- ── 3 · The trigger that writes it ─────────────────────────────────────────

/*
 * Definer, because `field_changes` grants `authenticated` nothing but SELECT
 * and the whole point is that the caller cannot write here directly.
 *
 * It reads the registry on every statement rather than taking the column
 * names as trigger arguments. Arguments would be faster and would also be a
 * second copy of the registry, free to disagree with it; `66_an_edit_leaves_a_trace`
 * asserts the two cannot. The registry is tens of rows and the plan is cached.
 */
create or replace function public.record_field_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  reg      record;
  f        record;
  subject  jsonb;
  old_j    jsonb;
  new_j    jsonb;
  row_org  uuid;
  row_unit uuid;
  row_key  uuid;
  actor    uuid   := (select auth.uid());
  actor_at text   := nullif((select auth.jwt()) ->> 'email', '');
  was      text;
  now_     text;
begin
  select * into reg from public.audited_tables where table_name = tg_table_name;
  /*
   * The trigger exists and the registry does not know about it. Raising stops
   * every write to the table, which is drastic and is the point: the
   * alternative is a table that quietly stops being audited while its history
   * tab still shows the entries from before somebody edited the registry.
   * `install_field_audit()` is how the two are kept in step.
   */
  if reg is null then
    raise exception 'audited_tables has no row for %, so its edits cannot be recorded',
      tg_table_name
      using hint = 'Add the row, or drop the trigger. Run install_field_audit() to resynchronise.';
  end if;

  old_j   := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  new_j   := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  subject := coalesce(new_j, old_j);

  row_org  := (subject ->> reg.org_column)::uuid;
  row_key  := (subject ->> reg.key_column)::uuid;
  if reg.unit_column is not null then
    row_unit := (subject ->> reg.unit_column)::uuid;
  end if;

  /*
   * A cascade from deleting the venue, which is the one delete with nowhere
   * to be recorded: the ledger entry would reference an organisation that no
   * longer exists, and the ledger it would go in is being deleted by the same
   * statement. Found by `supabase db reset` — `seed.sql` deletes its venues,
   * the cascade reached `products`, and the audit row for each deleted
   * product failed the foreign key on a venue that was already gone.
   *
   * `tg_op = 'DELETE'` is part of the condition deliberately. An INSERT or
   * UPDATE naming a venue that does not exist is not a cascade, it is a bug,
   * and it should fail the key rather than be quietly skipped.
   */
  if tg_op = 'DELETE'
     and not exists (select 1 from public.organizations o where o.id = row_org) then
    return null;
  end if;

  if tg_op <> 'UPDATE' then
    insert into public.field_changes
      (org_id, business_unit_id, table_name, record_id, action,
       changed_by, changed_by_email)
    values (row_org, row_unit, tg_table_name, row_key, tg_op, actor, actor_at);
    return null;
  end if;

  for f in select column_name, values_withheld
             from public.audited_fields
            where table_name = tg_table_name
            order by column_name
  loop
    was  := old_j ->> f.column_name;
    now_ := new_j ->> f.column_name;
    /*
     * `is not distinct from` rather than `<>`, so a field going to or from
     * null is a change. With `<>` both directions compare null and record
     * nothing, which is the edit most worth having: a price that was set and
     * is now blank costs every recipe using it nothing at all.
     */
    continue when was is not distinct from now_;
    insert into public.field_changes
      (org_id, business_unit_id, table_name, record_id, action, field_name,
       old_value, new_value, values_withheld, changed_by, changed_by_email)
    values (row_org, row_unit, tg_table_name, row_key, 'UPDATE', f.column_name,
            case when f.values_withheld then null else was  end,
            case when f.values_withheld then null else now_ end,
            f.values_withheld, actor, actor_at);
  end loop;
  return null;
end $$;

/*
 * Not an API. It does DDL as the owner and takes its instructions from a
 * table; over PostgREST that is a signed-in user attaching triggers.
 * `23_exposure.sql` names it alongside the seeders and `notify`.
 */
revoke all on function public.record_field_changes() from anon, authenticated;

-- ── 4 · Keeping the triggers and the registry in step ──────────────────────

/*
 * §6: starting data belongs in a function that can be run again, not in a
 * one-off INSERT whose effect nobody can reproduce. This one is also the
 * repair for the exception `record_field_changes` raises — it attaches what
 * the registry asks for and detaches what it no longer does.
 */
create or replace function public.install_field_audit()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  t       record;
  n       integer := 0;
  trigger_name text;
begin
  -- Detach first, so a table removed from the registry stops writing before
  -- the loop below would make `record_field_changes` raise on it.
  for t in
    select c.relname, g.tgname
      from pg_trigger g
      join pg_class c on c.oid = g.tgrelid
     where g.tgname = c.relname || '_field_audit'
       and not exists (select 1 from public.audited_tables a
                        where a.table_name = c.relname)
  loop
    execute format('drop trigger %I on public.%I', t.tgname, t.relname);
  end loop;

  for t in select table_name from public.audited_tables order by table_name loop
    trigger_name := t.table_name || '_field_audit';
    execute format('drop trigger if exists %I on public.%I',
                   trigger_name, t.table_name);
    /*
     * AFTER, so a constraint or a guard that refuses the write refuses it
     * before anything is recorded. A BEFORE trigger would write the history
     * of edits that never happened.
     */
    execute format(
      'create trigger %I after insert or update or delete on public.%I '
      'for each row execute function public.record_field_changes()',
      trigger_name, t.table_name);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.install_field_audit() from anon, authenticated;

-- ── 5 · What is audited ────────────────────────────────────────────────────

/*
 * The section each table reads under is taken from the table's own write
 * guard, not restated: `products` is guarded by RECIPES, so its history is
 * read by RECIPES write. Restating them would be a third copy of a mapping
 * that already exists twice, and the copy would be the one that rots.
 */
insert into public.audited_tables (table_name, read_section, because)
select c.relname,
       split_part(encode(g.tgargs, 'escape'), E'\\000', 1),
       'the section that guards writes to it'
  from pg_trigger g
  join pg_class c on c.oid = g.tgrelid
 where g.tgname = c.relname || '_section_guard'
   and c.relname in ('products', 'recipes', 'sub_recipes', 'menu_items',
                     'menus', 'suppliers', 'employees', 'employee_private',
                     'approval_policies');

/* The two with no section guard. Decision 4 in the header says why ADMIN. */
insert into public.audited_tables
  (table_name, read_section, org_column, key_column, because) values
  ('organizations',  'ADMIN', 'id',     'id', 'the venue is its own venue; writing it needs auth_is_admin'),
  ('member_access',  'ADMIN', 'org_id', 'id', 'granting somebody access is an administration act');

/* 0116's heads of department. See `unit_column` on the registry. */
update public.audited_tables
   set unit_column = 'business_unit_id'
 where table_name = 'employees';

/*
 * `employee_private` is keyed by the employee, not by an `id` of its own —
 * one private record per person is the whole design. The default would have
 * looked for a column that does not exist, and the failure would have been a
 * null `record_id` on the first edit of somebody's bank details rather than
 * an error here.
 */
update public.audited_tables
   set key_column = 'employee_id'
 where table_name = 'employee_private';

/*
 * The fields. Entered, not derived — decision 1.
 *
 * Read this list as a statement about what the venue argues about: a price, a
 * yield, a pack size, a tax rate, an approval threshold, who was given write
 * access to what. Nothing here is a convenience for a developer; every line
 * is a number or a permission somebody could be held to.
 */
insert into public.audited_fields (table_name, column_name) values
  -- The catalogue. `buying_price_per_pack` is the one a person types; every
  -- other price in the system is derived from it by the cascade.
  ('products', 'name'),
  ('products', 'brand'),
  /*
   * Both supplier columns. `supplier` is the name as somebody typed it and
   * `supplier_id` is the link to the supplier record; the product form writes
   * either, and auditing only the link would record nothing at all when a
   * venue that has not built its supplier list changes who it buys from.
   */
  ('products', 'supplier'),
  ('products', 'supplier_id'),
  /*
   * The unit stock is counted in. Changing it does not change a single stored
   * figure and changes what every one of them means — 4 becomes 4 kg where it
   * was 4 cases — so it is the edit most likely to be denied afterwards.
   */
  ('products', 'stock_unit'),
  ('products', 'buying_price_per_pack'),
  ('products', 'pack_qty'),
  ('products', 'pack_unit'),
  ('products', 'units_per_pack'),
  ('products', 'yield_percent'),
  ('products', 'ref_percent'),
  ('products', 'status'),
  ('products', 'par_level'),
  ('products', 'reorder_point'),
  ('products', 'allergens'),
  -- Recipes. `menu_price` is what the dish sells for; `status` is what makes
  -- it servable.
  ('recipes', 'name'),
  ('recipes', 'status'),
  ('recipes', 'menu_price'),
  ('recipes', 'yield_qty'),
  ('recipes', 'waste_percent'),
  ('recipes', 'inflation_percent'),
  ('recipes', 'tax_percent'),
  ('sub_recipes', 'name'),
  ('sub_recipes', 'status'),
  ('sub_recipes', 'batch_yield_qty'),
  ('sub_recipes', 'security_margin_percent'),
  -- The menu. A selling price and whether the dish is on.
  ('menu_items', 'display_name'),
  /* Repointing a menu line at another dish sells something else at the same
     price under the same name. */
  ('menu_items', 'recipe_id'),
  ('menu_items', 'selling_price'),
  ('menu_items', 'tax_rate_id'),
  ('menu_items', 'is_available'),
  ('menus', 'name'),
  ('menus', 'active_from'),
  ('menus', 'active_to'),
  -- Suppliers. Terms and the approval number a food inspector asks for.
  ('suppliers', 'name'),
  ('suppliers', 'status'),
  ('suppliers', 'vat_number'),
  ('suppliers', 'approval_number'),
  ('suppliers', 'payment_terms_days'),
  ('suppliers', 'lead_time_days'),
  ('suppliers', 'minimum_order_value'),
  -- People. Hours and status drive pay; the manager drives who approves what.
  ('employees', 'employment_status'),
  ('employees', 'employment_type'),
  ('employees', 'contracted_hours_per_week'),
  ('employees', 'job_role_id'),
  ('employees', 'department_id'),
  ('employees', 'business_unit_id'),
  ('employees', 'manager_id'),
  ('employees', 'started_on'),
  ('employees', 'ended_on'),
  -- Venue parameters. Every one of these changes what a dish costs or what
  -- the label must say.
  ('organizations', 'currency_code'),
  ('organizations', 'standard_vat_percent'),
  ('organizations', 'reduced_vat_percent'),
  ('organizations', 'service_charge_percent'),
  ('organizations', 'prices_include_tax'),
  ('organizations', 'country_code'),
  ('organizations', 'food_regime'),
  ('organizations', 'allergen_profile_code'),
  ('organizations', 'timezone'),
  -- Approval thresholds. A policy that quietly moved is a policy nobody has.
  ('approval_policies', 'min_amount'),
  ('approval_policies', 'required_role'),
  -- Access. Who was given write to what, and by whom.
  ('member_access', 'section_code'),
  ('member_access', 'level'),
  ('member_access', 'business_unit_id');

/* Decision 2. These record the change and never the value. */
insert into public.audited_fields (table_name, column_name, values_withheld) values
  ('employee_private', 'date_of_birth',  true),
  ('employee_private', 'personal_email', true),
  ('employee_private', 'personal_phone', true),
  ('employee_private', 'home_address',   true),
  ('employee_private', 'national_id',    true),
  ('employee_private', 'tax_id',         true),
  ('employee_private', 'bank_account',   true);

select public.install_field_audit();

comment on table public.field_changes is
  'Append-only field-level edit history. Written only by record_field_changes(); '
  'read under WRITE on the section that guards writes to the audited table.';
comment on column public.field_changes.values_withheld is
  'The field is recorded without its values on purpose (a bank account, a '
  'national ID). A null value here means withheld, not empty.';
