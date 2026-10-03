-- ---------------------------------------------------------------------------
-- "The kitchen's people", not "people"
-- ---------------------------------------------------------------------------
-- Gap 6. A grant in `member_access` names a section and a level and nothing
-- else, so the smallest thing anybody can be given is every venue's record in
-- that section. A head chef who should manage the kitchen brigade's rota and
-- leave either manages the whole venue's staff — the general manager's record,
-- the accountant's salary notes — or manages nobody's and sends requests to
-- somebody who has the time to be a bottleneck.
--
-- This adds one nullable column and the arithmetic that reads it.
--
-- ## Null means every unit, and that is why nothing breaks
--
-- Every grant that exists today has `business_unit_id` null and keeps meaning
-- exactly what it meant. A migration that changed the meaning of existing rows
-- would be changing who can see what in a running venue, silently, which is
-- the one thing an access-control migration must not do.
--
-- ## A unit-scoped grant does not reach a row with no unit
--
-- The narrow reading, deliberately. A requisition with no business unit is
-- spend charged to nobody; it is not the kitchen's, so "WRITE on Purchasing
-- for the kitchen" does not reach it. The alternative — treating an unset
-- column as "everyone's" — would mean the way to escape a scoped grant is to
-- leave a field blank, and somebody would find that out.
--
-- ## Two grants can stack, and the wider one wins
--
-- A person may hold READ on People across the venue and WRITE on People for
-- the kitchen. For a kitchen row they get WRITE; for anybody else's row they
-- get READ. `auth_section_level` returns the better of the two rather than the
-- more specific, because the alternative is a narrow grant silently *removing*
-- access somebody already had.
--
-- ## A unit-scoped grant is refused where it would mean nothing
--
-- Four sections guard tables that carry a unit: People, Purchasing,
-- Maintenance and Venue parameters. Scoping a Recipes grant to the kitchen
-- would be accepted, mean nothing, and then refuse every write — a permission
-- that looks granted and behaves as revoked, which is worse than being told
-- no. `app_sections.scopes_by_unit` says which sections can take one, and it
-- is derived from the catalogue below rather than typed, so a table that gains
-- a unit column later does not leave this list wrong.
-- ---------------------------------------------------------------------------

-- ── Which sections can be scoped at all ─────────────────────────────────────

alter table app_sections
  add column if not exists scopes_by_unit boolean not null default false;

comment on column app_sections.scopes_by_unit is
  'Whether a grant in this section can name one business unit. True where the section guards tables that carry business_unit_id.';

/*
 * Derived from what is actually guarded, not from a list somebody keeps.
 *
 * Reads every `require_section_write` trigger in the schema, takes the section
 * out of its argument, and asks whether that table carries a business unit. A
 * section added by a later migration gets the right answer by re-running this
 * block; a hand-written list would get yesterday's answer and nobody would
 * notice until a grant behaved oddly.
 */
