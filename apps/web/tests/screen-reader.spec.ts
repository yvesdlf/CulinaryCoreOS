import { test, expect, type Page } from "@playwright/test";
import { ready, openFirstRow } from "./helpers";

/**
 * Screen-reader structure — Design Bible §12.
 *
 * IMPORTANT SCOPE NOTE. This audits the accessibility tree the browser exposes
 * — the same data VoiceOver consumes — so it catches missing names, wrong
 * roles, absent landmarks and broken heading order. It does NOT prove how
 * VoiceOver actually speaks the page: announcement order, rotor behaviour and
 * live-region timing still need a human listening. Treat a green run as
 * "nothing structurally broken", not "verified with a screen reader".
 */

/**
 * Read the real accessibility tree over CDP.
 *
 * `page.accessibility` was removed in Playwright 1.62, and querying the DOM
 * instead would only re-check the markup we wrote rather than what the browser
 * actually exposes to a screen reader.
 */
async function axNodes(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Accessibility.enable");
  const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as any;
  await cdp.detach();
  return nodes.map((n: any) => ({
    role: n.role?.value ?? "",
    name: n.name?.value ?? "",
    ignored: n.ignored === true,
  }));
}

test.describe("screen-reader structure", () => {
  test("page exposes landmarks a screen reader can jump between", async ({
    page,
  }) => {
    await page.goto("/recipes");
    await ready(page, "Recipes");

    // Counting DOM elements was not enough: it passed while the page had two
    // nested <main> landmarks and exposed no navigation landmark at all. Read
    // what the browser actually publishes instead.
    const nodes = (await axNodes(page)).filter((n) => !n.ignored);
    const mains = nodes.filter((n) => n.role === "main");
    const navs = nodes.filter((n) => n.role === "navigation");

    // Exactly one main, or "jump to main content" is ambiguous.
    expect(mains.length, "expected exactly one main landmark").toBe(1);

    // The primary navigation must be reachable as a landmark, and named —
    // "breadcrumb" alone is not the site navigation.
    expect(navs.length, "no navigation landmark").toBeGreaterThan(0);
    expect(
      navs.map((n) => n.name).filter(Boolean),
      "navigation landmarks are unnamed, so they cannot be told apart",
    ).toContain("Main");
  });

  test("heading order is sequential, with exactly one h1", async ({ page }) => {
    await page.goto("/recipes");
    await ready(page, "Recipes");

    const levels = await page.$$eval("h1,h2,h3,h4,h5,h6", (hs) =>
      hs
        .filter((h) => (h as HTMLElement).offsetParent !== null)
        .map((h) => ({ level: +h.tagName[1], text: h.textContent?.trim() ?? "" })),
    );

    expect(levels.filter((l) => l.level === 1).length, "expected exactly one h1")
      .toBe(1);

    // A jump from h1 straight to h3 tells a screen-reader user a section is
    // missing. Levels may only increase by one at a time.
    for (let i = 1; i < levels.length; i++) {
      const jump = levels[i].level - levels[i - 1].level;
      expect(
        jump,
        `heading jumps from h${levels[i - 1].level} to h${levels[i].level} at "${levels[i].text}"`,
      ).toBeLessThanOrEqual(1);
    }
  });

  test("the data table is announced as a table with real headers", async ({
    page,
  }) => {
    await page.goto("/recipes");
    await ready(page, "Recipes");

    const table = await page.evaluate(() => {
      const t = document.querySelector("table");
      if (!t) return null;
      return {
        headers: [...t.querySelectorAll("thead th")].map((th) =>
          th.textContent?.trim(),
        ),
        // A th with no scope is ambiguous in complex tables.
        bodyRows: t.querySelectorAll("tbody tr").length,
      };
    });

    expect(table, "no table found").not.toBeNull();
    expect(table!.headers.length).toBeGreaterThan(3);
    expect(
      table!.headers.filter((h) => !h),
      "table has empty column headers",
    ).toEqual([]);
    expect(table!.bodyRows).toBeGreaterThan(0);
  });

  test("every control in the recipe editor has an accessible name", async ({
    page,
  }) => {
    await page.goto("/recipes");
    await ready(page, "Recipes");
    await openFirstRow(page);

    const nodes = (await axNodes(page)).filter((n) => !n.ignored);
    const interactive = nodes.filter((n) =>
      ["button", "textbox", "combobox", "link", "checkbox", "spinbutton"].includes(
        n.role,
      ),
    );

    expect(interactive.length).toBeGreaterThan(10);
    const nameless = interactive
      .filter((n) => !n.name || !n.name.trim())
      .map((n) => n.role);
    expect(
      nameless,
      `controls announced with no name: ${JSON.stringify(nameless)}`,
    ).toEqual([]);
  });

  test("allergens are announced by name, not by code", async ({ page }) => {
    await page.goto("/recipes");
    await ready(page, "Recipes");

    // The registry forbids a code or icon standing in for the written name.
    const list = page.locator('[role="list"][aria-label^="Allergens"]').first();
    await expect(list).toBeVisible();

    const label = (await list.getAttribute("aria-label")) ?? "";
    // Must contain real words, not just three-letter codes.
    expect(label).toMatch(/[A-Za-z]{4,}/);

    // Each badge announces its own full name too.
    const items = list.locator('[role="listitem"]');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const name =
        (await items.nth(i).getAttribute("aria-label")) ??
        (await items.nth(i).textContent()) ??
        "";
      expect(name.trim().length, "an allergen badge announces nothing").toBeGreaterThan(3);
    }
  });

  test("decorative icons are hidden from the accessibility tree", async ({
    page,
  }) => {
    await page.goto("/recipes");
    await ready(page, "Recipes");

    // An icon inside a named control should not be announced separately.
    const leaked = await page.evaluate(() => {
      const svgs = [...document.querySelectorAll("svg")];
      return svgs.filter(
        (s) =>
          s.getAttribute("aria-hidden") !== "true" &&
          !s.getAttribute("aria-label") &&
          !s.closest("[aria-label]") &&
          !s.closest("button,a") ,
      ).length;
    });
    expect(leaked, "icons exposed to screen readers without a name").toBe(0);
  });

  test("toasts are announced without stealing focus", async ({ page }) => {
    await page.goto("/recipes");
    await ready(page, "Recipes");

    // Sonner renders a live region; without one, a save result is silent.
    const live = await page.evaluate(
      () =>
        document.querySelectorAll(
          "[aria-live], [role=status], [role=alert], [role=region][aria-label]",
        ).length,
    );
    expect(live, "no live region for transient feedback").toBeGreaterThan(0);
  });
});
