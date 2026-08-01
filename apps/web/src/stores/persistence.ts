// ---------------------------------------------------------------------------
// Persistence layer: hydrate the stores, then write through on every change
// ---------------------------------------------------------------------------
// The Zustand stores stay the synchronous in-memory source of truth, which is
// what lets the cascade engine and every editor keep working without becoming
// async. This module loads them from Supabase at startup and pushes changes
// back afterwards.
//
// Writes are optimistic: local state updates immediately and the request goes
// out behind it. On failure the error surfaces via `onError` and the caller can
// re-hydrate — better than blocking a chef's keystroke on a round trip.
//
// With no credentials configured everything here no-ops and the app runs on the
// in-memory mock catalogue exactly as before.
// ---------------------------------------------------------------------------

import { toast } from "sonner";
import type { Product, SubRecipe, Recipe } from "@ccos/shared";
import { isSupabaseConfigured } from "@/lib/supabase";
import * as repo from "@/data/repository";
import { ConflictError } from "@/data/repository";
import { cascadeFrom, type Dependents } from "@/engine/cascade";
import { useProductStore } from "@/stores/product-store";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import { useRecipeStore } from "@/stores/recipe-store";

export type PersistenceStatus =
  | "mock"      // no credentials — in-memory catalogue
  | "loading"
  | "ready"
  | "error";

let status: PersistenceStatus = isSupabaseConfigured ? "loading" : "mock";
let lastError: string | null = null;
const listeners = new Set<() => void>();

function setStatus(next: PersistenceStatus, error: string | null = null) {
  status = next;
  lastError = error;
  listeners.forEach((l) => l());
}

