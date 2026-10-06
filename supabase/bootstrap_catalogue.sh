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

# Every statement in the generated file ends on a line ending ');' and every
# other values line ends '),' — checked here rather than assumed, because a
# regenerated file that broke the shape would otherwise load half a catalogue.
src="$HERE/seed_manuza.sql"
statements="$(grep -c '^insert into' "$src")"
endings="$(grep -c ');$' "$src")"
if [ "$statements" != "$endings" ]; then
  echo "seed_manuza.sql no longer has one ');' per insert ($statements vs $endings)." >&2
  echo "Refusing to guess where its statements end." >&2
  exit 1
fi

{
  echo "begin;"
  sed -e '/^truncate /d' \
      -e "s/$DEMO_ORG/$ORG/g" \
      -e 's/);$/) on conflict do nothing;/' "$src"
  echo "commit;"
} | psql "$DB" -X -q -v ON_ERROR_STOP=1

psql "$DB" -X -q -c "
  select 'products' as kind, count(*) from products where org_id = '$ORG'
  union all select 'sub_recipes', count(*) from sub_recipes where org_id = '$ORG'
  union all select 'recipes',     count(*) from recipes     where org_id = '$ORG'"
