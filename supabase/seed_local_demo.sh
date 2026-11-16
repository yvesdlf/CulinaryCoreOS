#!/usr/bin/env bash
#
# Build the full local demo database, reproducibly.
#
#   supabase/seed_local_demo.sh
#
# Why this exists: `supabase db reset` applies the migrations and `seed.sql`
# and nothing else, and the other six seed files were applied by hand, in
# whatever order the person remembered. The result was a database nobody could
# rebuild the same way twice — and the visual regression baselines are
# screenshots *of that database*. Fifteen of them went red with no code change
# behind it, because the catalogue underneath had been rebuilt differently.
#
# A snapshot test whose fixture cannot be reproduced is not a test. This is the
# fixture, written down.
#
# The order is not alphabetical and the dependencies are why:
#
#   seed.sql          the demo venue and its owner (loaded by `db reset`)
#   seed_catalogue       the real catalogue; TRUNCATES products first, so it must
#                     come before anything that references a product
#   seed_suppliers    promotes products.supplier text into supplier records
#   seed_stock        par levels and opening stock, over those products
#   seed_purchasing   orders, deliveries and the freight on them; needs the
#                     par levels above, since those are what make a product
#                     one the venue actually counts
#   seed_people       departments, staff, approvers
#   seed_sample_sales invented sales periods, over those recipes
#   seed_takings      daily takings and the forecasts built from them
#   seed_production   prep sheets and the batches made against them; needs the
#                     catalogue's preparations and dishes, and the people
#                     above, since a completion record names the cook
#   seed_maintenance  the plant register, the planned-maintenance programme
#                     and ninety days of work orders; needs only the
#                     locations that seed.sql creates
#
# Then `recost`, which is not optional: the seed ships every recipe with a zero
# cost and an empty allergen list, and the script computes both. Skipping it
# leaves 115 recipes costing nothing and the allergen matrix blank, which looks
# like a data problem and is really a missing step.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
DB="${1:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

case "$(printf '%s' "$DB" | sed -E 's#^[a-z]+://([^@/]*@)?(\[([^]]+)\]|([^:/?]+)).*#\3\4#')" in
  127.0.0.1|localhost|::1) ;;
  *)
    echo "This builds a demo venue and truncates the catalogue. Local only."
    exit 2
    ;;
esac

echo "Resetting (migrations + seed.sql)…"
(cd "$ROOT" && supabase db reset --local)

for f in seed_catalogue seed_suppliers seed_stock seed_purchasing seed_people seed_sample_sales seed_takings seed_production seed_maintenance; do
  echo "Applying $f.sql…"
  psql "$DB" -q -v ON_ERROR_STOP=1 -f "$HERE/$f.sql"
done

echo "Costing the catalogue…"
cd "$ROOT/apps/web"
# The anon key is the local stack's well-known development default; the
# password is the demo owner's, which is in seed.sql and in this repository.
export SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-$(supabase status -o json | sed -n 's/.*"ANON_KEY" *: *"\([^"]*\)".*/\1/p')}"
# And the URL, which is the part that cannot simply be read off.
#
# `supabase status` reports the API port from `config.toml`, not the one the
# gateway is actually published on. When 54321 is already held by something
# else the CLI publishes Kong somewhere else — 54329 on the machine this was
# found on — and goes on reporting 54321 regardless. Reading the status was
# therefore no better than hard-coding it.
#
# So the URL is tested rather than trusted, and corrected from Docker when it
# is wrong. The failure this prevents: the script rebuilds the whole database,
# reaches the last step, fails with "fetch failed", and leaves 115 recipes
# costing nothing — which reads as a data problem rather than a port.
api_url="${SUPABASE_URL:-$(supabase status -o json | sed -n 's/.*"API_URL" *: *"\([^"]*\)".*/\1/p')}"

reachable() { curl -fsS -o /dev/null --max-time 5 "$1/auth/v1/health"; }

if [ -z "$api_url" ] || ! reachable "$api_url"; then
  kong="$(docker ps --filter name=supabase_kong_ --format '{{.Names}}' | head -1)"
  published="$(docker port "$kong" 8000/tcp 2>/dev/null | head -1 | sed 's/.*://')"
  if [ -n "$published" ]; then
    echo "The API is published on $published, not on the configured port. Using it."
    api_url="http://127.0.0.1:$published"
  fi
fi

if [ -z "$api_url" ] || ! reachable "$api_url"; then
  echo "Cannot reach the local Supabase API (tried ${api_url:-nothing})." >&2
  echo "Is the stack running? \`supabase start\`" >&2
  exit 2
fi
export SUPABASE_URL="$api_url"
export CCOS_PASSWORD="${CCOS_PASSWORD:-demo-password-123}"
pnpm recost

echo
echo "Done. The database is now the state the visual baselines are taken from."
