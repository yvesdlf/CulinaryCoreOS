-- ---------------------------------------------------------------------------
-- Something to scan, and something to print
-- ---------------------------------------------------------------------------
-- Gap list items eighteen and nineteen, together because they are two halves
-- of the same shift: the barcode is how a product is found on a shelf, and
-- the label is what goes on the tub afterwards.
--
-- Barcodes first, and the only interesting part is the check digit. A
-- mistyped barcode does not fail — it attaches to the wrong product, or to
-- no product, silently and permanently, and is discovered by somebody
-- counting a walk-in at six in the morning. GS1 puts a check digit on the end
-- of every EAN and UPC precisely so a transposed pair can be caught, and
-- refusing one that does not check out costs nothing and saves that morning.
-- Codes with no check digit of their own — CODE128, an internal number, a QR
-- code — are taken as given, which is stated rather than silently assumed.
--
-- A product can carry several: the case barcode and the unit barcode are
-- different numbers for different things, and a venue that buys the same
-- ingredient from two suppliers has two. One of them is primary, which is
-- what a label prints.
--
-- The label is the half with a legal edge on it. Regulation 1169/2011 is why
-- `prep_label` carries allergens at all, and `AGENTS.md` §8 is why it carries
-- `allergens_need_review` beside them: anything inferred from a product name
-- is a guess, and a printed label is the most confident surface in the
-- building. A label that silently prints an inferred allergen list is exactly
-- the dangerous failure — not a missing allergen, a *confident* one.
--
-- So the view never says "contains no allergens". It says what was found and
-- whether any of it still needs a person to read a packet, and the printing
-- surface is required to show the second thing beside the first.
-- ---------------------------------------------------------------------------

do $$ begin
  create type barcode_kind as enum
    ('EAN13', 'EAN8', 'UPCA', 'CODE128', 'QR', 'INTERNAL');
exception when duplicate_object then null; end $$;

/*
 * The GS1 modulo-10 check digit.
 *
 * Digits are weighted 3 and 1 from the right, excluding the check digit
 * itself, and the check digit is what takes the total to the next multiple
 * of ten. The same rule covers EAN-13, EAN-8 and UPC-A, which is why one
 * function serves all three rather than three nearly-identical ones.
 */
