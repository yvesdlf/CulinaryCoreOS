-- ---------------------------------------------------------------------------
-- A venue adds its own fields without a migration
-- ---------------------------------------------------------------------------
-- Every customer wants one thing nobody else does: a shelf code on products,
-- a halal flag, an internal supplier rating, the number of the fridge a lot
-- lives in. Without somewhere to put them they go in the notes field, where
-- nothing can report on them and two people spell the same thing
-- differently.
--
-- The design question is where the validation lives. A `jsonb` column with
-- no rules is a second notes field with braces in it, so the definitions are
-- rows and a trigger checks every write against them.
--
-- What is deliberately NOT allowed: a required custom field. A venue that
-- makes "shelf code" required stops every import, every API caller and every
-- screen that does not know about it — including this project's own — and
-- the failure arrives as a constraint violation somewhere unrelated. A field
-- can be defined, typed, constrained and reported on; it cannot block a
-- write made by something that has never heard of it.
-- ---------------------------------------------------------------------------

do $$ begin
  create type custom_field_type as enum
    ('TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT');
exception when duplicate_object then null; end $$;

create table if not exists custom_field_definitions (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  /* Which table it decorates. Checked against a list below. */
  entity_type text not null,
  key text not null,
  label text not null,
  field_type custom_field_type not null default 'TEXT',

  /* For SELECT. Empty for everything else. */
  options text[] not null default '{}',
  min_value numeric,
  max_value numeric,
  help text,
  sort_order integer,
  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint custom_field_definitions_entity
    check (entity_type in ('products', 'suppliers', 'recipes', 'employees',
                           'stock_lots', 'assets')),
  /*
   * A key is an identifier, not a label. It ends up in exports, in API
   * payloads and in whatever somebody builds on top, and "Shelf Code " with
   * a trailing space is a bug that surfaces a year later.
   */
  constraint custom_field_definitions_key
    check (key ~ '^[a-z][a-z0-9_]{0,38}$'),
  constraint custom_field_definitions_labelled check (btrim(label) <> ''),
  /*
   * coalesce, because array_length of an empty array is null rather than
   * zero — and a check constraint treats null as passing. The first draft
   * read `array_length(options, 1) > 0` and could never have failed, which
   * is the same shape as the harness's note that an UPDATE matching no rows
   * raises nothing: a rule that cannot fire looks exactly like one that
   * holds.
   */
  constraint custom_field_definitions_options
    check (field_type <> 'SELECT' or coalesce(array_length(options, 1), 0) > 0),
  constraint custom_field_definitions_range
    check (min_value is null or max_value is null or max_value >= min_value),
  constraint custom_field_definitions_unique unique (org_id, entity_type, key)
);

alter table products   add column if not exists custom_fields jsonb not null default '{}'::jsonb;
alter table suppliers  add column if not exists custom_fields jsonb not null default '{}'::jsonb;
alter table recipes    add column if not exists custom_fields jsonb not null default '{}'::jsonb;
alter table employees  add column if not exists custom_fields jsonb not null default '{}'::jsonb;
alter table stock_lots add column if not exists custom_fields jsonb not null default '{}'::jsonb;
alter table assets     add column if not exists custom_fields jsonb not null default '{}'::jsonb;

/*
 * Every value checked against its definition.
 *
 * Attached per table rather than written generically over `tg_argv`,
 * because the entity type has to be a constant the trigger can be trusted
 * with — and six explicit attachments are greppable in a way one clever one
 * is not.
 *
 * An undefined key is refused rather than ignored. Silently dropping it
 * would mean an import that looks successful and loses a column.
 */
create or replace function public.validate_custom_fields()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  k text;
  v jsonb;
  def record;
  n numeric;
