import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

/*
 * A production deploy without a database fails the build.
 *
 * With VITE_SUPABASE_* missing the app falls back to its mock catalogue and
 * reports WRITE on every section: it looks healthy and saves nothing. DEPLOY.md
 * called that "the failure mode to watch for"; this makes it a red build
 * instead. Only for Vercel production, so CI and local builds — which build
 * without a project on purpose — are unaffected.
 */
function requireDatabaseInProduction(): Plugin {
  return {
    name: "require-database-in-production",
    config(_config, { mode }) {
      if (process.env.VERCEL_ENV !== "production") return;
      const env = loadEnv(mode, __dirname, "VITE_");
      const missing = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]
        .filter((k) => !(env[k] ?? process.env[k]));
      if (missing.length > 0) {
        throw new Error(
          `Production build without ${missing.join(" and ")}: the app would run on its ` +
          "mock catalogue and save nothing. Set them in the Vercel project (DEPLOY.md §3).",
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [requireDatabaseInProduction(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        /*
         * Vendor code in its own chunks.
         *
         * These change when a dependency is upgraded — a few times a year —
         * while the app changes daily. Kept together they were re-downloaded
         * on every deploy; split, a release invalidates only the app chunk.
         */
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("react-dom") || id.includes("/react/") || id.includes("scheduler")) {
            return "vendor-react";
          }
          if (id.includes("@supabase") || id.includes("postgrest") || id.includes("realtime-js")) {
            return "vendor-supabase";
          }
          // Base UI, cmdk and the icon set: the interface toolkit.
          if (id.includes("@base-ui") || id.includes("cmdk") || id.includes("lucide")) {
            return "vendor-ui";
          }
          /*
           * Everything else is left to Rollup. A catch-all "vendor" chunk
           * here once made the production build import itself in a circle:
           * vendor-react needed a CommonJS helper Rollup had put in vendor,
           * vendor needed React, and whichever ran first found the other
           * undefined. The page was blank with "Cannot read properties of
           * undefined (reading 'useState')" — and the build, and every check
           * that only builds, still passed.
           */
          return undefined;
        },
      },
    },
  },
});
