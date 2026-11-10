// ---------------------------------------------------------------------------
// A colleague's change, while you are looking at it
// ---------------------------------------------------------------------------
// The other half of 0127. The database publishes `products`, `recipes` and
// `sub_recipes`; this subscribes, and when something lands it re-reads the
// catalogue through the path that already exists.
//
// ── Why a ping and not a patch ─────────────────────────────────────────────
//
// The obvious design is to take the row out of the event and put it into the
// store. It is also where this would go wrong. A product row arriving from
// the WAL is the product, not the costed view the stores hold: the cascade
// derives sub-recipe and recipe figures from it, `recalculateAll` is the only
// implementation of those rules, and merging a raw row would leave the
// catalogue internally inconsistent in a way no screen would show.
//
// So the event is treated as a *signal*, and `refreshCatalogue()` — already
// written, already used by the focus refresh, already careful not to put the
// status back to "loading" and unmount a form somebody is typing into —
// remains the only way data enters the stores. The socket says "something
// changed"; REST still says what.
//
// ── Why an open editor is safe ─────────────────────────────────────────────
//
// Checked rather than assumed. The detail pages seed their form state with a
// lazy `useState` initialiser, which runs on mount and never again, so a
// refresh underneath swaps the store and leaves the form alone. What it does
// change is the *version* the store holds, and the form still carries the one
// it loaded at — so a save on top of a colleague's edit raises the conflict it
// should, and `persistence.ts` already turns that into a "Save conflict" toast
// with a Reload action rather than a silent overwrite.
//
// ── Why nothing happens on a hidden tab ────────────────────────────────────
//
// A background tab re-reading 1.100 products every time anybody saves spends
// a venue's bandwidth on a screen nobody is looking at, and the answer is
// stale again by the time they return. `useCatalogueRefresh` already re-reads
// on focus, which is both cheaper and more current.
// ---------------------------------------------------------------------------

import { useEffect } from "react";

import { coalesce } from "@/lib/coalesce";
import { isSupabaseConfigured, requireSupabase } from "@/lib/supabase";
import { refreshCatalogue } from "@/stores/persistence";
import { useAuthStore } from "@/stores/auth-store";

/** Published by 0127. Adding one here means adding it there as well. */
const LIVE_TABLES = ["products", "recipes", "sub_recipes"] as const;

/*
 * One save is one transaction and a burst of row events, so the window only
 * has to outlast the burst. It is also how long a colleague's change takes to
 * appear, which is why it is not ten seconds.
 */
const QUIET_MS = 1_500;

export function useCatalogueLive(): void {
  // Not the session object: it is replaced on every token refresh, and
  // tearing the socket down hourly would be churn for nothing. The client
  // keeps Realtime's own auth in step with the refreshed token by itself.
  const userId = useAuthStore((s) => s.session?.user?.id ?? null);
  const orgId = useAuthStore((s) => s.activeOrg?.id ?? null);

  useEffect(() => {
    if (!isSupabaseConfigured || !userId) return;

    const client = requireSupabase();
    const pending = coalesce(() => void refreshCatalogue(), QUIET_MS);

    function onChange() {
      if (document.visibilityState !== "visible") return;
      pending.nudge();
    }

    /*
     * One channel for the three tables rather than three channels. Each
     * channel is a separate subscription row the server re-evaluates against
     * the caller's policies for every change on that table; the work is the
     * same and the sockets are not.
     */
    const channel = client.channel(`catalogue:${orgId ?? "none"}`);
    for (const table of LIVE_TABLES) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        onChange,
      );
    }
    channel.subscribe();

    return () => {
      pending.cancel();
      void client.removeChannel(channel);
    };
  }, [userId, orgId]);
}