create or replace function public.barcode_check_digit_ok(p_code text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  body text := left(p_code, length(p_code) - 1);
  given integer := right(p_code, 1)::integer;
  total integer := 0;
  i integer;
  weight integer;
begin
  if p_code !~ '^[0-9]+$' then
    return false;
  end if;

  -- Weighted from the right: the digit next to the check digit carries 3.
  for i in reverse length(body) .. 1 loop
    weight := case when (length(body) - i) % 2 = 0 then 3 else 1 end;
    total := total + substr(body, i, 1)::integer * weight;
  end loop;

  return (10 - (total % 10)) % 10 = given;
end $$;

create table if not exists product_barcodes (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,

  barcode text not null,
  kind barcode_kind not null default 'EAN13',
  is_primary boolean not null default false,
  /* What this number is on: a case of twelve, or one tin. */
  describes text,
  note text,

  created_at timestamptz not null default now(),
  created_by_email text,

  constraint product_barcodes_not_blank check (btrim(barcode) <> ''),
  constraint product_barcodes_length check (
    case kind
      when 'EAN13' then length(btrim(barcode)) = 13
      when 'EAN8'  then length(btrim(barcode)) = 8
      when 'UPCA'  then length(btrim(barcode)) = 12
      else length(btrim(barcode)) between 1 and 128
    end
  )
);

/*
 * One barcode means one product, within a venue.
 *
 * Not globally — two venues are allowed their own internal numbering — but
 * inside one, a scan has to resolve to a single answer or the scanner is
 * useless. Where this fires it is usually a duplicate product, which 0103's
 * merge is for.
 */
create unique index if not exists idx_product_barcodes_unique
  on product_barcodes(org_id, btrim(barcode));

create index if not exists idx_product_barcodes_product
  on product_barcodes(product_id);

/* One primary per product, so a label has one number to print. */
create unique index if not exists idx_product_barcodes_primary
  on product_barcodes(product_id) where is_primary;

create or replace function public.enforce_product_barcode()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  /*
   * Worked out before the IF rather than inside it, and not for tidiness.
   * plpgsql scans an IF condition up to the first `THEN`, so a `case … when
   * … then … end` in the condition truncates it there and the function fails
   * to compile with "syntax error at end of input" pointing at a line that
   * looks perfectly correct.
   */
  expected_length integer := case new.kind
                               when 'EAN13' then 13
                               when 'EAN8'  then 8
                               when 'UPCA'  then 12
                             end;
begin
  new.barcode := btrim(new.barcode);

  /*
   * Checked for the kinds that carry a check digit, and taken as given for
   * the kinds that do not. Pretending to validate a CODE128 would be worse
   * than not validating it: it reads as a guarantee.
   *
   * Only once the length is right. A BEFORE trigger runs ahead of the CHECK
   * constraint, so a five-digit code claiming to be an EAN-13 was being told
   * its check digit did not add up — true, and not the mistake that was
   * made. Each wrong thing should name itself.
   */
  if expected_length is not null
     and length(new.barcode) = expected_length
     and not public.barcode_check_digit_ok(new.barcode) then
    raise exception
      '% is not a valid %: the check digit does not add up', new.barcode, new.kind
      using hint = 'The last digit checks the rest, and this one does not — usually a transposed pair.';
  end if;

  -- The first barcode on a product is its primary one, because a product
  -- with barcodes and no primary prints a label with no number on it.
  if not exists (
    select 1 from public.product_barcodes b
     where b.product_id = new.product_id
       and b.id is distinct from new.id
  ) then
    new.is_primary := true;
  end if;

  return new;
end $$;

drop trigger if exists product_barcodes_enforce on product_barcodes;
create trigger product_barcodes_enforce
  before insert or update on product_barcodes
  for each row execute function public.enforce_product_barcode();

drop trigger if exists product_barcodes_set_org on product_barcodes;
create trigger product_barcodes_set_org before insert on product_barcodes
  for each row execute function public.set_org_id();

/*
 * What did I just scan?
 *
 * A function rather than a view so a scanner can ask one question and get one
 * answer, and so "nothing" is a plain empty result rather than a row of
 * nulls that a careless caller renders as a product called "undefined".
 */
create or replace function public.product_for_barcode(p_org uuid, p_code text)
returns table (product_id uuid, product_name text, barcode text, kind barcode_kind)
language sql
stable
security invoker
set search_path = ''
as $$
  select b.product_id, p.name, b.barcode, b.kind
    from public.product_barcodes b
    join public.products p on p.id = b.product_id
   where b.org_id = p_org
     and btrim(b.barcode) = btrim(p_code);
$$;

grant execute on function public.product_for_barcode(uuid, text) to authenticated;

alter table product_barcodes enable row level security;

drop policy if exists product_barcodes_read on product_barcodes;
create policy product_barcodes_read on product_barcodes for select to authenticated
  using (public.can_read_section('RECIPES', org_id));
drop policy if exists product_barcodes_write on product_barcodes;
create policy product_barcodes_write on product_barcodes for all to authenticated
  using (public.auth_can_write(org_id)
         and public.can_read_section('RECIPES', org_id))
  with check (public.auth_can_write(org_id));

grant select, insert, update, delete on product_barcodes to authenticated;

/*
 * Guarded by RECIPES, like `products` itself (0090's reasoning): a barcode is
 * a fact about the product rather than about the stock on the shelf.
 */
drop trigger if exists product_barcodes_section_guard on product_barcodes;
create trigger product_barcodes_section_guard
  before insert or update or delete on product_barcodes
  for each row execute function public.require_section_write('RECIPES');

delete from public.section_read_rules where table_name = 'product_barcodes';
insert into public.section_read_rules (table_name, section_code)
values ('product_barcodes', 'RECIPES');

-- ---------------------------------------------------------------------------
-- Labels
-- ---------------------------------------------------------------------------

/*
 * What goes on the tub.
 *
 * Built from the production record rather than from the recipe, because the
 * label describes a thing that exists: this batch, made by this person, on
 * this day. A label generated from a recipe would be a claim about a batch
 * nobody has made yet.
 *
 * Allergens come from the products actually consumed, exploded through every
 * level (0111), and `allergens_need_review` is true if *any* of them is a
 * guess. Regulation 1169/2011 is why they are here; AGENTS.md §8 is why the
 * caveat travels with them — the dangerous failure on a printed label is not
 * a missing allergen but a confident one, and a label is the most confident
 * surface in a kitchen.
 *
 * There is deliberately no "contains no allergens" column. Silence is not a
 * free-from claim, and the only honest statement this view can make is "none
 * found in what we know about".
 */
create or replace view prep_label
with (security_invoker = true) as
  select
    r.org_id,
    r.id                   as production_record_id,
    r.sub_recipe_id,
    s.name                 as item_name,
    r.batches,
    r.quantity_made,
    r.unit,
    (r.occurred_at at time zone 'UTC')::date as made_on,
    r.produced_by_email    as made_by,
    r.note,

    /*
     * The use-by. A prepared item's life is a venue policy and differs by
     * what it is, so it comes from `venue_parameters` rather than a constant
     * here, and the kind is USE_BY rather than BEST_BEFORE: 1169/2011 draws
     * the line at food that becomes unsafe rather than merely worse, and a
     * kitchen preparation is on the unsafe side of it.
     */
    ((r.occurred_at at time zone 'UTC')::date
      + coalesce(vp.value, 3)::int)          as use_by,
    'USE_BY'::public.expiry_kind             as expiry_kind,

    /* Allergens from what was actually consumed, all the way down. */
    coalesce(a.allergens, array[]::text[])   as allergens,
    coalesce(a.needs_review, false)          as allergens_need_review,
    coalesce(a.unverified_products, array[]::text[]) as unverified_products
  from public.production_records_effective r
  join public.sub_recipes s on s.id = r.sub_recipe_id
  left join public.venue_parameters vp
    on vp.org_id = r.org_id and vp.code = 'PREP_USE_BY_DAYS'
  left join lateral (
    select
      array_agg(distinct al)       filter (where al is not null) as allergens,
      bool_or(p.allergens_need_review)                           as needs_review,
      array_agg(distinct p.name)   filter (where p.allergens_need_review) as unverified_products
      from public.production_usage_theoretical t
      join public.products p on p.id = t.product_id
      left join lateral unnest(p.allergens) as al on true
     where t.production_record_id = r.id
  ) a on true;

grant select on prep_label to authenticated;

create or replace function public.seed_prep_label_parameter(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.venue_parameters
    (org_id, code, name, description, value, unit, min_value, max_value)
  values (p_org, 'PREP_USE_BY_DAYS', 'Prepared items last',
          'How many days a kitchen preparation is given before its use-by. A venue policy, not a constant: it differs by what is being made and by what the local authority expects.',
          3, 'days', 1, 30)
  on conflict (org_id, code) do nothing;
end $$;

revoke all on function public.seed_prep_label_parameter(uuid)
  from public, anon, authenticated;

insert into public.organization_seeders (ordinal, function_name, note)
select coalesce(max(ordinal), 0) + 1, 'seed_prep_label_parameter',
       'How long a kitchen preparation lasts, for its label (0113)'
  from public.organization_seeders
on conflict (function_name) do nothing;

do $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.seed_prep_label_parameter(o.id);
  end loop;
end $$;

/*
 * That a label was printed, and by whom.
 *
 * 178/2002 Article 18 is about being able to say where something came from
 * and where it went; a label is the only part of that chain that leaves the
 * building on the product. Knowing one was printed — and reprinted — is
 * cheap to record and impossible to reconstruct later.
 */
create table if not exists label_prints (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  production_record_id uuid references production_records(id) on delete cascade,
  lot_id uuid references stock_lots(id) on delete cascade,

  copies integer not null default 1,
  printed_at timestamptz not null default now(),
  printed_by_email text,
  /* Carried on the row, because the policy can change and the label cannot. */
  use_by date,
  allergens_shown text[],
  allergens_were_unverified boolean not null default false,

  constraint label_prints_copies check (copies > 0),
  constraint label_prints_about_something
    check (production_record_id is not null or lot_id is not null)
);

create index if not exists idx_label_prints_record
  on label_prints(production_record_id);

drop trigger if exists label_prints_set_org on label_prints;
create trigger label_prints_set_org before insert on label_prints
  for each row execute function public.set_org_id();

alter table label_prints enable row level security;

drop policy if exists label_prints_read on label_prints;
create policy label_prints_read on label_prints for select to authenticated
  using (public.can_read_section('PRODUCTION', org_id));
drop policy if exists label_prints_write on label_prints;
create policy label_prints_write on label_prints for all to authenticated
  using (public.auth_can_write(org_id)
         and public.can_read_section('PRODUCTION', org_id))
  with check (public.auth_can_write(org_id));

grant select, insert on label_prints to authenticated;

drop trigger if exists label_prints_section_guard on label_prints;
create trigger label_prints_section_guard
  before insert or update or delete on label_prints
  for each row execute function public.require_section_write('PRODUCTION');

delete from public.section_read_rules where table_name = 'label_prints';
insert into public.section_read_rules (table_name, section_code)
values ('label_prints', 'PRODUCTION');

comment on table product_barcodes is
  'A scan resolves to one product within a venue. EAN and UPC check digits are verified; CODE128 and internal numbers are taken as given, which is stated rather than assumed. See 0113.';
comment on view prep_label is
  'What goes on the tub, built from the batch that exists rather than the recipe. Carries allergens_need_review beside the allergens: on a printed label the dangerous failure is a confident allergen, not a missing one (1169/2011, AGENTS.md §8). See 0113.';
