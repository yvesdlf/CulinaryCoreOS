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
    /*
     * Vitest stubs CSS imports to an empty string by default, and does it by
     * file extension — so `index.css?raw` came back as "" and the token check
     * in `src/lib/css-tokens.test.ts` passed while comparing nothing against
     * nothing. Processing is on so the raw import is the file. There are no
     * Tailwind plugins in this config, so "processing" here is reading it.
     */
    css: true,
  },
});
