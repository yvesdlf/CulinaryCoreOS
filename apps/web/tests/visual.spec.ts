import { test, expect } from "@playwright/test";
import { ready, setTheme, openFirstRow } from "./helpers";

/**
 * Visual regression — Design Bible §15.
 *
 * Every screen is shot in light and dark, because the token work means a
 * regression is far more likely to appear in one theme than both. The suite
 * guards the surfaces where a silent visual break would be costly: the costing
 * panels and the allergen badges.
 */

const SCREENS = [
  { name: "recipes-list", path: "/recipes", heading: "Recipes" },
  { name: "sub-recipes-list", path: "/sub-recipes", heading: "Sub Recipes" },
  { name: "products-list", path: "/products", heading: "Products" },
  { name: "dashboard", path: "/", heading: "Dashboard" },
];

for (const screen of SCREENS) {
  for (const theme of ["light", "dark"] as const) {
    test(`${screen.name} — ${theme}`, async ({ page }) => {
      await page.goto(screen.path);
      await ready(page, screen.heading);
      await setTheme(page, theme);
      await expect(page).toHaveScreenshot(`${screen.name}-${theme}.png`, {
        fullPage: true,
      });
    });
  }
}

test.describe("editors", () => {
  test("recipe editor — light", async ({ page }) => {
    await page.goto("/recipes");
    await ready(page, "Recipes");
    await openFirstRow(page);
    await expect(page.getByText("Cost Summary")).toBeVisible();
    await expect(page).toHaveScreenshot("recipe-editor-light.png", {
      fullPage: true,
    });
  });

  test("recipe editor — dark", async ({ page }) => {
    await page.goto("/recipes");
    await ready(page, "Recipes");
    await openFirstRow(page);
    await expect(page.getByText("Cost Summary")).toBeVisible();
    await setTheme(page, "dark");
    await expect(page).toHaveScreenshot("recipe-editor-dark.png", {
      fullPage: true,
    });
  });

  test("sub-recipe editor — light", async ({ page }) => {
    await page.goto("/sub-recipes");
    await ready(page, "Sub Recipes");
    await openFirstRow(page);
    await expect(page.getByText("Batch Cost")).toBeVisible();
    await expect(page).toHaveScreenshot("sub-recipe-editor-light.png", {
      fullPage: true,
    });
  });
});

test.describe("components in isolation", () => {
  /**
   * The allergen row and cost summary are shot on their own so a change to
   * either is attributable, rather than hiding inside a full-page diff.
   */
  test("allergen badges", async ({ page }) => {
    await page.goto("/recipes");
    await ready(page, "Recipes");
    const cell = page.locator("tbody tr").first().locator("td").nth(3);
    await expect(cell).toHaveScreenshot("allergen-badges.png");
  });

  test("cost summary panel", async ({ page }) => {
    await page.goto("/recipes");
    await ready(page, "Recipes");
    await openFirstRow(page);
    const panel = page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Cost Summary" });
    await expect(panel).toHaveScreenshot("cost-summary.png");
  });

  test("focus ring is visible on the primary action", async ({ page }) => {
    // §12 requires a visible focus indicator; a token change could remove it
    // without any other screen looking different.
    await page.goto("/recipes");
    await ready(page, "Recipes");
    // Base UI renders this as an <a> exposed with role="button", so it is
    // matched by role button rather than link.
    const create = page.getByRole("button", { name: /New Recipe/i });
    await create.focus();
    await expect(create).toHaveScreenshot("focus-primary-action.png");
  });
});