begin
  if new.custom_fields is null or new.custom_fields = '{}'::jsonb then
    return new;
  end if;
  if jsonb_typeof(new.custom_fields) <> 'object' then
    raise exception 'custom fields must be an object';
  end if;

  for k, v in select * from jsonb_each(new.custom_fields) loop
    select * into def
      from public.custom_field_definitions d
     where d.org_id = new.org_id and d.entity_type = tg_argv[0]
       and d.key = k and d.active;

    if def is null then
      raise exception 'there is no custom field called % on %', k, tg_argv[0]
        using hint = 'Define it first, or it is a typo nobody would ever find.';
    end if;

    -- A null is "not set", which is always allowed; that is how a field is
    -- cleared without deleting the key everywhere.
    if jsonb_typeof(v) = 'null' then
      continue;
    end if;

    case def.field_type
      when 'NUMBER' then
        if jsonb_typeof(v) <> 'number' then
          raise exception '% expects a number, got %', k, jsonb_typeof(v);
        end if;
        n := (v #>> '{}')::numeric;
        if def.min_value is not null and n < def.min_value then
          raise exception '% must be at least %', k, def.min_value;
        end if;
        if def.max_value is not null and n > def.max_value then
          raise exception '% must be at most %', k, def.max_value;
        end if;
      when 'BOOLEAN' then
        if jsonb_typeof(v) <> 'boolean' then
          raise exception '% expects true or false, got %', k, jsonb_typeof(v);
        end if;
      when 'DATE' then
        begin
          perform (v #>> '{}')::date;
        exception when others then
          raise exception '% expects a date, got %', k, v #>> '{}';
        end;
      when 'SELECT' then
        if not ((v #>> '{}') = any(def.options)) then
          raise exception '% must be one of %', k, array_to_string(def.options, ', ');
        end if;
      else
        if jsonb_typeof(v) <> 'string' then
          raise exception '% expects text, got %', k, jsonb_typeof(v);
        end if;
    end case;
  end loop;

  return new;
end $$;

drop trigger if exists products_custom_fields on products;
create trigger products_custom_fields before insert or update on products
  for each row execute function public.validate_custom_fields('products');
drop trigger if exists suppliers_custom_fields on suppliers;
create trigger suppliers_custom_fields before insert or update on suppliers
  for each row execute function public.validate_custom_fields('suppliers');
drop trigger if exists recipes_custom_fields on recipes;
create trigger recipes_custom_fields before insert or update on recipes
  for each row execute function public.validate_custom_fields('recipes');
drop trigger if exists employees_custom_fields on employees;
create trigger employees_custom_fields before insert or update on employees
  for each row execute function public.validate_custom_fields('employees');
drop trigger if exists stock_lots_custom_fields on stock_lots;
create trigger stock_lots_custom_fields before insert or update on stock_lots
  for each row execute function public.validate_custom_fields('stock_lots');
drop trigger if exists assets_custom_fields on assets;
create trigger assets_custom_fields before insert or update on assets
  for each row execute function public.validate_custom_fields('assets');

drop trigger if exists custom_field_definitions_set_org on custom_field_definitions;
create trigger custom_field_definitions_set_org before insert on custom_field_definitions
  for each row execute function public.set_org_id();
drop trigger if exists custom_field_definitions_touch on custom_field_definitions;
create trigger custom_field_definitions_touch before update on custom_field_definitions
  for each row execute function public.set_updated_at();

alter table custom_field_definitions enable row level security;

drop policy if exists custom_field_definitions_read on custom_field_definitions;
create policy custom_field_definitions_read on custom_field_definitions for select to authenticated
  using (org_id in (select public.auth_org_ids()));
drop policy if exists custom_field_definitions_write on custom_field_definitions;
create policy custom_field_definitions_write on custom_field_definitions for all to authenticated
  using (public.can_write_section('ADMIN', org_id))
  with check (public.can_write_section('ADMIN', org_id));

grant select, insert, update, delete on custom_field_definitions to authenticated;

delete from public.section_read_rules where table_name = 'custom_field_definitions';
insert into public.section_read_rules (table_name, section_code, shared_because)
values ('custom_field_definitions', null,
        'what the extra fields on a form mean, needed wherever one is shown');

comment on table custom_field_definitions is
  'Fields a venue adds for itself. Defining one is an Administration act; a value is checked against it on every write. See 0106.';
comment on column products.custom_fields is
  'Validated against custom_field_definitions. An undefined key is refused, never ignored. See 0106.';