create or replace function public.refresh_section_unit_scoping()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.app_sections s
     set scopes_by_unit = exists (
       select 1
         from pg_catalog.pg_trigger t
         join pg_catalog.pg_class c on c.oid = t.tgrelid
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where not t.tgisinternal
          and n.nspname = 'public'
          and pg_catalog.pg_get_triggerdef(t.oid)
              like '%require_section_write(''' || s.code || ''')%'
          and exists (
            select 1 from pg_catalog.pg_attribute a
             where a.attrelid = c.oid
               and a.attname = 'business_unit_id'
               and a.attnum > 0
               and not a.attisdropped));
end;
$$;

select public.refresh_section_unit_scoping();

comment on function public.refresh_section_unit_scoping() is
  'Recomputes app_sections.scopes_by_unit from the guards actually attached. Call it after adding a guarded table.';

-- ── The grant gains a unit ──────────────────────────────────────────────────

alter table member_access
  add column if not exists business_unit_id uuid
    references business_units(id) on delete cascade;

comment on column member_access.business_unit_id is
  'Which unit this grant covers. Null means every unit, which is what every grant written before 0062 means.';

/*
 * The old unique constraint said one grant per person per section. That is now
 * one grant per person per section *per unit*, plus at most one unscoped grant
 * — and a null does not collide with a null in a unique index, so the unscoped
 * one needs an index of its own.
 *
 * Two partial indexes rather than one on `coalesce(business_unit_id, <sentinel
 * uuid>)`: a sentinel uuid is a value that means "no value", which is the
 * thing this schema refuses everywhere else, and the day somebody creates a
 * unit with that id it stops being hypothetical.
 */
alter table member_access drop constraint if exists member_access_unique;

create unique index if not exists idx_member_access_unscoped
  on member_access(org_id, user_id, section_code)
  where business_unit_id is null;

create unique index if not exists idx_member_access_scoped
  on member_access(org_id, user_id, section_code, business_unit_id)
  where business_unit_id is not null;

create index if not exists idx_member_access_unit
  on member_access(business_unit_id) where business_unit_id is not null;

/*
 * A grant cannot name another venue's unit, and cannot name a unit at all in a
 * section where that would mean nothing.
 *
 * Both refused rather than corrected. A grant quietly stripped of its unit is
 * a grant that reads as "the kitchen" on the screen that wrote it and behaves
 * as "everybody" everywhere else, which is the worst possible outcome for an
 * access-control row.
 */
create or replace function public.enforce_member_access_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  scopable boolean;
  unit_org uuid;
begin
  if new.business_unit_id is null then
    return new;
  end if;

  select s.scopes_by_unit into scopable
    from public.app_sections s where s.code = new.section_code;
  if not coalesce(scopable, false) then
    raise exception 'access to % cannot be limited to one business unit',
      coalesce((select s.name from public.app_sections s where s.code = new.section_code),
               new.section_code)
      using hint = 'Nothing in this section belongs to a unit, so the grant would refuse everything. Leave the unit blank.';
  end if;

  select b.org_id into unit_org
    from public.business_units b where b.id = new.business_unit_id;
  if unit_org is distinct from new.org_id then
    raise exception 'that business unit belongs to another organisation';
  end if;

  return new;
end;
$$;

create trigger member_access_unit
  before insert or update on member_access
  for each row execute function public.enforce_member_access_unit();

-- ── Reading a level, for one unit ───────────────────────────────────────────

/*
 * The level this caller has in a section, for a row belonging to `p_unit`.
 *
 * `p_unit` null means a row that belongs to no unit, and only an unscoped
 * grant reaches it — see the header.
 *
 * An OWNER still answers first and is not scopable. The owner of the venue
 * limited to one of its units is a role nobody has asked for, and inventing it
 * here would mean a venue could lock its own owner out of a department.
 */
create or replace function public.auth_section_level(
  p_section text, p_org uuid, p_unit uuid)
returns access_level
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select 'WRITE'::public.access_level
       from public.organization_members m
      where m.user_id = (select auth.uid())
        and m.organization_id = p_org
        and m.role = 'OWNER'
      limit 1),
    /*
     * The better of the unscoped grant and the grant for this unit, not the
     * more specific. WRITE sorts after READ sorts after NONE in the enum, so
     * max() is the rule and the enum is already written in that order.
     */
    (select max(a.level)
       from public.member_access a
      where a.user_id = (select auth.uid())
        and a.section_code = p_section
        and a.org_id = p_org
        and (a.business_unit_id is null
             or (p_unit is not null and a.business_unit_id = p_unit))),
    'NONE'::public.access_level
  );
$$;

create or replace function public.can_write_section(
  p_section text, p_org uuid, p_unit uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.auth_section_level(p_section, p_org, p_unit) = 'WRITE'; $$;

create or replace function public.can_read_section(
  p_section text, p_org uuid, p_unit uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.auth_section_level(p_section, p_org, p_unit) <> 'NONE'; $$;

grant execute on function
  public.auth_section_level(text, uuid, uuid),
  public.can_write_section(text, uuid, uuid),
  public.can_read_section(text, uuid, uuid)
  to authenticated;

/*
 * The two-argument forms keep working and now mean "across the whole venue".
 *
 * Forty-odd policies and every section guard call one of these. Rewriting them
 * all in this migration would be rewriting forty access-control rules to add
 * one column, which is how a migration widens a policy by accident. They are
 * redefined in terms of the three-argument form instead, so there is one
 * implementation of the arithmetic.
 *
 * "Across the whole venue" is the unscoped grant alone: `p_unit => null`. A
 * person with only a kitchen grant therefore answers NONE here, which is the
 * right answer to "may you write this section generally" and the wrong answer
 * to "may you write this kitchen row" — which is why the trigger below passes
 * the row's own unit rather than calling this.
 */
create or replace function public.auth_section_level(p_section text, p_org uuid)
returns access_level
language sql stable security definer set search_path = ''
as $$ select public.auth_section_level(p_section, p_org, null::uuid); $$;

-- ── The guard checks the unit the row is in, and the one it is going to ─────
/*
 * The level is read for the unit the row names — and on an UPDATE that moves a
 * row between units, for *both* units.
 *
 * Checking one of them is an escape, and it took a control check to see which
 * way round. The first version of this trigger read NEW and fell back to OLD,
 * with a comment explaining that this stopped a kitchen manager emptying the
 * bar. It stopped the opposite thing. Reading NEW alone means the grant that
 * is checked is the grant for the *destination*, so a kitchen manager can pull
 * every one of the bar's employees into the kitchen one row at a time, each
 * move perfectly authorised. Reading OLD alone is the mirror image: you may
 * push your own rows into somebody else's unit and lose them.
 *
 * So both, when they differ. Moving a record between departments is an act in
 * two departments and needs standing in each.
 *
 * `to_jsonb(...) ->> 'business_unit_id'` is null both when the table has no
 * such column and when the row leaves it blank. Those two want the same answer
 * — only an unscoped grant reaches them — so there is one path and not a
 * catalogue lookup per write.
 */
create or replace function public.require_section_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  section text := tg_argv[0];
  fresh jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  stale jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  row_org uuid;
  units uuid[];
  row_unit uuid;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  row_org := coalesce(
    (fresh ->> 'org_id')::uuid,
    (stale ->> 'org_id')::uuid,
    public.auth_default_org_id());

  /*
   * One unit for an insert or a delete; two for an update that moves the row,
   * and one for an update that does not. Distinct, so the unchanged case asks
   * the same single question it always did.
   */
  units := array(select distinct u from unnest(array[
    nullif(fresh ->> 'business_unit_id', '')::uuid,
    nullif(stale ->> 'business_unit_id', '')::uuid
  ]) as u);
  if array_length(units, 1) is null then
    units := array[null::uuid];
  end if;

  /*
   * Somebody who is not a member of this venue is not governed by the section
   * model at all. That is the staff portal, and refusing them here once
   * refused a chef their own clock-in with a message about a section they are
   * not supposed to know exists.
   */
  if not exists (
    select 1 from public.organization_members m
     where m.user_id = auth.uid() and m.organization_id = row_org
  ) then
    return coalesce(new, old);
  end if;

  foreach row_unit in array units loop
    if not public.can_write_section(section, row_org, row_unit) then
      raise exception 'you do not have edit access to %',
        coalesce((select s.name from public.app_sections s where s.code = section), section)
        || case when row_unit is not null
                then ' for ' || coalesce((select b.name from public.business_units b
                                           where b.id = row_unit), 'that unit')
                else '' end
        using hint = 'Ask an administrator for edit rights to this section.';
    end if;
  end loop;
  return coalesce(new, old);
end;
$$;

-- ── What the screens read ───────────────────────────────────────────────────
/*
 * The grid the administration screen draws, with the scoped grants beside it.
 *
 * 0036's shape is kept exactly: every member crossed with every section, the
 * grant left-joined, NONE where there is none and WRITE for an owner. The
 * screen reads `email`, `role` and `sort_order` off this view, and a rewrite
 * that dropped them would have emptied the access table on the Administration
 * page — which TypeScript would not have caught, because the row comes back as
 * `any` from PostgREST.
 *
 * The scoped grants arrive as additional rows with a unit on them, union'd on
 * rather than folded in. A reader that only looks at (user_id, section_code,
 * level) therefore sees what it saw before plus rows it does not recognise —
 * so `fetchMySectionAccess` takes the best level per section rather than
 * whichever row happened to arrive last, which with one row per section it had
 * been getting away with.
 */
drop view if exists member_access_grid;

create view member_access_grid as
  -- One row per member per section, as 0036 drew it. The unscoped grant.
  select
    m.organization_id as org_id,
    m.user_id,
    u.email,
    m.role,
    s.code as section_code,
    s.name as section_name,
    s.sort_order,
    s.scopes_by_unit,
    null::uuid as business_unit_id,
    null::text as business_unit_code,
    null::text as business_unit_name,
    coalesce(a.level, case when m.role = 'OWNER' then 'WRITE'::public.access_level
                           else 'NONE'::public.access_level end) as level
  from public.organization_members m
  join auth.users u on u.id = m.user_id
  cross join public.app_sections s
  left join public.member_access a
    on a.user_id = m.user_id and a.org_id = m.organization_id
   and a.section_code = s.code and a.business_unit_id is null
  where m.organization_id in (select public.auth_org_ids())

  union all

  -- And one row per grant that names a unit. There is no cross join here: a
  -- unit a person was never granted is not a row, it is an absence.
  select
    a.org_id,
    a.user_id,
    u.email,
    m.role,
    a.section_code,
    s.name,
    s.sort_order,
    s.scopes_by_unit,
    a.business_unit_id,
    b.code,
    b.name,
    a.level
  from public.member_access a
  join public.organization_members m
    on m.user_id = a.user_id and m.organization_id = a.org_id
  join auth.users u on u.id = a.user_id
  join public.app_sections s on s.code = a.section_code
  join public.business_units b on b.id = a.business_unit_id
  where a.business_unit_id is not null
    and a.org_id in (select public.auth_org_ids());

grant select on member_access_grid to authenticated;

comment on view member_access_grid is
  'Who may do what, and where. A null business unit is the grant that covers every unit.';

-- ── Writing a grant ─────────────────────────────────────────────────────────
/*
 * One way in, because the uniqueness changed and an upsert cannot express it.
 *
 * "One grant per person per section" is now "one unscoped grant, plus one per
 * unit", which is two partial unique indexes. A partial index can arbitrate an
 * ON CONFLICT only when the statement repeats its WHERE clause, and PostgREST's
 * `onConflict` sends a column list with no WHERE — so the front end's upsert
 * stopped working the moment the old constraint came off. It did not fail
 * quietly: three fixtures went red on the next run.
 *
 * Delete-then-insert rather than a cleverer arbiter. It is what the screen
 * already means — NONE deletes the row, so the table holds grants and never
 * denials — and it states the whole operation in one place instead of leaving
 * the caller to remember which of the two indexes it is aiming at.
 *
 * Deliberately SECURITY INVOKER. It runs as the caller, so `member_access`'s
 * own ADMIN section guard and its row-level policies apply exactly as they
 * would to a direct write, and this function grants nobody anything. The guard
 * fires on the DELETE as well, so somebody without Administration is refused
 * before the insert is reached rather than after their old grant is gone.
 */
create or replace function public.set_section_access(
  p_user uuid,
  p_section text,
  p_level public.access_level,
  p_unit uuid default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  home uuid := public.auth_default_org_id();
begin
  if home is null then
    raise exception 'there is no venue to grant access in';
  end if;

  /*
   * `is not distinct from`, not `=`. The unscoped grant has a null unit and
   * `business_unit_id = null` matches nothing, so plain equality would leave
   * the old row in place and the insert would collide with it.
   */
  delete from public.member_access
   where org_id = home
     and user_id = p_user
     and section_code = p_section
     and business_unit_id is not distinct from p_unit;

  if p_level = 'NONE' then
    return;
  end if;

  insert into public.member_access
    (org_id, user_id, section_code, level, business_unit_id, granted_by_email)
  values
    (home, p_user, p_section, p_level, p_unit,
     nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''));
end;
$$;

grant execute on function
  public.set_section_access(uuid, text, public.access_level, uuid) to authenticated;

comment on function public.set_section_access(uuid, text, public.access_level, uuid) is
  'Grant, narrow or remove one section for one person, optionally for one unit. Runs as the caller.';

/*
 * The default grants a new member gets, aimed at the index that now exists.
 *
 * Unchanged in every other respect — same roles, same levels, same sections.
 * It is here only because its ON CONFLICT named the constraint this migration
 * removed, and an insert that cannot name an arbiter raises rather than doing
 * nothing. Three fixtures went red on the first run after the constraint came
 * off, which is why this is a paragraph and not somebody's first sign-up.
 *
 * Every default grant is unscoped, which is what it has always been: a new
 * member starts with the whole venue and is narrowed afterwards, rather than
 * starting with nothing and having to be handed each unit.
 */
create or replace function public.seed_member_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  lvl public.access_level;
begin
  if new.role = 'OWNER' then
    return new;
  end if;

  for s in select code from public.app_sections loop
    lvl := case
      when new.role = 'ADMIN' then 'WRITE'::public.access_level
      when new.role = 'CHEF' then
        case
          when s.code = 'ADMIN' then 'NONE'::public.access_level
          when s.code = 'PARAMETERS' then 'READ'::public.access_level
          else 'WRITE'::public.access_level
        end
      else
        case
          when s.code in ('ADMIN', 'HR_CASES') then 'NONE'::public.access_level
          else 'READ'::public.access_level
        end
    end;

    if lvl <> 'NONE' then
      insert into public.member_access (org_id, user_id, section_code, level)
      values (new.organization_id, new.user_id, s.code, lvl)
      on conflict (org_id, user_id, section_code) where business_unit_id is null
        do nothing;
    end if;
  end loop;
  return new;
end;
$$;
