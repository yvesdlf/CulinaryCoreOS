import { type Page, expect } from "@playwright/test";

/**
 * Wait until the page has settled enough to photograph.
 *
 * Data arrives after hydration, so screenshotting on load captures a skeleton
 * and produces a snapshot that passes while showing nothing.
 */
export async function ready(page: Page, marker: string) {
  await expect(page.getByRole("heading", { name: marker })).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForLoadState("networkidle");
}

/** Switch themes — the Bible treats dark as a full theme, so both are shot. */
export async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle("dark", t === "dark");
  }, theme);
  await page.waitForTimeout(150);
}

/** Open the first row of a list and wait for its editor. */
export async function openFirstRow(page: Page) {
  await page.locator("tbody tr").first().click();
  await page.waitForLoadState("networkidle");
}
