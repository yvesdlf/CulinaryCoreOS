-- ---------------------------------------------------------------------------
-- Which allergens a venue must declare
-- ---------------------------------------------------------------------------
-- The registry has been the EU 14 of Regulation 1169/2011 Annex II since it
-- was written, and the ids carried the assumption in their names —
-- `EU14_CELERY`, `EU14_GLUTEN_CEREALS`. A venue under FDA rules needs a list
-- that overlaps but is not a subset, so the assumption had to come out of the
-- identifiers and into data.
--
-- Checking what was actually stored first changed this design. Nothing in
-- any table held an `EU14_` id: products, recipes and incidents carry
-- informal tokens — `dairy`, `gluten`, `fish`, `shellfish`, `egg` — which the
-- client resolved through an alias table on the way to the screen. Five
-- distinct values across every row in the database. So this is a
-- normalisation, not the six-table rewrite it looked like, and the ids become
-- what they should always have been: the substance, named neutrally, with no
-- jurisdiction in the name.
--
-- The modelling problem is gluten, and it is worth stating because the
-- obvious answers are both wrong.
--
-- The EU declares "cereals containing gluten" — wheat, rye, barley, oats,
-- spelt, kamut. The United States declares *wheat*, and nothing else from
-- that family. A record saying `GLUTEN_CEREALS` therefore cannot be narrowed
-- to wheat: nobody wrote down which cereal it was, and converting it would be
-- inventing knowledge about food somebody is going to eat.
--
-- Dropping it instead is worse. So a profile may declare a substance it
-- cannot be certain about, and say so: under the US profile
-- `GLUTEN_CEREALS` is declared as wheat with `over_inclusive` set, because
-- for allergens the safe error has a direction. Declaring wheat that is
-- really rye inconveniences somebody; omitting wheat that is really wheat
-- harms them. That asymmetry is the whole of AGENTS.md §8 and it is the
-- reason this column exists rather than a quiet mapping.
--
-- What a profile never does is hide a substance. Celery, mustard, lupin,
-- sulphites and molluscs are not regulated allergens in the United States,
-- and a venue on that profile still sees them on the product — as present,
-- not as a declaration. Silence is not a free-from claim in either
-- jurisdiction.
-- ---------------------------------------------------------------------------

/*
 * The substances, named without a jurisdiction.
 *
 * Reference data rather than a per-venue seeder: the list of things people
 * are allergic to is not a venue's to configure, and a venue that could edit
 * it could quietly remove one.
 */
create table if not exists allergen_substances (
  id text primary key,
  name text not null,
  note text,
  constraint allergen_substances_id_shape check (id ~ '^[A-Z][A-Z_]*$')
);

insert into allergen_substances (id, name, note) values
  ('CELERY',         'Celery',               'Including celeriac and celery salt.'),
  ('GLUTEN_CEREALS', 'Cereals containing gluten',
     'Wheat, rye, barley, oats, spelt or kamut. The record does not say which.'),
  ('WHEAT',          'Wheat',                'Specifically wheat, where the record says so.'),
  ('CRUSTACEANS',    'Crustaceans',          'Prawns, crab, lobster.'),
  ('MOLLUSCS',       'Molluscs',             'Squid, octopus, mussels, oysters, clams.'),
  ('EGGS',           'Eggs',                 null),
  ('FISH',           'Fish',                 null),
  ('LUPIN',          'Lupin',                null),
  ('MILK',           'Milk',                 'Including lactose.'),
  ('MUSTARD',        'Mustard',              null),
  ('PEANUTS',        'Peanuts',              null),
  ('SESAME',         'Sesame',               null),
  ('SOYBEANS',       'Soybeans',             null),
  ('SULPHITES',      'Sulphur dioxide and sulphites',
     'Declarable above 10 mg/kg or 10 mg/l expressed as SO2.'),
  ('TREE_NUTS',      'Tree nuts',            'Almonds, hazelnuts, walnuts, cashews, pecans, Brazil, pistachio, macadamia.')
on conflict (id) do nothing;

create table if not exists allergen_profiles (
  code text primary key,
  name text not null,
  /* Cited, never invented — AGENTS.md §9. */
  instrument text not null,
  constraint allergen_profiles_code_shape check (code ~ '^[A-Z][A-Z_]*$')
);

