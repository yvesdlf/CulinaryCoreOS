import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config — visual regression and accessibility (Design Bible §15).
 *
 * The suite runs against the dev server with a live local Supabase, because
 * the screens worth guarding are the costed ones: an allergen badge or a food
 * cost band with no data behind it proves nothing.
 */
export default defineConfig({
  testDir: "./tests",
  // Screenshot diffing is comparing rendered pixels, so parallel workers on a
  // loaded machine produce flaky anti-aliasing differences. One worker.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : [["list"]],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  expect: {
    toHaveScreenshot: {
      // `threshold` is per-pixel colour sensitivity in YIQ space. The default
      // of 0.2 is permissive enough to miss a whole-page colour change —
      // reverting the ivory ground to pure white passed at 0.2 AND at 0.05,
      // because #f8f7f4 and #ffffff are only a few points apart. 0.02 was
      // established empirically as the value that catches it.
      threshold: 0.02,
      /*
       * Font hinting and sub-pixel AA still differ slightly between runs, so a
       * small share of differing pixels is tolerated.
       *
       * This was 0.01 and the comment beside it said "a real change moves far
       * more than this". That is not true of a sparse change. Adding a whole
       * navigation item to the sidebar — which shifts four labels and their
       * icons down a row — passed at 0.01 on every screen, because the pixels
       * that actually differ are the glyphs, and four lines of text on a
       * nine-hundred-thousand-pixel page is well under one per cent of it. The
       * suite was guarding the colour of the page and not its contents.
       *
       * 0.002 catches it. Verified stable: the full suite run twice in a row
       * at this value is green both times, so it is not trading a missed
       * regression for a flaky one.
       */
      maxDiffPixelRatio: 0.002,
      animations: "disabled",
      caret: "hide",
    },
  },

  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 }, // Bible §5 large desktop
        storageState: "tests/.auth/state.json",
      },
    },
    {
      name: "ipad",
      dependencies: ["setup"],
      use: {
        ...devices["iPad (gen 7) landscape"],
        storageState: "tests/.auth/state.json",
      },
    },
  ],

  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: "pnpm dev",
        url: "http://localhost:5173",
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
