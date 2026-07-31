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
  return new AxeBuilder({ page }).withTags(TAGS);
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