insert into allergen_profiles (code, name, instrument) values
  ('EU_FIC', 'European Union and United Kingdom',
   'Regulation (EU) No 1169/2011, Annex II; retained in UK law'),
  ('US_FDA', 'United States',
   'FALCPA 2004 as amended by the FASTER Act 2021, 21 U.S.C. 343(w)')
on conflict (code) do nothing;

/*
 * What each profile requires declared, and under what words.
 *
 * `declared_as` is a column rather than reuse of `allergen_substances.name`
 * because the two jurisdictions name the same substance differently:
 * "crustaceans" in the EU is "crustacean shellfish" on a US label, and the
 * written name is the legally meaningful text.
 */
create table if not exists allergen_declarations (
  profile_code text not null references allergen_profiles(code) on delete cascade,
  substance_id text not null references allergen_substances(id) on delete cascade,
  declared_as text not null,
  /*
   * The declaration may be wider than the record supports.
   *
   * Only `GLUTEN_CEREALS` under the US profile uses this today: the record
   * says a gluten cereal and the US declares wheat, and nobody wrote down
   * which cereal it was. Declaring it is the safe direction — wheat that is
   * really rye inconveniences somebody, omitted wheat harms them — but a
   * screen must be able to say the declaration is broader than the evidence.
   */
  over_inclusive boolean not null default false,
  over_inclusive_note text,

  primary key (profile_code, substance_id),
  constraint allergen_declarations_note_present
    check (not over_inclusive or over_inclusive_note is not null)
);

insert into allergen_declarations (profile_code, substance_id, declared_as) values
  ('EU_FIC', 'CELERY', 'Celery'),
  ('EU_FIC', 'GLUTEN_CEREALS', 'Cereals containing gluten'),
  ('EU_FIC', 'WHEAT', 'Cereals containing gluten (wheat)'),
  ('EU_FIC', 'CRUSTACEANS', 'Crustaceans'),
  ('EU_FIC', 'MOLLUSCS', 'Molluscs'),
  ('EU_FIC', 'EGGS', 'Eggs'),
  ('EU_FIC', 'FISH', 'Fish'),
  ('EU_FIC', 'LUPIN', 'Lupin'),
  ('EU_FIC', 'MILK', 'Milk'),
  ('EU_FIC', 'MUSTARD', 'Mustard'),
  ('EU_FIC', 'PEANUTS', 'Peanuts'),
  ('EU_FIC', 'SESAME', 'Sesame'),
  ('EU_FIC', 'SOYBEANS', 'Soya'),
  ('EU_FIC', 'SULPHITES', 'Sulphur dioxide and sulphites'),
  ('EU_FIC', 'TREE_NUTS', 'Tree nuts'),

  ('US_FDA', 'WHEAT', 'Wheat'),
  ('US_FDA', 'CRUSTACEANS', 'Crustacean shellfish'),
  ('US_FDA', 'EGGS', 'Eggs'),
  ('US_FDA', 'FISH', 'Fish'),
  ('US_FDA', 'MILK', 'Milk'),
  ('US_FDA', 'PEANUTS', 'Peanuts'),
  ('US_FDA', 'SESAME', 'Sesame'),
  ('US_FDA', 'SOYBEANS', 'Soybeans'),
  ('US_FDA', 'TREE_NUTS', 'Tree nuts')
on conflict (profile_code, substance_id) do nothing;

insert into allergen_declarations
  (profile_code, substance_id, declared_as, over_inclusive, over_inclusive_note)
values
  ('US_FDA', 'GLUTEN_CEREALS', 'Wheat', true,
   'The record says a cereal containing gluten without saying which. Declared as wheat because an unnecessary declaration inconveniences somebody and a missing one harms them.')
on conflict (profile_code, substance_id) do nothing;

alter table organizations
  add column if not exists allergen_profile_code text not null default 'EU_FIC';

do $$ begin
  alter table organizations
    add constraint organizations_allergen_profile_fkey
    foreign key (allergen_profile_code) references allergen_profiles(code);
exception when duplicate_object then null; end $$;

/*
 * Normalise what is already stored.
 *
 * The data holds the aliases people typed — `dairy`, `gluten`, `shellfish` —
 * rather than ids, so this is the one chance to make the stored vocabulary
 * the same vocabulary the rules are written in. Anything that does not map
 * is left exactly as it is: an allergen nobody recognises is still an
 * allergen, and dropping it to tidy a column is the failure this whole area
 * exists to prevent.
 */
