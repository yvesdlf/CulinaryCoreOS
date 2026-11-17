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
#   seed_housekeeping rooms, four weeks of sheets and the inspections on
#                     them; needs seed_people, because 0056 refuses to
#                     assign housekeeping to anybody who is not rostered,
#                     and this publishes shifts for the two housekeepers
#   seed_hr_cases     six months of HR cases and their participant lists;
#                     needs seed_people, since a case is opened against an
#                     employee and the participants are the access control
#   seed_requests     sixty days through the front door; needs
#                     seed_maintenance, because a request that became a work
#                     order has to point at one that exists
#   seed_handover     four weeks of shift handovers, one department per way
#                     of breaking the chain; needs only the business units
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

SEEDS=(seed_catalogue seed_suppliers seed_stock seed_purchasing seed_people
       seed_sample_sales seed_takings seed_production seed_maintenance seed_housekeeping seed_hr_cases seed_requests seed_handover)

#
# Every seed named above exists, checked before the first one runs.
#
# This list and the files beside it drifted apart: the script named
# `seed_maintenance` on a branch that did not carry it yet, and the mistake
# survived local testing because the file was sitting in the working tree
# untracked. A clean checkout — which is what CI is — got four minutes into
# rebuilding the database and then stopped on "No such file or directory",
# after `db reset` had already dropped everything.
#
# Failing here costs a second and names the file. Failing there costs the
# build and leaves the database empty.
#
missing=()
for f in "${SEEDS[@]}"; do
  [ -f "$HERE/$f.sql" ] || missing+=("$f.sql")
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "seed_local_demo.sh names files that are not here: ${missing[*]}" >&2
  echo "Either add them or take them out of SEEDS." >&2
  exit 2
fi

for f in "${SEEDS[@]}"; do
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

#
# Reachable, with patience.
#
# `db reset` restarts the containers, so for a few seconds afterwards Kong is
# listening and the service behind it is not: the probe gets a 502, or an
# empty reply, and a single attempt reads that as "no Supabase here". It then
# refused to cost a catalogue that had just been seeded perfectly well —
# twice, on a rebuild that was otherwise fine.
#
# Half a minute of retrying, which is longer than the restart has ever taken
# and short enough that a genuinely absent stack still fails quickly.
#
reachable() {
  local i
  for i in $(seq 1 10); do
    curl -fsS -o /dev/null --max-time 5 "$1/auth/v1/health" && return 0
    sleep 2
  done

  #
  # Kong keeps a dead upstream after `db reset`.
  #
  # The gateway does not restart with the services behind it, so it goes on
  # answering 502 for an auth container that has been healthy for minutes.
  # Waiting does not fix it — three rebuilds in a row seeded the whole
  # database correctly and then refused to cost it, each time reporting that
  # the stack was not running while every container was up.
  #
  # The CI workflow already restarts `realtime` after a reset for the same
  # class of reason. This is the other one.
  #
  echo "The API gateway is not answering. Restarting it…"
  docker restart "supabase_kong_$(grep -m1 '^project_id' "$ROOT/supabase/config.toml" | cut -d'\"' -f2)" >/dev/null 2>&1 || return 1
  for i in $(seq 1 15); do
    curl -fsS -o /dev/null --max-time 5 "$1/auth/v1/health" && return 0
    sleep 2
  done
  return 1
}

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
