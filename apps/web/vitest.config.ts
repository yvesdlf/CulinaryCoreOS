import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Unit tests for the engines. Deliberately separate from Playwright: these are
 * pure functions, need no browser or database, and must stay fast enough to run
 * on every commit.
 */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
