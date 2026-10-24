#!/usr/bin/env bash
#
# Run the database control suite.
#
#   supabase/tests/run.sh [connection-string]
#
# Defaults to the local stack. Expects a database that has just been rebuilt
# (`supabase db reset`), though the fixtures clean up after themselves so it
# can be run twice.
#
# Why the exit code is computed by counting rather than from psql: psql
# prefixes errors with "file:line:", so grepping for '^ERROR' matches nothing,
# and ON_ERROR_STOP would abort on the first *expected* refusal. Every
# assertion returns a row beginning "pass" or "FAIL"; this counts the FAILs.

set -uo pipefail

DB="${1:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The fixtures write a test venue and the teardown deletes recipes, products and
# stock history by name pattern (`T-%`). Against a real venue that deletes its
# "T-Bone Steak" and everything hanging off it. DEPLOY.md once told people to
# run this against the hosted database, so the refusal lives here rather than
# in the documentation. A staging project or a restored copy can opt in.
host="$(printf '%s' "$DB" | sed -E 's#^[a-z]+://([^@/]*@)?(\[([^]]+)\]|([^:/?]+)).*#\3\4#')"
# libpq also takes the host from the query string (`?host=`, `?hostaddr=`),
# which overrides the authority part — so a URL that says localhost can still
# point elsewhere. Such a URL is treated as remote.
case "$DB" in
  *[?\&]host=*|*[?\&]hostaddr=*) host="(set in the query string)" ;;
esac
case "$host" in
  127.0.0.1|localhost|::1) ;;
  *)
    if [ "${CCOS_ALLOW_REMOTE_TESTS:-}" != "1" ]; then
      echo "Refusing to run against $host: the suite writes and deletes rows."
      echo "Only ever point it at a local stack, a staging project or a restored"
      echo "copy — never production. For staging: CCOS_ALLOW_REMOTE_TESTS=1 $0 <url>"
      exit 2
    fi
    ;;
esac

run() { psql "$DB" -X -q -t -A -f "$1" 2>&1; }

echo "Database controls"
echo "────────────────────────────────────────────────────────────"

setup="$(run "$HERE/_harness.sql"; run "$HERE/_fixtures.sql")"
problems="$(printf '%s\n' "$setup" | grep -E '^FAIL|ERROR' || true)"
if [ -n "$problems" ]; then
  echo "Fixtures did not load:"
  printf '%s\n' "$problems"
  echo
  echo "Refusing to run assertions against a half-built fixture — that is how"
  echo "a suite reports a screen of passes it never executed."
  exit 1
fi

total=0
failed=0
for f in "$HERE"/[0-9]*.sql; do
  out="$(run "$f")"
  printf '%s\n' "$out" | grep -E '^(pass|FAIL|──)' || true
  n_pass=$(printf '%s\n' "$out" | grep -c '^pass' || true)
  n_fail=$(printf '%s\n' "$out" | grep -c '^FAIL' || true)
  # A file that produced no assertions is a file that did not run.
  if [ "$((n_pass + n_fail))" -eq 0 ]; then
    echo "FAIL  $(basename "$f") produced no assertions at all"
    printf '%s\n' "$out" | tail -3
    failed=$((failed + 1))
  # And a file that errored outside an assertion stopped part-way: inside its
  # transaction every later statement is ignored, prints nothing, and the
  # count simply comes out lower. Expected refusals are caught inside the
  # t.expect_* functions and never reach psql, so any ERROR here is real.
  # This is how 82 assertions once vanished behind "515 checks, all passing".
  elif printf '%s\n' "$out" | grep -q 'ERROR:'; then
    echo "FAIL  $(basename "$f") hit an error outside an assertion and stopped:"
    printf '%s\n' "$out" | grep -m1 'ERROR:'
    failed=$((failed + 1))
  fi
  total=$((total + n_pass + n_fail))
  failed=$((failed + n_fail))
  echo
done

# The venue the fixtures built outlives the files that used it, so it is taken
# down here rather than only before the next run. Seven visual tests went red
# once because a T- recipe was still sitting in the seeded venue afterwards;
# the screenshots were right and the database was dirty.
#
# Run whatever happened above, including a failure, so a red run does not leave
# a mess for whatever looks at the database next. Its own output is shown only
# when it has something to say.
teardown="$(run "$HERE/_teardown.sql" | grep -E '^(FAIL|ERROR)' || true)"
if [ -n "$teardown" ]; then
  echo "Teardown did not finish cleanly — the test venue is still in the database:"
  printf '%s\n' "$teardown"
  echo
  failed=$((failed + 1))
fi

echo "────────────────────────────────────────────────────────────"
if [ "$failed" -eq 0 ]; then
  echo "$total checks, all passing."
  exit 0
fi
echo "$total checks, $failed FAILING."
exit 1
