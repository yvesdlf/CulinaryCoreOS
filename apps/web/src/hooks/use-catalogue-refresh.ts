import { useEffect } from "react";
import { refreshCatalogue } from "@/stores/persistence";

/**
 * Re-read the catalogue when the tab comes back to the foreground.
 *
 * Reads happen once at sign-in, so a second person's price change was
 * invisible until someone reloaded the page. In a kitchen that means a chef
 * costing a dish from a figure a manager corrected an hour ago — the sort of
 * staleness nobody notices until the numbers are already wrong.
 *
 * Focus rather than a poll: the moment that matters is when someone returns to
 * the tab and starts working again, and polling a 1.100-row catalogue on a
 * timer spends bandwidth on the many minutes nobody is looking.
 *
 * Writes are still guarded by version checks, so this closes a staleness gap
 * rather than a correctness one — an edit against stale data is refused either
 * way, and this means it far more rarely gets that far.
 */
export function useCatalogueRefresh(): void {
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") void refreshCatalogue();
    }
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
