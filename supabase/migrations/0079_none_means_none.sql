-- ---------------------------------------------------------------------------
-- 0079 · A section set to NONE is not readable either
-- ---------------------------------------------------------------------------
-- 0036 built the access grid and said, at its head, that what somebody can
-- reach is granted explicitly and that a hidden page is not a control. It
-- enforced that for writes. Every read policy stayed "a member of the venue",
-- generated in loops by ten migrations, so somebody set to NONE on People
-- read performance reviews, exit notes, leave notes and sick-note file names
-- through the API, and a VIEWER read the takings, the contracts and the
-- budgets. The screens hid them; nothing else did.
--
-- This puts the section on the read side, from one registry, so the read and
-- write rules cannot drift: `section_read_rules` names, for every guarded
-- table, the section its rows belong to — or, for shared reference data,
-- why every member reads it. The policies are rewritten from the registry,
-- and supabase/tests/25_section_reads.sql iterates it as somebody with no
-- access at all.
--
-- What is deliberately not gated is listed with its reason below. It is the
-- data other sections' screens are built on — a purchasing screen needs the
-- catalogue and the suppliers, a rota needs names — and it is not where the
-- sensitive fields are: those left `employees` for `employee_private` in
-- 0078, which is gated.
-- ---------------------------------------------------------------------------

create table public.section_read_rules (
  table_name     text primary key,
  section_code   text references public.app_sections(code),
  shared_because text,
  constraint section_read_rules_one_or_the_other
    check ((section_code is null) <> (shared_because is null))
);

-- The registry is not secret; the suite reads it as an ordinary user.
alter table public.section_read_rules enable row level security;
create policy section_read_rules_read on public.section_read_rules
  for select to authenticated using (true);
revoke all on public.section_read_rules from anon, authenticated;
grant select on public.section_read_rules to authenticated;

-- Every table whose write guard already names a section. `requests` is the
-- shared front door: its guard takes the section from the request type, and
-- every member raises and reads requests by design (0066).
insert into public.section_read_rules (table_name, section_code)
select c.relname, split_part(encode(g.tgargs, 'escape'), '\000', 1)
  from pg_trigger g
  join pg_class c on c.oid = g.tgrelid
 where g.tgname = c.relname || '_section_guard'
   and c.relname <> 'requests';

-- Tables with no write guard whose rows are People's or another section's.
-- These were the worst of it: sick-note attachments and quiz answers had no
-- section at all.
insert into public.section_read_rules (table_name, section_code) values
  ('leave_attachments',         'PEOPLE'),
  ('quiz_attempts',             'PEOPLE'),
  ('quiz_written_answers',      'PEOPLE'),
  ('staff_document_recipients', 'PEOPLE'),
  ('staff_requests',            'PEOPLE'),
  ('time_corrections',          'PEOPLE'),
  ('takings_changes',           'REVENUE'),
  ('room_state_events',         'HOUSEKEEPING'),
  ('work_order_events',         'MAINTENANCE');

-- Shared, each for a stated reason.
update public.section_read_rules r
   set section_code = null, shared_because = x.why
  from (values
    ('approval_policies',    'venue configuration every approval applies'),
    ('business_units',       'the venue''s departments, named on every screen'),
    ('category_tax_rates',   'venue configuration costing applies'),
    ('department_approvers', 'venue configuration every approval applies'),
    ('matching_tolerances',  'venue configuration invoice matching applies'),
    ('request_types',        'what anybody may raise at the front door'),
    ('revenue_channels',     'venue configuration takings apply'),
    ('tax_rates',            'venue configuration costing applies'),
    ('venue_geofences',      'venue configuration clock-in applies'),
    ('venue_parameters',     'venue configuration every screen applies'),
    ('employees',            'the staff directory: names on rotas, work orders and requests; personal data is in employee_private, which is gated'),
    ('job_roles',            'reference data for the staff directory'),
    ('leave_types',          'reference data the portal and calendar use'),
    ('public_holidays',      'reference data the calendar and rota use'),
    ('products',             'the catalogue purchasing, inventory and production are built on'),
    ('recipes',              'the catalogue production and menu engineering are built on'),
    ('recipe_lines',         'the catalogue production and menu engineering are built on'),
    ('sub_recipes',          'the catalogue production is built on'),
    ('sub_recipe_lines',     'the catalogue production is built on'),
    ('collections',          'groupings of the catalogue'),
    ('collection_recipes',   'groupings of the catalogue'),
    ('product_pour',         'measures the bar and pour-cost screens use'),
    ('suppliers',            'the supplier list purchasing and inventory are built on'),
    ('product_suppliers',    'which supplier sells what, used to build orders'),
    ('locations',            'places in the venue, shared by maintenance, housekeeping and hygiene'),
    ('stock_lots',           'lot codes and use-by dates the inventory and receiving screens show'),
    ('hr_cases',             'governed by can_see_case: participants and HR case readers, already narrower than a section'),
    ('member_access',        'everybody reads their own grid so the app knows what to show them; rewritten by hand below')
  ) as x(t, why)
 where r.table_name = x.t;

-- ── Rewrite the read side from the registry ───────────────────────────────

/*
 * Two shapes of policy to change on a gated table.
 *
 * A SELECT policy that says "member of the venue": that clause becomes
 * `can_read_section(section, org_id[, business_unit_id])`, and any other
 * clause in it (a supplier's own rows, a case participant) is left alone.
 * The unit argument is passed where the table has one, so a grant scoped to
 * one department reads that department's rows (0062).
 *
 * An ALL policy — `*_write using (auth_can_write(org_id))` on handovers and
 * takings — which grants SELECT as well, to every CHEF. That one keeps its
 * meaning for writes and gains the section for reads.
 *
 * `*_own` policies for the staff portal match neither shape and are not
 * touched: an employee reads their own leave whatever the grid says.
 */
do $$
declare
  r record;
  p record;
  q text;
  has_unit boolean;
begin
  for r in select table_name, section_code from public.section_read_rules
            where section_code is not null loop
    select exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = r.table_name
                      and column_name = 'business_unit_id')
      into has_unit;

    for p in select polname, polcmd, pg_get_expr(polqual, polrelid) as qual
               from pg_policy
              where polrelid = ('public.' || r.table_name)::regclass
                and polcmd in ('r', '*') loop
      if p.polcmd = 'r' and p.qual ~ 'auth_org_ids\(\)' then
        q := regexp_replace(p.qual,
          '\((\w+\.)?(org_id|organization_id) IN \( SELECT auth_org_ids\(\) AS auth_org_ids\)\)',
          format('public.can_read_section(%L, \1\2%s)', r.section_code,
                 case when has_unit then ', \1business_unit_id' else '' end),
          'g');
        if q ~ 'auth_org_ids\(\)' then
          raise exception 'could not rewrite % on %: %', p.polname, r.table_name, p.qual;
        end if;
        execute format('alter policy %I on public.%I using (%s)', p.polname, r.table_name, q);
      elsif p.polcmd = '*' and p.qual !~ 'can_read_section\(' then
        execute format('alter policy %I on public.%I using ((%s) and public.can_read_section(%L, org_id))',
                       p.polname, r.table_name, p.qual, r.section_code);
      end if;
    end loop;
  end loop;
end $$;

/*
 * The access grid. Everybody reads their own rows — the app decides what to
 * show from them — and only somebody with Administration reads the rest.
 */
alter policy member_access_read on public.member_access
  using (public.can_read_section('ADMIN', org_id) or user_id = (select auth.uid()));
