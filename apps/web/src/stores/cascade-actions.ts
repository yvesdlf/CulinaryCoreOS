// ---------------------------------------------------------------------------
// Cross-store actions: save an entity, then re-cost everything downstream
// ---------------------------------------------------------------------------
// A thin facade over `persistence`, which owns both the in-memory update and
// the write-through to Supabase. Editors import from here so they never have to
// care whether a database is configured.
// ---------------------------------------------------------------------------

import type { Product, SubRecipe } from "@ccos/shared";
import type { Dependents } from "@/engine/cascade";
import { saveProduct, saveSubRecipe } from "@/stores/persistence";

/**
 * Update a product, then push its new cost through every sub-recipe and recipe
 * that uses it — directly or via nested sub-recipes.
 */
export function updateProductAndCascade(
  id: string,
  changes: Partial<Product>,
): Dependents {
  return saveProduct(id, changes);
}

/**
 * Update a sub-recipe, then re-cost its consumers. The sub-recipe's own lines
 * are re-costed too, so a stale ingredient price is corrected on save.
 */
export function updateSubRecipeAndCascade(
  id: string,
  changes: Partial<SubRecipe>,
  expectedVersion?: number,
): Dependents {
  return saveSubRecipe(id, changes, expectedVersion);
}

/** Human-readable summary of what a cascade touched, for a toast. */
export function describeCascade(affected: Dependents): string | null {
  const subs = affected.subRecipeIds.length;
  const recipes = affected.recipeIds.length;
  if (subs === 0 && recipes === 0) return null;

  const parts: string[] = [];
  if (subs > 0) parts.push(`${subs} sub recipe${subs === 1 ? "" : "s"}`);
  if (recipes > 0) parts.push(`${recipes} recipe${recipes === 1 ? "" : "s"}`);
  return `Re-costed ${parts.join(" and ")}`;
}
