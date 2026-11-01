// ---------------------------------------------------------------------------
// Mock catalogue banner
// ---------------------------------------------------------------------------
// Shown on every screen whenever the application is running without a
// database.
//
// With `VITE_SUPABASE_*` unset the app falls back to its in-memory catalogue
// and `access-store` reports WRITE on every section, so the interface looks
// fully functional: buttons enable, figures render, saves appear to succeed
// and nothing is written. `vite.config.ts` refuses to produce a Vercel
// production build in that state, and CI asserts that it refuses — but a
// `pnpm dev`, a preview deploy and anything built outside that one path can
// still reach a browser.
//
// Which is fine, as long as nobody reads a food cost off it and reorders
// against the number. That is what this is for. It is deliberately not
// dismissible: if the figures on screen are invented, the screen should keep
// saying so.
//
// Design Bible §4 and §12 forbid meaning carried by colour, so the banner
// states the situation in words and the icon is decorative.
// ---------------------------------------------------------------------------

import { Database } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase";

export function MockDataBanner() {
  if (isSupabaseConfigured) return null;

  return (
    <div
      // `alert` rather than `status`, on the same reasoning as the allergen
      // notice: "none of this is real" is not ambient information, and a
      // screen-reader user should not have to go looking for it.
      role="alert"
      className="flex items-start gap-3 border-b border-status-warning-border bg-status-warning-soft px-6 py-2.5"
    >
      <Database
        className="mt-0.5 size-4 shrink-0 text-status-warning"
        aria-hidden="true"
      />
      <p className="text-xs text-foreground/80">
        <span className="font-medium text-status-warning">
          Sample data — nothing here is saved.
        </span>{" "}
        No database is configured, so this is a demonstration catalogue. Every
        section reports full access and every save is discarded. Do not order,
        cost or report against these figures. Set{" "}
        <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[0.7rem]">
          VITE_SUPABASE_URL
        </code>{" "}
        and{" "}
        <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[0.7rem]">
          VITE_SUPABASE_ANON_KEY
        </code>{" "}
        to connect a real one.
      </p>
    </div>
  );
}
