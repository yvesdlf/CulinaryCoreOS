// ---------------------------------------------------------------------------
// A colleague's change, while you are looking at it
// ---------------------------------------------------------------------------
// The client half of 0127. `realtime-probe.mjs` proves the channel delivers
// and respects tenancy; this proves the app does something with it — that a
// change made by a second session reaches a screen already open, without a
// reload and without anybody pressing anything.
//
// It is an end-to-end test because there is no smaller honest one. The chain
// is a Postgres publication, a websocket, a debounce, a REST re-read and a
// store swap, and a mock of any link in it would assert the mock.
//
// ── Two false signals this test is shaped around ───────────────────────────
//
// **A write that changes no row.** The first attempt at realtime in this
// project was abandoned on the strength of a test whose UPDATE matched
// nothing — and nothing in the WAL looks exactly like a broken channel. The
// row count is asserted before any claim is made about the screen.
//
// **A row that leaves the page.** The second attempt here renamed a product
// to `T-live …`, which re-sorted it out of an alphabetically ordered,
// paginated list and out of the DOM. The screen was right and the test was
// looking in the wrong place. The new name is therefore the old name with a
// suffix, so the row keeps its position.
// ---------------------------------------------------------------------------

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { ready } from "./helpers";

const URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.CCOS_EMAIL ?? "demo@culinarycore.local";
const PASSWORD = process.env.CCOS_PASSWORD ?? "demo-password-123";

/*
 * The debounce is 1,5s and the re-read is a catalogue, so this is generous on
 * purpose: the question is whether it arrives at all, and a tight bound would
 * turn a slow runner into a failing feature.
 */
const ARRIVES_WITHIN = 15_000;

const configured = Boolean(URL && ANON);

test.describe("the live catalogue", () => {
  /*
   * Skipped on a laptop with no stack, and never skipped in CI. A test that
   * quietly does not run is the failure this repository has paid for most —
   * 82 assertions once vanished behind a green summary — so the variables
   * being absent on a runner is a failure of the workflow, not a reason to
   * pass.
   */
  test.skip(!configured && !process.env.CI,
    "needs a local stack: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set");

  test("a colleague's edit reaches an open screen without a reload", async ({ page }) => {
    expect(configured,
      "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set for this test").toBe(true);

    const colleague = createClient(URL!, ANON!, { auth: { persistSession: false } });
    const { error: signInError } = await colleague.auth.signInWithPassword({
      email: EMAIL, password: PASSWORD,
    });
    expect(signInError, "the second session could not sign in").toBeNull();

    const { data: rows, error: readError } = await colleague
      .from("products").select("id, name").order("name").limit(1);
    expect(readError).toBeNull();
    expect(rows?.length, "the catalogue is empty, so there is nothing to change").toBe(1);
    const subject = rows![0];
    const renamed = `${subject.name} ✓`;

    let reloads = 0;
    page.on("load", () => { reloads += 1; });

    await page.goto("/products");
    await ready(page, "Products");
    await expect(page.getByText(subject.name, { exact: true })).toBeVisible();
    const loadsBefore = reloads;

    try {
      const { count, error: writeError } = await colleague
        .from("products")
        .update({ name: renamed }, { count: "exact" })
        .eq("id", subject.id);
      expect(writeError).toBeNull();
      // Before anything is said about the screen.
      expect(count, "the change under test changed no row").toBe(1);

      await expect(page.getByText(renamed, { exact: true }))
        .toBeVisible({ timeout: ARRIVES_WITHIN });
      expect(reloads, "it only arrived because the page reloaded").toBe(loadsBefore);
    } finally {
      // The visual baselines are screenshots of this catalogue.
      await colleague.from("products").update({ name: subject.name }).eq("id", subject.id);
    }
  });
});
