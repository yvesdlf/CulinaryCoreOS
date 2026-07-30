import { test as setup, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

const STATE = "tests/.auth/state.json";

/**
 * Sign in once and reuse the session across every test.
 *
 * RLS scopes all data to the caller's organisation, so an unauthenticated run
 * would screenshot empty tables and scan an empty page — passing while proving
 * nothing. Credentials are the seeded local demo account.
 */
setup("authenticate", async ({ page }) => {
  mkdirSync("tests/.auth", { recursive: true });

  await page.goto("/");
  await page.getByLabel("Email").fill("demo@culinarycore.local");
  await page.getByLabel("Password").fill("demo-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();

  // The sidebar only renders once a session exists.
  await expect(page.getByRole("link", { name: "Recipes", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await page.context().storageState({ path: STATE });
});
