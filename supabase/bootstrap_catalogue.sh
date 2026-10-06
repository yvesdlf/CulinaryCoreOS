#!/usr/bin/env bash
#
# Load the Manuza catalogue into a named organisation on a real database.
#
#   supabase/bootstrap_catalogue.sh <connection-string> <org-id>
#
# Why this exists rather than `psql -f seed_manuza.sql`: that file starts by
# truncating products, recipes and sub-recipes across every organisation, and
# writes into the demo organisation that only seed.sql creates — seed.sql being
# the file that also creates an owner whose password is in this repository.
# DEPLOY.md told people to run both against production. This derives the same
# rows from the same generated file, so the two cannot drift, with three
# differences: no truncate, the organisation is the one you name, and a row
# that already exists is left alone, so running it twice changes nothing.

set -euo pipefail

DB="${1:?usage: $0 <connection-string> <org-id>}"
ORG="${2:?usage: $0 <connection-string> <org-id>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMO_ORG="a7d63561-c014-53f4-9bd1-4273d5625836"

if ! [[ "$ORG" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  echo "Not an organisation id: $ORG" >&2
  exit 2
fi

# $ORG is safe to interpolate: it has just been checked to be a bare UUID.
exists="$(psql "$DB" -X -q -t -A \
  -c "select count(*) from organizations where id = '$ORG'")"
if [ "$exists" != "1" ]; then
  echo "No organisation $ORG in that database. The owner signs up first;" >&2
  echo "their organisation id is what goes here." >&2
  exit 2
fi

# The generated rows carry fixed ids, chosen for the demo venue. Loaded as
# they are, the first venue gets them and every venue after it gets nothing —
# `on conflict do nothing` turned that into a silent success, which the
# reality check of this script found. So the rows are read into temporary
# tables first and copied across with ids derived from the venue: the same
# venue always gets the same ids, so a second run still changes nothing,
# and two venues never collide.
src="$HERE/seed_manuza.sql"
tables="products sub_recipes recipes sub_recipe_lines recipe_lines"

{
  echo "begin;"
  for t in $tables; do
    echo "create temp table _$t (like public.$t including defaults) on commit drop;"
    # The generated lines leave org_id to a trigger on the real table.
    echo "alter table _$t alter column org_id drop not null;"
  done
  sed -E -e '/^truncate /d' \
         -e 's/^insert into (products|sub_recipes|recipes|sub_recipe_lines|recipe_lines) /insert into _\1 /' "$src"
  cat <<SQL
create function pg_temp.remap(id uuid) returns uuid language sql immutable
  as \$\$ select case when id is null then null else md5('$ORG' || id::text)::uuid end \$\$;

insert into public.products
select (jsonb_populate_record(null::public.products, to_jsonb(t) || jsonb_build_object(
          'id', pg_temp.remap(t.id), 'org_id', '$ORG'))).*
  from _products t on conflict do nothing;
insert into public.sub_recipes
select (jsonb_populate_record(null::public.sub_recipes, to_jsonb(t) || jsonb_build_object(
          'id', pg_temp.remap(t.id), 'org_id', '$ORG'))).*
  from _sub_recipes t on conflict do nothing;
insert into public.recipes
select (jsonb_populate_record(null::public.recipes, to_jsonb(t) || jsonb_build_object(
          'id', pg_temp.remap(t.id), 'org_id', '$ORG'))).*
  from _recipes t on conflict do nothing;
insert into public.sub_recipe_lines
select (jsonb_populate_record(null::public.sub_recipe_lines, to_jsonb(t) || jsonb_build_object(
          'id', pg_temp.remap(t.id), 'org_id', '$ORG',
          'sub_recipe_id', pg_temp.remap(t.sub_recipe_id),
          'product_id', pg_temp.remap(t.product_id),
          'child_sub_recipe_id', pg_temp.remap(t.child_sub_recipe_id)))).*
  from _sub_recipe_lines t on conflict do nothing;
insert into public.recipe_lines
select (jsonb_populate_record(null::public.recipe_lines, to_jsonb(t) || jsonb_build_object(
          'id', pg_temp.remap(t.id), 'org_id', '$ORG',
          'recipe_id', pg_temp.remap(t.recipe_id),
          'product_id', pg_temp.remap(t.product_id),
          'sub_recipe_id', pg_temp.remap(t.sub_recipe_id)))).*
  from _recipe_lines t on conflict do nothing;
SQL
  echo "commit;"
} | psql "$DB" -X -q -v ON_ERROR_STOP=1

counts="$(psql "$DB" -X -q -t -A -F' ' -c "
  select (select count(*) from products where org_id = '$ORG'),
         (select count(*) from sub_recipes where org_id = '$ORG'),
         (select count(*) from recipes where org_id = '$ORG')")"
read -r n_products n_subs n_recipes <<<"$counts"
echo "products $n_products · sub-recipes $n_subs · recipes $n_recipes in $ORG"
if [ "$n_products" -eq 0 ]; then
  echo "Nothing was loaded. That is a failure, not an empty catalogue." >&2
  exit 1
fi