export function getPersistenceStatus(): PersistenceStatus {
  return status;
}
export function getPersistenceError(): string | null {
  return lastError;
}
export function subscribeToPersistence(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Report a write failure without tearing down local state. */
function reportWriteFailure(operation: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error(`[persistence] ${operation}:`, message);
  setStatus("error", `${operation}: ${message}`);

  // Writes are fire-and-forget, so a rejected save would otherwise fail in
  // silence — the editor has already navigated away showing a success toast.
  // A conflict in particular has to reach the user: their edit did not land.
  if (err instanceof ConflictError) {
    toast.error("Save conflict", {
      description: message,
      duration: 10000,
      action: { label: "Reload", onClick: () => window.location.reload() },
    });
  } else {
    toast.error("Change not saved", { description: message, duration: 8000 });
  }
}

/**
 * Load everything from Supabase into the stores.
 *
 * Leaves the mock catalogue in place if this fails, so a database outage
 * degrades to a read-only-ish demo rather than an empty screen.
 */
let inFlight: Promise<void> | null = null;

export async function hydrateFromSupabase(): Promise<void> {
  if (!isSupabaseConfigured) return;
  // React StrictMode and HMR can both re-run the module that calls this. Two
  // overlapping hydrations would race, and the loser would leave the status
  // stuck on "loading" after the winner had already finished.
  if (inFlight) return inFlight;
  inFlight = doHydrate().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doHydrate(): Promise<void> {
  setStatus("loading");
  try {
    const { products, subRecipes, recipes } = await repo.fetchAll();
    useProductStore.setState({ products });
    useSubRecipeStore.setState({ subRecipes });
    useRecipeStore.setState({ recipes });
    setStatus("ready");
  } catch (err) {
    reportWriteFailure("hydrate", err);
  }
}

// ── Write-through actions ───────────────────────────────────────────────────

/** Apply the cascade locally, then persist whatever it touched. */
function applyAndPersistCascade(entityId: string): Dependents {
  const { subRecipes, recipes, affected } = cascadeFrom(entityId, {
    products: useProductStore.getState().products,
    subRecipes: useSubRecipeStore.getState().subRecipes,
    recipes: useRecipeStore.getState().recipes,
  });

  if (affected.subRecipeIds.length > 0) {
    useSubRecipeStore.setState({ subRecipes });
  }
  if (affected.recipeIds.length > 0) {
    useRecipeStore.setState({ recipes });
  }

  if (isSupabaseConfigured && (affected.subRecipeIds.length || affected.recipeIds.length)) {
    const touchedSubs = subRecipes.filter((s) =>
      affected.subRecipeIds.includes(s.id),
    );
    const touchedRecipes = recipes.filter((r) =>
      affected.recipeIds.includes(r.id),
    );
    void repo
      .persistCascade(touchedSubs, touchedRecipes)
      .catch((err) => reportWriteFailure("persistCascade", err));
  }

  return affected;
}

export async function createProduct(
  data: Omit<Product, "id" | "createdAt" | "updatedAt">,
): Promise<Product> {
  if (!isSupabaseConfigured) {
    return useProductStore.getState().create(data);
  }
  const saved = await repo.insertProduct(data);
  useProductStore.setState((s) => ({ products: [...s.products, saved] }));
  return saved;
}

export function saveProduct(id: string, changes: Partial<Product>): Dependents {
  useProductStore.getState().update(id, changes);
  const affected = applyAndPersistCascade(id);

  if (isSupabaseConfigured) {
    void repo
      .updateProduct(id, changes)
      .catch((err) => reportWriteFailure("updateProduct", err));
  }
  return affected;
}

export async function createSubRecipe(
  data: Omit<SubRecipe, "id" | "createdAt" | "updatedAt">,
): Promise<SubRecipe> {
  if (!isSupabaseConfigured) {
    return useSubRecipeStore.getState().create(data);
  }
  const saved = await repo.insertSubRecipe(data);
  useSubRecipeStore.setState((s) => ({ subRecipes: [...s.subRecipes, saved] }));
  return saved;
}

export async function createRecipe(
  data: Omit<Recipe, "id" | "createdAt" | "updatedAt">,
): Promise<Recipe> {
  if (!isSupabaseConfigured) {
    return useRecipeStore.getState().create(data);
  }
  const saved = await repo.insertRecipe(data);
  useRecipeStore.setState((s) => ({ recipes: [...s.recipes, saved] }));
  return saved;
}

/**
 * Save a recipe. Nothing is built on top of a recipe, so unlike products and
 * sub-recipes there is no cascade to run — only this row changes.
 */
export function saveRecipe(
  id: string,
  changes: Partial<Recipe>,
  expectedVersion?: number,
): void {
  useRecipeStore.getState().update(id, changes);

  if (isSupabaseConfigured) {
    void repo
      .updateRecipe(id, changes, expectedVersion)
      .catch((err) => reportWriteFailure("updateRecipe", err));
  }
}

export function saveSubRecipe(
  id: string,
  changes: Partial<SubRecipe>,
  expectedVersion?: number,
): Dependents {
  useSubRecipeStore.getState().update(id, changes);
  const affected = applyAndPersistCascade(id);

  if (isSupabaseConfigured) {
    void repo
      .updateSubRecipe(id, changes, expectedVersion)
      .catch((err) => reportWriteFailure("updateSubRecipe", err));
  }
  return affected;
}

// ── Removal ─────────────────────────────────────────────────────────────────
// Awaited rather than fire-and-forget, unlike the saves above.
//
// A save that fails leaves the UI optimistic and the database behind, and the
// next hydration corrects it. A delete that fails and was not awaited leaves
// the row gone from the screen and present in the database — so the user is
// told it worked, reloads, and finds it back. The caller needs the error.

export async function removeProduct(id: string): Promise<void> {
  if (isSupabaseConfigured) await repo.deleteProduct(id);
  useProductStore.getState().remove(id);
}

export async function removeSubRecipe(id: string): Promise<void> {
  if (isSupabaseConfigured) await repo.deleteSubRecipe(id);
  useSubRecipeStore.getState().remove(id);
}

export async function removeRecipe(id: string): Promise<void> {
  if (isSupabaseConfigured) await repo.deleteRecipe(id);
  useRecipeStore.getState().remove(id);
}