create or replace function public.normalise_allergen(p_raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    /*
     * The old ids first, and this was missed on the first pass because the
     * tables did not hold any — the *seeds* did. `seed_manuza.sql` is
     * generated from the mock catalogue and still writes `EU14_MILK`, so a
     * rebuilt database arrived full of the spelling this migration exists to
     * retire, passed straight through by the normaliser as an unrecognised
     * value. Kept rather than dropped, which was the right failure and still
     * the wrong result. Stripping the prefix is what a normaliser is for.
     */
    case
      when upper(btrim(p_raw)) like 'EU14\_%'
       and exists (select 1 from public.allergen_substances a
                    where a.id = substring(upper(btrim(p_raw)) from 6))
      then substring(upper(btrim(p_raw)) from 6)
    end,
    case lower(btrim(p_raw))
      when 'celery' then 'CELERY'        when 'celeriac' then 'CELERY'
      when 'gluten' then 'GLUTEN_CEREALS' when 'cereals' then 'GLUTEN_CEREALS'
      when 'rye' then 'GLUTEN_CEREALS'   when 'barley' then 'GLUTEN_CEREALS'
      when 'oats' then 'GLUTEN_CEREALS'
      when 'wheat' then 'WHEAT'
      when 'crustaceans' then 'CRUSTACEANS' when 'shellfish' then 'CRUSTACEANS'
      when 'prawn' then 'CRUSTACEANS'    when 'prawns' then 'CRUSTACEANS'
      when 'shrimp' then 'CRUSTACEANS'   when 'crab' then 'CRUSTACEANS'
      when 'lobster' then 'CRUSTACEANS'
      when 'molluscs' then 'MOLLUSCS'    when 'mollusks' then 'MOLLUSCS'
      when 'squid' then 'MOLLUSCS'       when 'octopus' then 'MOLLUSCS'
      when 'mussel' then 'MOLLUSCS'      when 'oyster' then 'MOLLUSCS'
      when 'clam' then 'MOLLUSCS'
      when 'egg' then 'EGGS'             when 'eggs' then 'EGGS'
      when 'fish' then 'FISH'
      when 'lupin' then 'LUPIN'
      when 'milk' then 'MILK'            when 'dairy' then 'MILK'
      when 'lactose' then 'MILK'         when 'cheese' then 'MILK'
      when 'butter' then 'MILK'          when 'cream' then 'MILK'
      when 'mustard' then 'MUSTARD'
      when 'peanut' then 'PEANUTS'       when 'peanuts' then 'PEANUTS'
      when 'groundnut' then 'PEANUTS'
      when 'sesame' then 'SESAME'
      when 'soy' then 'SOYBEANS'         when 'soya' then 'SOYBEANS'
      when 'soybean' then 'SOYBEANS'     when 'soybeans' then 'SOYBEANS'
      when 'sulphites' then 'SULPHITES'  when 'sulfites' then 'SULPHITES'
      when 'sulphur dioxide' then 'SULPHITES'
      when 'sulfur dioxide' then 'SULPHITES'
      when 'so2' then 'SULPHITES'
      when 'tree nuts' then 'TREE_NUTS'  when 'nuts' then 'TREE_NUTS'
      when 'almond' then 'TREE_NUTS'     when 'hazelnut' then 'TREE_NUTS'
      when 'walnut' then 'TREE_NUTS'     when 'cashew' then 'TREE_NUTS'
      when 'pecan' then 'TREE_NUTS'      when 'pistachio' then 'TREE_NUTS'
      when 'macadamia' then 'TREE_NUTS'
    end,
    -- Unrecognised, and kept. See the header.
    btrim(p_raw)
  );
$$;

/*
 * Base tables only. `allergen_incidents` carries an `allergens` column and is
 * a view over `incidents` — updating it raises rather than silently doing
 * nothing, which is the better failure, but the list is derived from the
 * catalogue now so a view added later cannot get into it either.
 */
do $$
declare t text;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
     where n.nspname = 'public'
       and c.relkind = 'r'
       and a.attname = 'allergens'
       and a.attnum > 0
       and not a.attisdropped
     order by c.relname
  loop
    execute format($f$
      update public.%I
         set allergens = (
           select array_agg(distinct public.normalise_allergen(a))
             from unnest(allergens) a)
       where allergens is not null and array_length(allergens, 1) > 0
    $f$, t);
  end loop;
end $$;

