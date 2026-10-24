import { test, expect } from "@playwright/test";

/**
 * The production bundle loads, under the production headers.
 *
 * Run against `scripts/serve-dist.mjs` (E2E_BASE_URL=http://localhost:4173).
 * It exists because the build once shipped a blank page — "Cannot read
 * properties of undefined (reading 'useState')" from two vendor chunks that
 * imported each other — and nothing failed: the other suites run the dev
 * server. A page error or a CSP violation fails this test.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test("the production build renders the sign-in page without errors", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (err) => problems.push(`page error: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error" && /Content Security Policy|Refused to/i.test(msg.text())) {
      problems.push(`csp: ${msg.text()}`);
    }
  });

  await page.goto("/");
  await expect(page.getByLabel("Email")).toBeVisible();
  expect(problems).toEqual([]);
});
