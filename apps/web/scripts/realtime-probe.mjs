/**
 * Does the live catalogue channel actually work, and does it respect tenancy?
 *
 *   node apps/web/scripts/realtime-probe.mjs
 *
 * Realtime is the one path in this system that does not go through PostgREST,
 * so none of the database control suite covers it: a policy that holds for a
 * REST read and leaks over a websocket would be green in all 1.461 checks.
 * That is the whole reason this file exists rather than a paragraph in
 * PROGRESS.md.
 *
 * Three subscribers watch the same table while one row is changed:
 *
 *   a member of the venue        must receive the change, with the new value
 *   a member of another venue    must receive nothing at all
 *   a client that never signed in must receive no row content
 *
 * The third is not "nothing": Realtime sends the event's shape with an empty
 * body and `errors: ["Error 401: Unauthorized"]`. That residual signal is the
 * platform's, it carries no venue and no values, and it is asserted here so
 * that it stays that way rather than being rediscovered.
 *
 * ── The mistake this script is built around ────────────────────────────────
 *
 * The first attempt at realtime in this project was abandoned with "the
 * channel subscribes without error and delivers no events". It delivers. The
 * update being used to test it matched no rows — and an UPDATE that changes
 * nothing writes nothing to the WAL, so a working channel and a broken one
 * look identical. `_harness.sql` opens with this exact false pass. The row
 * count is therefore checked before any claim is made about the events.
 */
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";

const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const anonKey =
  process.env.SUPABASE_ANON_KEY ??
  (() => {
    try {
      const status = execSync("supabase status -o json", { encoding: "utf8" });
      return JSON.parse(status).ANON_KEY;
    } catch {
      return undefined;
    }
  })();
const email = process.env.CCOS_EMAIL ?? "demo@culinarycore.local";
const password = process.env.CCOS_PASSWORD ?? "demo-password-123";

if (!anonKey) {
  console.error("SUPABASE_ANON_KEY is required (or a running local stack).");
  process.exit(2);
}

const failures = [];
function check(ok, label, detail = "") {
  console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A client with its own socket, counting what arrives. */
function watcher(name) {
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const seen = [];
  const ready = () =>
    new Promise((resolve) => {
      client
        .channel(`probe-${name}-${Date.now()}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "products" },
          (payload) => seen.push(payload),
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") resolve();
        });
    });
  return { client, seen, ready };
}

const member = watcher("member");
await member.client.auth.signInWithPassword({ email, password });

/*
 * A fixed address, signed in to if it already exists.
 *
 * This used to sign up `realtime-probe+<timestamp>@…` on every run, and
 * signing up creates an organisation — so each run left another venue behind.
 * Harmless until the seed files have to decide which venue they mean, which
 * is exactly the defect this run found: on a laptop that had been probed
 * twice, "the oldest organisation" and "the one called Demo Kitchen" stopped
 * being the same place. One throwaway venue, reused, instead of one per run.
 */
const stranger = watcher("stranger");
const strangerEmail = "realtime-probe@test.local";
const strangerPassword = "realtime-probe-password-123";
{
  const { error: signInError } = await stranger.client.auth.signInWithPassword({
    email: strangerEmail, password: strangerPassword,
  });
  if (signInError) {
    const { error: signUpError } = await stranger.client.auth.signUp({
      email: strangerEmail, password: strangerPassword,
    });
    if (signUpError) {
      console.error(`could not create the other venue's user: ${signUpError.message}`);
      process.exit(2);
    }
  }
}

const signedOut = watcher("signed-out");

await Promise.all([member.ready(), stranger.ready(), signedOut.ready()]);

// Any product of the member's own venue. Read through the member's client, so
// the row is one their policies admit — picking one as postgres could choose
// another tenant's and make the member's own miss look like a leak prevented.
const { data: rows, error: readError } = await member.client
  .from("products")
  .select("id, name, buying_price_per_pack")
  .limit(1);
if (readError || !rows?.length) {
  console.error(`no product to change: ${readError?.message ?? "the catalogue is empty"}`);
  process.exit(2);
}
const subject = rows[0];
const newPrice = Math.round(Number(subject.buying_price_per_pack ?? 0)) + 7;

const { count, error: writeError } = await member.client
  .from("products")
  .update({ buying_price_per_pack: newPrice }, { count: "exact" })
  .eq("id", subject.id);

// Before anything is said about events. An update that matched nothing is the
// false pass this whole file is shaped around.
check(!writeError && count === 1, "the change under test actually changed a row",
  writeError?.message ?? `rows: ${count}`);
if (failures.length) process.exit(1);

await wait(6000);

const mine = member.seen.filter((p) => p.new?.id === subject.id);
check(mine.length > 0, "the member is told about their own venue's change");
check(
  mine.some((p) => Number(p.new?.buying_price_per_pack) === newPrice),
  "and the message carries the new value",
  mine.map((p) => p.new?.buying_price_per_pack).join(", "),
);

check(stranger.seen.length === 0,
  "a member of another venue is told nothing at all",
  `${stranger.seen.length} message(s)`);

const leaked = signedOut.seen.filter(
  (p) => Object.keys(p.new ?? {}).length > 0 || Object.keys(p.old ?? {}).length > 0,
);
check(leaked.length === 0,
  "a client that never signed in receives no row content",
  JSON.stringify(leaked[0] ?? {}));
check(
  signedOut.seen.every((p) => (p.errors ?? []).some((e) => /401/.test(e))),
  "and what it does receive is marked unauthorised",
  JSON.stringify(signedOut.seen[0] ?? {}),
);

// Put the price back, so running this twice does not drift the catalogue.
await member.client
  .from("products")
  .update({ buying_price_per_pack: subject.buying_price_per_pack })
  .eq("id", subject.id);

console.log();
if (failures.length === 0) {
  console.log("Realtime: 5 checks, all passing.");
  process.exit(0);
}
console.log(`Realtime: ${failures.length} FAILING.`);
process.exit(1);
