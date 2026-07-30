import { test, expect, type Page } from "@playwright/test";
import { ready, openFirstRow } from "./helpers";

/**
 * Keyboard operability — Design Bible §12.
 *
 * "Full keyboard operation, logical focus order, visible focus indicator, and
 * no keyboard trap." These are the checks a manual pass would perform, written
 * down so they run every time rather than once.
 *
 * What this does NOT cover: how VoiceOver actually speaks the page. That needs
 * a human with audio. The accessibility-tree suite is the closest proxy.
 */

/** Describe whatever currently has focus, the way a tester would note it. */
async function focused(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { tag: "BODY", name: "", visible: false };
    const name =
      el.getAttribute("aria-label") ||
      (el.textContent || "").trim().slice(0, 40) ||
      el.getAttribute("placeholder") ||
      "";
    const s = getComputedStyle(el);
    // A focus ring may come from outline or box-shadow depending on the token.
    const visible =
      (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) ||
      s.boxShadow !== "none";
    return { tag: el.tagName, role: el.getAttribute("role") || "", name, visible };
  });
}

async function tabTo(page: Page, times: number) {
  for (let i = 0; i < times; i++) await page.keyboard.press("Tab");
}

test.describe("keyboard operability", () => {
  test("every stop on the recipes page is reachable and shows focus", async ({
    page,
  }) => {
    await page.goto("/recipes");
    await ready(page, "Recipes");
    await page.locator("body").click({ position: { x: 2, y: 2 } });

    const stops: Awaited<ReturnType<typeof focused>>[] = [];
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      const f = await focused(page);
      if (f.tag === "BODY") break;
      stops.push(f);
    }

    // Something must be reachable at all.
    expect(stops.length).toBeGreaterThan(5);

    // Every interactive stop must show a focus indicator (§12).
    const invisible = stops.filter((s) => !s.visible);
    expect(
      invisible,
      `stops without a visible focus indicator: ${JSON.stringify(invisible)}`,
    ).toEqual([]);

    // Nothing focusable may be nameless — a screen reader would announce
    // "button" with no indication of what it does.
    const nameless = stops.filter((s) => !s.name && s.tag !== "INPUT");
    expect(
      nameless,
      `focusable elements with no accessible name: ${JSON.stringify(nameless)}`,
    ).toEqual([]);
  });

  test("command palette opens, navigates and returns focus", async ({ page }) => {
    await page.goto("/recipes");
    await ready(page, "Recipes");

    const trigger = page.getByRole("button", { name: /Search/i }).first();
    await trigger.focus();
    await page.keyboard.press("ControlOrMeta+k");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Arrow keys must move through results without the mouse.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");

    // Escape must close it (§7 Dialog).
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // And focus must come back to the control that opened it, not to body.
    const after = await focused(page);
    expect(after.tag).not.toBe("BODY");
  });

  test("ingredient autocomplete is fully keyboard operable", async ({ page }) => {
    await page.goto("/recipes");
    await ready(page, "Recipes");
    await openFirstRow(page);

    const add = page.getByRole("button", { name: /Add ingredient/i });
    await add.focus();
    expect((await focused(page)).visible).toBe(true);

    await page.keyboard.press("Enter");
    const search = page.getByPlaceholder(/Search products/i);
    await expect(search).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(search).toBeHidden();
    const after = await focused(page);
    expect(after.tag).not.toBe("BODY");
  });

  test("no keyboard trap in the recipe editor", async ({ page }) => {
    await page.goto("/recipes");
    await ready(page, "Recipes");
    await openFirstRow(page);

    // Tab well past the number of controls; if focus is trapped, the same
    // element keeps coming back and the set of names stays tiny.
    const seen = new Set<string>();
    for (let i = 0; i < 45; i++) {
      await page.keyboard.press("Tab");
      const f = await focused(page);
      seen.add(`${f.tag}:${f.role}:${f.name}`);
    }
    expect(seen.size, "focus appears trapped in a small cycle").toBeGreaterThan(8);
  });

  test("a select is operable without a mouse", async ({ page }) => {
    await page.goto("/recipes");
    await ready(page, "Recipes");

    const category = page.getByRole("combobox", { name: /Filter by category/i });
    await category.focus();
    expect((await focused(page)).visible).toBe(true);

    await page.keyboard.press("Enter");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toBeHidden();
  });

  test("sign-in can be completed with the keyboard alone", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByLabel("Email")).toBeVisible({ timeout: 15_000 });

    await page.locator("body").click({ position: { x: 2, y: 2 } });
    await tabTo(page, 1);
    await page.keyboard.type("demo@culinarycore.local");
    await tabTo(page, 1);
    await page.keyboard.type("demo-password-123");
    await page.keyboard.press("Enter"); // submit without reaching for the button

    await expect(
      page.getByRole("link", { name: "Recipes", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
