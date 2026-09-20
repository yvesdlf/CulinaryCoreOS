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
  fi
  total=$((total + n_pass + n_fail))
  failed=$((failed + n_fail))
  echo
done

echo "────────────────────────────────────────────────────────────"
if [ "$failed" -eq 0 ]; then
  echo "$total checks, all passing."
  exit 0
fi
echo "$total checks, $failed FAILING."
exit 1
