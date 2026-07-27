// ---------------------------------------------------------------------------
// Cross-store actions: save an entity, then re-cost everything downstream
// ---------------------------------------------------------------------------
// This module is the only place that touches more than one store, which is
// what keeps the stores themselves free of circular imports (product-store
// importing sub-recipe-store while sub-recipe-store imports it back would
// leave one of them undefined at module-init time).
//
// Editors should call these instead of the bare `update` actions whenever a
// change can affect cost.
// ---------------------------------------------------------------------------

import type { Product, SubRecipe } from "@ccos/shared";
import { cascadeFrom, type Dependents } from "@/engine/cascade";
import { useProductStore } from "@/stores/product-store";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import { useRecipeStore } from "@/stores/recipe-store";

/** Re-cost every dependent of `entityId` and write the results back. */
function applyCascade(entityId: string): Dependents {
  const { subRecipes, recipes, affected } = cascadeFrom(entityId, {
    products: useProductStore.getState().products,
    subRecipes: useSubRecipeStore.getState().subRecipes,
    recipes: useRecipeStore.getState().recipes,
  });

  // Only write when something actually changed, so untouched entities keep
  // their identity and React can skip re-rendering them.
  if (affected.subRecipeIds.length > 0) {
    useSubRecipeStore.setState({ subRecipes });
  }
  if (affected.recipeIds.length > 0) {
    useRecipeStore.setState({ recipes });
  }

  return affected;
}

/**
 * Update a product, then push its new cost through every sub-recipe and recipe
 * that uses it — directly or via nested sub-recipes.
 */
export function updateProductAndCascade(
  id: string,
  changes: Partial<Product>,
): Dependents {
  useProductStore.getState().update(id, changes);
  return applyCascade(id);
}

/**
 * Update a sub-recipe, then re-cost its consumers. The sub-recipe's own lines
 * are re-costed too, so a stale ingredient price is corrected on save.
 */
export function updateSubRecipeAndCascade(
  id: string,
  changes: Partial<SubRecipe>,
): Dependents {
  useSubRecipeStore.getState().update(id, changes);
  return applyCascade(id);
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
