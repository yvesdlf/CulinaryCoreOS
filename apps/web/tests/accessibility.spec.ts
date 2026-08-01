import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ready, setTheme, openFirstRow } from "./helpers";

/**
 * Accessibility — Design Bible §12, targeting WCAG 2.2 AA.
 *
 * Automated scanning catches roughly a third of real barriers, so this is a
 * floor rather than a pass mark; §12's checklist still needs a manual keyboard
 * and screen-reader pass. Both themes are scanned because contrast is the most
 * common failure and the two themes have independent colour values.
 */

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

function scanner(page: import("@playwright/test").Page) {
  return (
    new AxeBuilder({ page })
      .withTags(TAGS)
      /*
       * Base UI injects 1x1 focus-guard sentinels around a dialog —
       * `<span role="button" data-base-ui-inert>` with no accessible name.
       * They are the library's own focus-trap machinery, not our markup, and
       * they are marked inert precisely so nothing treats them as controls.
       *
       * Excluded by that attribute alone, so it cannot quietly widen: anything
       * else nameless still fails, which is how the unlabelled selects on the
       * product editor were caught.
       */
      .exclude("[data-base-ui-focus-guard]")
  );
}

const PAGES = [
  { name: "recipes list", path: "/recipes", heading: "Recipes" },
  { name: "sub-recipes list", path: "/sub-recipes", heading: "Sub Recipes" },
  { name: "products list", path: "/products", heading: "Products" },
  { name: "allergen matrix", path: "/allergen-matrix", heading: "Allergen matrix" },
  { name: "dashboard", path: "/", heading: "Dashboard" },
];

for (const p of PAGES) {
  for (const theme of ["light", "dark"] as const) {
    test(`${p.name} has no WCAG AA violations — ${theme}`, async ({ page }) => {
      await page.goto(p.path);
      await ready(page, p.heading);
      await setTheme(page, theme);

      const results = await scanner(page).analyze();
      // Print the detail before asserting; a bare count is not actionable.
      if (results.violations.length) {
        console.log(
          `\n${p.name} (${theme}):\n` +
            results.violations
              .map(
                (v) =>
                  `  [${v.impact}] ${v.id}: ${v.help}\n` +
                  v.nodes.slice(0, 3).map((n) => `      ${n.target}`).join("\n"),
              )
              .join("\n"),
        );
      }
      expect(results.violations).toEqual([]);
    });
  }
}

test("recipe editor has no WCAG AA violations", async ({ page }) => {
  await page.goto("/recipes");
  await ready(page, "Recipes");
  await openFirstRow(page);
  await expect(page.getByText("Cost Summary")).toBeVisible();

  const results = await scanner(page).analyze();
  if (results.violations.length) {
    console.log(
      "\nrecipe editor:\n" +
        results.violations
          .map((v) => `  [${v.impact}] ${v.id}: ${v.help}`)
          .join("\n"),
    );
  }
  expect(results.violations).toEqual([]);
});

/**
 * The product editor carries the most recently added interactive UI — the
 * price simulation, the where-used panel and the allergen verification
 * control — and had never been scanned. Editors are where people spend their
 * time; scanning only the lists checks the easy half.
 */
test("product editor has no WCAG AA violations", async ({ page }) => {
  await page.goto("/products");
  await ready(page, "Products");
  await openFirstRow(page);
  await expect(page.getByText("If this price changes")).toBeVisible();

  const results = await scanner(page).analyze();
  if (results.violations.length) {
    console.log(
      "\nproduct editor:\n" +
        results.violations
          .map((v) => `  [${v.impact}] ${v.id}: ${v.help}`)
          .join("\n"),
    );
  }
  expect(results.violations).toEqual([]);
});

/**
 * The import preview is the last thing between a file and a thousand rewritten
 * prices, so it has to be readable by whoever is checking it. Driven with a
 * real file rather than a mocked state — an empty preview would pass while
 * proving nothing.
 */
test("price import preview has no WCAG AA violations", async ({ page }) => {
  await page.goto("/products");
  await ready(page, "Products");

  await page.setInputFiles(
    'input[type="file"]',
    {
      name: "supplier-list.csv",
      mimeType: "text/csv",
      // One row that applies, one that cannot, so both halves of the preview
      // render — the table and the problem list.
      buffer: Buffer.from(
        '"Name","Unit cost"\r\n"Guanciale","649000.57"\r\n"Not A Real Ingredient","1000"',
      ),
    },
  );

  await expect(page.getByText(/nothing has been changed yet/)).toBeVisible();
  await expect(page.getByText(/will not be applied/)).toBeVisible();

  const results = await scanner(page).analyze();
  if (results.violations.length) {
    console.log(
      "\nprice import preview:\n" +
        results.violations
          .map((v) => `  [${v.impact}] ${v.id}: ${v.help}`)
          .join("\n"),
    );
  }
  expect(results.violations).toEqual([]);
});

/**
 * Command palette. It searches 1.300 entities now, and a search whose results
 * a screen reader cannot follow is a search only some people have.
 */
test("command palette results have no WCAG AA violations", async ({ page }) => {
  await page.goto("/recipes");
  await ready(page, "Recipes");

  await page.keyboard.press("ControlOrMeta+k");
  const input = page.getByPlaceholder(/Search dishes/i);
  await expect(input).toBeVisible();
  await input.fill("wagyu");
  await expect(page.getByRole("option").first()).toBeVisible();

  const results = await scanner(page).analyze();
  if (results.violations.length) {
    console.log(
      "\ncommand palette:\n" +
        results.violations
          .map((v) => `  [${v.impact}] ${v.id}: ${v.help}`)
          .join("\n"),
    );
  }
  expect(results.violations).toEqual([]);
});

test("sign-in page has no WCAG AA violations", async ({ page, context }) => {
  // The one screen an unauthenticated user sees, so it is scanned signed out.
  await context.clearCookies();
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByLabel("Email")).toBeVisible({ timeout: 15_000 });

  const results = await scanner(page).analyze();
  if (results.violations.length) {
    console.log(
      "\nsign-in:\n" +
        results.violations
          .map((v) => `  [${v.impact}] ${v.id}: ${v.help}`)
          .join("\n"),
    );
  }
  expect(results.violations).toEqual([]);
});

test("allergen badges expose full names, not codes alone", async ({ page }) => {
  // The registry forbids a code or icon standing in for the written allergen
  // name. That is a correctness rule axe cannot know about, so it is asserted
  // directly: the accessible name must carry the words.
  await page.goto("/recipes");
  await ready(page, "Recipes");

  const list = page.locator('[role="list"][aria-label^="Allergens"]').first();
  await expect(list).toBeVisible();
  const label = await list.getAttribute("aria-label");
  expect(label).toMatch(/Allergens: .*[A-Za-z]{4,}/);
  // A three-letter code alone would fail this: it needs real words.
  expect(label).not.toMatch(/^Allergens: (?:[A-Z]{3}, ?)*[A-Z]{3}$/);
});
