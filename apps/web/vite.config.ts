import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
          return "vendor";
        },
      },
    },
  },
});
