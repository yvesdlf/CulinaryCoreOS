#!/usr/bin/env bash
#
# Run (or regenerate) the visual baselines the way CI does: inside the pinned
# Playwright container, on Linux.
#
#   apps/web/scripts/visual-linux.sh            # check against the baselines
#   apps/web/scripts/visual-linux.sh --update   # regenerate them
#
# ── Why a container rather than just "run it on Linux" ─────────────────────
#
# Playwright names a snapshot `<test>-<project>-<platform>.png`, so a macOS
# baseline and a Linux one are different files and neither is wrong. That is
# the easy half. The hard half is that two Linux machines do not render text
# identically either: font packages, fontconfig defaults and the Chromium
# build all move the glyphs, and this suite is tuned to catch a change of
# 0,2% of the pixels. A baseline taken on one Ubuntu and checked on another
# is a coin toss.
#
# So the baselines are bound to an image rather than to an operating system,
# and CI runs the suite in the same image by the same command. The version is
# pinned here and asserted against the installed Playwright below, because a
# `pnpm update` that moves Playwright and leaves this behind would produce
# exactly the silent, unattributable diff the suite exists to prevent.
#
# ── Why the tree is copied rather than mounted ─────────────────────────────
#
# `node_modules` holds platform-specific binaries — esbuild, rollup, the
# Playwright browsers themselves. Bind-mounting the working tree would have
# the container install Linux binaries over the developer's macOS ones, and
# the next `pnpm dev` on the host would fail with an architecture error. So
# the container gets a clean `git archive` of HEAD and installs its own, and
# only the snapshot directory is copied back.
#
# This means it tests HEAD, not the working tree. Commit first. That is a
# limitation and it is the honest one: the baselines belong to a commit.
# ---------------------------------------------------------------------------

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB="$(cd "$HERE/.." && pwd)"
ROOT="$(cd "$WEB/../.." && pwd)"

PW_VERSION="1.62.0"
IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"
SNAPSHOTS="$WEB/tests/visual.spec.ts-snapshots"

# The one that bites: a Playwright upgrade with no baseline regeneration.
installed="$(cd "$WEB" && pnpm exec playwright --version | awk '{print $2}')"
if [ "$installed" != "$PW_VERSION" ]; then
  echo "Playwright is $installed and this script pins $PW_VERSION."
  echo "The baselines were rendered by $PW_VERSION's Chromium. Either pin the"
  echo "dependency back, or update PW_VERSION here *and* in .github/workflows/ci.yml,"
  echo "regenerate with --update, and look at the diff before committing it."
  exit 2
fi

update=""
[ "${1:-}" = "--update" ] && update="--update-snapshots"

# Where the container reaches the host's Supabase. On a Linux runner the
# container shares the host's network stack and localhost is the host; on
# macOS it does not, and Docker Desktop provides this name instead.
if [ "$(uname -s)" = "Linux" ]; then
  NET=(--network host)
  HOST_ADDR="127.0.0.1"
else
  NET=(--add-host=host.docker.internal:host-gateway)
  HOST_ADDR="host.docker.internal"
fi

# Taken from the running stack rather than assumed: the API port is 54321 by
# default and is not always free.
status="$(cd "$ROOT" && supabase status -o json)"
ANON="$(printf '%s' "$status" | sed -n 's/.*"ANON_KEY" *: *"\([^"]*\)".*/\1/p')"
PORT="$(docker port supabase_kong_culinarycoreos 8000/tcp 2>/dev/null | head -1 | sed 's/.*://')"
: "${PORT:=54321}"
if [ -z "$ANON" ]; then
  echo "No local Supabase. Run supabase/seed_local_demo.sh first — the"
  echo "baselines are screenshots of the database it builds."
  exit 2
fi

WORK="$(mktemp -d)"

#
# The container runs as root and installs `node_modules` into this directory,
# so on Linux the files come back owned by root and an ordinary `rm -rf`
# cannot remove them. That is not a theoretical tidiness problem: the trap ran
# under `set -e`, its failure became the step's exit code, and CI reported the
# visual suite as broken on a run where all 33 baselines had just matched.
# A green check that reports red is worse than no check — nobody reads the
# third one.
#
# So: try as this user, and if anything is left, delete it from inside a
# container, which is root. Either way the exit status is the one the tests
# produced.
#
cleanup() {
  local code=$?
  rm -rf "$WORK" 2>/dev/null || true
  if [ -d "$WORK" ]; then
    docker run --rm -v "$WORK:/work" "$IMAGE" \
      bash -c 'rm -rf /work/* /work/.[!.]* /work/..?* 2>/dev/null; true' >/dev/null 2>&1 || true
    rmdir "$WORK" 2>/dev/null || true
  fi
  exit $code
}
trap cleanup EXIT
echo "Copying HEAD into $WORK…"
(cd "$ROOT" && git archive HEAD) | tar -x -C "$WORK"

# The baselines come from the working tree, not from HEAD. Freshly generated
# ones are uncommitted by definition, and a check run that could not see them
# would report sixteen missing snapshots — which is what the first version of
# this script did. The *code* is still HEAD; that asymmetry is deliberate and
# is the reason the header says to commit first.
mkdir -p "$WORK/apps/web/tests/visual.spec.ts-snapshots"
cp "$SNAPSHOTS"/*.png "$WORK/apps/web/tests/visual.spec.ts-snapshots/" 2>/dev/null || true

RESULTS="$WEB/test-results"
mkdir -p "$RESULTS"

echo "Running the visual suite in $IMAGE…"
docker run --rm \
  "${NET[@]}" \
  -v "$WORK:/work" \
  -v "$SNAPSHOTS:/out" \
  -v "$RESULTS:/results" \
  -e CI=1 \
  -e "SUPA_URL=http://${HOST_ADDR}:${PORT}" \
  -e "SUPA_ANON=$ANON" \
  -e "UPDATE=$update" \
  -w /work \
  "$IMAGE" \
  bash -c '
    set -euo pipefail
    corepack enable >/dev/null 2>&1 || true
    pnpm install --frozen-lockfile --silent
    cd apps/web
    printf "VITE_SUPABASE_URL=%s\nVITE_SUPABASE_ANON_KEY=%s\n" "$SUPA_URL" "$SUPA_ANON" > .env.local
    set +e
    pnpm exec playwright test visual.spec.ts --project=desktop --project=ipad $UPDATE
    rc=$?
    set -e
    # Only when regenerating. A check run that copied the baselines back would
    # overwrite the committed files with bytes it had just agreed with, and
    # leave the working tree dirty for no reason — on CI, root-owned.
    if [ -n "$UPDATE" ]; then
      cp -v tests/visual.spec.ts-snapshots/*-linux.png /out/ 2>/dev/null || true
    fi
    # The diffs, which are the only useful thing about a red run and live in
    # a temporary directory that is about to be deleted.
    cp -r test-results/. /results/ 2>/dev/null || true
    exit $rc
  '

echo
if [ -n "$update" ]; then
  echo "Linux baselines written to $SNAPSHOTS"
else
  echo "Checked against the Linux baselines in $SNAPSHOTS"
fi
