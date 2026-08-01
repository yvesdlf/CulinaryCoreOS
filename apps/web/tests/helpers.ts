import { type Page, expect } from "@playwright/test";

/**
 * Stop CSS transitions, so what is measured is a settled state.
 *
 * Badges carry `transition-all`, so flipping the theme animates their colours
 * over ~150ms. An axe scan starting inside that window measures a blend of the
 * two themes — #51986a, which exists in neither — and reports a contrast
 * failure that no user could ever see. It failed about one run in three, which
 * is the worst possible frequency: often enough to be noise, rare enough to be
 * dismissed.
 *
 * Injected rather than slept through, so the suites stay deterministic instead
 * of racing a duration someone may later change.
 */
async function freezeMotion(page: Page) {
  await page.addStyleTag({
    content: `*, *::before, *::after {
      transition-duration: 0s !important;
      transition-delay: 0s !important;
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      scroll-behavior: auto !important;
    }`,
  });
}

/**
 * Wait until the document stops growing.
 *
 * Full-page screenshots capture the whole scroll height, so a shot taken while
 * rows are still arriving is a different size from the baseline — the allergen
 * matrix came out 900px instead of 1.266px roughly one run in three. Waiting
 * for the first row is not enough when there are 115 of them.
 */
async function heightSettled(page: Page) {
  let last = -1;
  for (let i = 0; i < 30; i++) {
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    if (h === last) return;
    last = h;
    await page.waitForTimeout(100);
  }
}

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
  await freezeMotion(page);
  await heightSettled(page);
}

/**
 * Switch themes — the Bible treats dark as a full theme, so both are shot.
 *
 * Toggling the class and sleeping 150ms was unreliable — roughly one run in
 * three differed by 40% of its pixels. This writes the key the app itself
 * reads and then asserts the class actually stuck, so the theme is known to be
 * applied rather than assumed.
 *
 * `colorScheme` is set alongside the class, never on its own: setting it alone
 * darkens the browser's own canvas while the app's tokens stay light, which
 * produces light-grey text on a dark background and a page-full of contrast
 * failures that exist in no real theme.
 */
export async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => {
    // The key the app itself reads, so a navigation cannot undo this.
    localStorage.setItem("ccos-theme", t);
    document.documentElement.classList.toggle("dark", t === "dark");
    document.documentElement.style.colorScheme = t;
  }, theme);

  await expect
    .poll(
      () =>
        page.evaluate(() => document.documentElement.classList.contains("dark")),
      { timeout: 5_000 },
    )
    .toBe(theme === "dark");

  // Re-applied because a navigation drops the injected style.
  await freezeMotion(page);
  await heightSettled(page);
}

/** Open the first row of a list and wait for its editor. */
export async function openFirstRow(page: Page) {
  await page.locator("tbody tr").first().click();
  await page.waitForLoadState("networkidle");
  await freezeMotion(page);
  await heightSettled(page);
}
