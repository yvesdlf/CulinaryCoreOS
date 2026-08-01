import { useSyncExternalStore } from "react";
import {
  getPersistenceStatus,
  subscribeToPersistence,
} from "@/stores/persistence";

/**
 * Whether the catalogue has finished arriving.
 *
 * Detail pages redirect when the entity in the URL does not exist. On a
 * client-side navigation the stores are already full and that is correct; on a
 * fresh page load they are empty for a moment, and the same check concluded the
 * recipe was missing and bounced the user to the list.
 *
 * That made every deep link unusable — a pasted recipe URL, a link in an email,
 * the "recipe sheet" link on a printed pack — which is a poor property for an
 * app whose whole output is shareable sheets.
 *
 * `useSyncExternalStore` rather than an effect, so the first render already
 * knows: an effect would run after the redirect had been decided.
 */
export function useCatalogueLoaded(): boolean {
  const status = useSyncExternalStore(
    subscribeToPersistence,
    getPersistenceStatus,
    getPersistenceStatus,
  );
  // "mock" means there is no database and the in-memory catalogue is already
  // complete; "error" means it is never coming, and holding the page hostage
  // would be worse than telling the user the entity is not there.
  return status !== "loading";
}