/*
 * And keep it normalised, rather than normalising once.
 *
 * The one-time pass above fixes what exists; it does nothing about the next
 * row. The seeds alone re-introduced the informal tokens the moment the
 * database was rebuilt — `db reset` runs the migrations and *then* loads
 * `seed.sql`, so the normalisation ran against an empty catalogue and the
 * tokens arrived afterwards. An invariant that holds only at migration time
 * is not an invariant.
 *
 * A value the registry does not recognise still passes through unchanged.
 * That is the point: an allergen nobody has mapped is still an allergen, and
 * refusing the write would make the safe thing to do with an unfamiliar
 * declaration "leave it out".
 */
create or replace function public.normalise_allergens_on_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  /*
   * The empty array is the case to be careful about, and it is the same trap
   * AGENTS.md records against a CHECK that could never fail: `array_length`
   * of `'{}'` is null rather than zero, and `array_agg` over no rows is null
   * rather than an empty array. The first draft guarded only on `is not
   * null` and wrote NULL into a NOT NULL column for every product with no
   * allergens — which is most of them, so `db reset` failed on the seed.
   *
   * `coalesce` back to what arrived, so a row with no allergens keeps its
   * empty array and a row with some keeps them normalised.
   */
  if new.allergens is not null and array_length(new.allergens, 1) > 0 then
    new.allergens := coalesce(
      (select array_agg(distinct public.normalise_allergen(a))
         from unnest(new.allergens) a),
      new.allergens);
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
     where n.nspname = 'public'
       and c.relkind = 'r'
       and a.attname = 'allergens'
       and a.attnum > 0
       and not a.attisdropped
     order by c.relname
  loop
    execute format(
      'drop trigger if exists %1$s_normalise_allergens on public.%1$I', t);
    execute format(
      'create trigger %1$s_normalise_allergens
         before insert or update of allergens on public.%1$I
         for each row execute function public.normalise_allergens_on_write()', t);
  end loop;
end $$;

/*
 * What a set of substances means under a profile.
 *
 * Returns a row for every substance, declared or not. That is the whole
 * point: a substance a profile does not regulate is still in the food, and a
 * function that returned only the declarable ones would let a US venue's
 * screen show a celery-containing dish with nothing against it.
 */
create or replace function public.allergens_under_profile(
  p_profile text, p_substances text[]
)
returns table (
  substance_id text,
  substance_name text,
  declared boolean,
  declared_as text,
  over_inclusive boolean,
  over_inclusive_note text,
  recognised boolean
)
language sql
stable
set search_path = ''
as $$
  select
    s.raw,
    coalesce(sub.name, s.raw),
    (d.substance_id is not null),
    d.declared_as,
    coalesce(d.over_inclusive, false),
    d.over_inclusive_note,
    (sub.id is not null)
  from unnest(coalesce(p_substances, array[]::text[])) as s(raw)
  left join public.allergen_substances sub on sub.id = s.raw
  left join public.allergen_declarations d
    on d.substance_id = s.raw and d.profile_code = p_profile
  order by (d.substance_id is null), coalesce(sub.name, s.raw);
$$;

grant select on allergen_substances to authenticated, anon;
grant select on allergen_profiles to authenticated, anon;
grant select on allergen_declarations to authenticated, anon;
grant execute on function public.allergens_under_profile(text, text[])
  to authenticated, anon;
grant execute on function public.normalise_allergen(text) to authenticated;

/*
 * Reference data, readable by everyone and writable by nobody through the
 * API. A venue that could edit the declaration table could quietly stop
 * declaring peanuts.
 */
alter table allergen_substances enable row level security;
alter table allergen_profiles enable row level security;
alter table allergen_declarations enable row level security;

drop policy if exists allergen_substances_read on allergen_substances;
create policy allergen_substances_read on allergen_substances
  for select to authenticated, anon using (true);
drop policy if exists allergen_profiles_read on allergen_profiles;
create policy allergen_profiles_read on allergen_profiles
  for select to authenticated, anon using (true);
drop policy if exists allergen_declarations_read on allergen_declarations;
create policy allergen_declarations_read on allergen_declarations
  for select to authenticated, anon using (true);

comment on table allergen_substances is
  'What is in the food, named without a jurisdiction. Reference data: the list of things people are allergic to is not a venue''s to configure. See 0119.';
comment on table allergen_declarations is
  'What each profile requires declared, and in what words. `over_inclusive` marks a declaration wider than the record supports — see 0119 on gluten.';
comment on function public.allergens_under_profile(text, text[]) is
  'Every substance, declared or not. A substance a profile does not regulate is still in the food.';
