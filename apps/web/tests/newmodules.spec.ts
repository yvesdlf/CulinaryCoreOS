import { test, expect } from "@playwright/test";

/**
 * Maintenance and housekeeping render, and say what they are.
 *
 * Deliberately free of seeded rows. An earlier version of this file asserted
 * on a chiller and a room number that existed only because they had been typed
 * into one laptop's database by hand; in CI, against a database rebuilt from
 * empty, it would have failed for the wrong reason. What is worth asserting
 * here is that both pages mount, their tabs work, and neither logs an error —
 * the data is proved in SQL, where the rules actually live.
 */

const PAGES = [
  { path: "/maintenance", heading: "Maintenance", stat: "Statutory, late" },
  { path: "/housekeeping", heading: "Housekeeping", stat: "Sellable now" },
];

for (const p of PAGES) {
  test(`${p.heading} renders without console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(p.path);
    await expect(page.getByRole("heading", { name: p.heading, level: 1 })).toBeVisible();
    await expect(page.getByText(p.stat)).toBeVisible();

    // Every tab opens and leaves something on the page.
    const tabs = page.getByRole("tab");
    const count = await tabs.count();
    expect(count).toBeGreaterThan(3);
    // The outgoing panel lingers for its exit animation and is marked inert,
    // so two tabpanels match for a moment. The live one is the one that is not.
    for (let i = 0; i < count; i += 1) {
      await tabs.nth(i).click();
      await expect(page.locator("[role=tabpanel]:not([inert])")).toBeVisible();
    }

    expect(errors.filter((e) => !e.includes("favicon"))).toEqual([]);
  });
}

test("the two sections are reachable from the sidebar", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Maintenance", exact: true }).click();
  await expect(page).toHaveURL(/\/maintenance$/);
  await page.getByRole("link", { name: "Housekeeping", exact: true }).click();
  await expect(page).toHaveURL(/\/housekeeping$/);
});
