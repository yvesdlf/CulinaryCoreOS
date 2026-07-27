// ---------------------------------------------------------------------------
// Cascading cost recalculation
// ---------------------------------------------------------------------------
// When a product's price changes, every sub-recipe and recipe that uses it —
// directly or through other sub-recipes — has to be re-costed. This module
// owns the dependency graph walk and the re-costing itself.
//
// It is deliberately pure: it takes the current entities and returns new ones,
// so it can be unit-tested and reused once the data comes from Supabase.
// ---------------------------------------------------------------------------

import type { Product, SubRecipe, Recipe, IngredientLine } from "@ccos/shared";
import {
  calculateLineCost,
  calculateRecipeTotalCost,
  calculateCostWithMargin,
  calculateFoodCostPercent,
  calculateContributionMargin,
  calculatePriceExclVat,
  calculateSubRecipeCostPerUnit,
} from "./cost-engine";
import { DEFAULT_SECURITY_MARGIN, DEFAULT_VAT_RATE } from "@/lib/constants";

/** Per-unit costs are fractions of a fils per gram, so they need real precision. */
const UNIT_COST_DP = 5;
/** Money totals are shown to the user in AED. */
const MONEY_DP = 2;

export interface EntityState {
  products: Product[];
  subRecipes: SubRecipe[];
  recipes: Recipe[];
}

export interface Dependents {
  subRecipeIds: string[];
  recipeIds: string[];
}

// ── Dependency graph ────────────────────────────────────────────────────────

/**
 * Every sub-recipe and recipe that transitively depends on `entityId`.
 *
 * Walks reverse edges to unlimited depth — flour -> Pizza Dough -> Margherita
 * Pizza — and is safe against cycles, which nothing currently prevents a user
 * from creating (two sub-recipes referencing each other).
 */
export function getDependents(
  entityId: string,
  state: Pick<EntityState, "subRecipes" | "recipes">,
): Dependents {
  const affectedSubs = new Set<string>();

  // Grow the frontier until no new sub-recipe is pulled in. The `changed` flag
  // (rather than recursion) keeps cycles from looping forever.
  const frontier = new Set<string>([entityId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const sub of state.subRecipes) {
      if (affectedSubs.has(sub.id)) continue;
      const usesFrontier = sub.ingredientLines.some(
        (line) =>
          (line.productId && frontier.has(line.productId)) ||
          (line.subRecipeId && frontier.has(line.subRecipeId)),
      );
      if (usesFrontier) {
        affectedSubs.add(sub.id);
        frontier.add(sub.id);
        changed = true;
      }
    }
  }

  const recipeIds = state.recipes
    .filter((recipe) =>
      recipe.ingredientLines.some(
        (line) =>
          line.productId === entityId ||
          (line.subRecipeId &&
            (line.subRecipeId === entityId || affectedSubs.has(line.subRecipeId))),
      ),
    )
    .map((r) => r.id);

  return { subRecipeIds: [...affectedSubs], recipeIds };
}

/**
 * Order sub-recipes so dependencies are re-costed before their consumers.
 *
 * A sub-recipe nested in another must have its final cost/unit before the
 * parent multiplies by it, otherwise the parent uses a stale figure.
 */
function topologicalOrder(
  ids: string[],
  subRecipeById: Map<string, SubRecipe>,
): string[] {
  const order: string[] = [];
  const included = new Set(ids);
  const mark = new Map<string, "visiting" | "done">();

  function visit(id: string): void {
    const state = mark.get(id);
    // Returning on "visiting" breaks a cycle: the entity keeps its current
    // cost for this pass rather than recursing forever.
    if (state) return;

    mark.set(id, "visiting");
    const sub = subRecipeById.get(id);
    if (sub) {
      for (const line of sub.ingredientLines) {
        if (line.subRecipeId && included.has(line.subRecipeId)) {
          visit(line.subRecipeId);
        }
      }
    }
    mark.set(id, "done");
    order.push(id);
  }

  for (const id of ids) visit(id);
  return order;
}

// ── Line / entity re-costing ────────────────────────────────────────────────

/**
 * Re-cost one ingredient line against current product / sub-recipe prices.
 *
 * `costPerUnit` is refreshed from the source entity because the UI shows it
 * read-only — it is always derived. `refPercent` is left alone: the ingredient
 * grid lets a chef override trim per line, and overwriting that would silently
 * discard a deliberate entry.
 */
function recalculateLine(
  line: IngredientLine,
  productById: Map<string, Product>,
  subRecipeById: Map<string, SubRecipe>,
): { line: IngredientLine; lineCost: number } {
  let costPerUnit = parseFloat(line.costPerUnit) || 0;

  if (line.productId) {
    const product = productById.get(line.productId);
    if (product) costPerUnit = parseFloat(product.cost.nettPricePerUnit) || 0;
  } else if (line.subRecipeId) {
    const sub = subRecipeById.get(line.subRecipeId);
    if (sub) costPerUnit = parseFloat(sub.costPerUnit) || 0;
  }

  const { grossQty, lineCost } = calculateLineCost(
    line.nettQty,
    line.refPercent,
    costPerUnit,
  );

  // The rounded string is what the user sees; the raw number is returned
  // alongside so totals sum at full precision and round exactly once. Summing
  // the rounded strings instead lets a half-fils error per line accumulate.
  return {
    line: {
      ...line,
      grossQty,
      costPerUnit: costPerUnit.toFixed(UNIT_COST_DP),
      lineCost: lineCost.toFixed(MONEY_DP),
    },
    lineCost,
  };
}

/** Re-cost a sub-recipe: every line, then batch total and cost per unit. */
export function recalculateSubRecipe(
  sub: SubRecipe,
  productById: Map<string, Product>,
  subRecipeById: Map<string, SubRecipe>,
): SubRecipe {
  const results = sub.ingredientLines.map((line) =>
    recalculateLine(line, productById, subRecipeById),
  );

  const totalCost = calculateRecipeTotalCost(results);
  const costPerUnit = calculateSubRecipeCostPerUnit(
    totalCost,
    sub.batchYield.qty,
  );

  return {
    ...sub,
    ingredientLines: results.map((r) => r.line),
    totalCost: totalCost.toFixed(MONEY_DP),
    costPerUnit: costPerUnit.toFixed(UNIT_COST_DP),
  };
}

/** Re-cost a recipe: every line, then the full pricing block. */
export function recalculateRecipe(
  recipe: Recipe,
  productById: Map<string, Product>,
  subRecipeById: Map<string, SubRecipe>,
): Recipe {
  const results = recipe.ingredientLines.map((line) =>
    recalculateLine(line, productById, subRecipeById),
  );

  const totalCost = calculateRecipeTotalCost(results);
  const priceInclVat = parseFloat(recipe.pricing.priceInclVat) || 0;
  const priceExclVat = calculatePriceExclVat(priceInclVat, DEFAULT_VAT_RATE);
  const totalCostWithSecurityMargin = calculateCostWithMargin(
    totalCost,
    DEFAULT_SECURITY_MARGIN,
  );
  const foodCostPercent = calculateFoodCostPercent(
    totalCostWithSecurityMargin,
    priceExclVat,
  );
  const grossContributionMargin = calculateContributionMargin(
    priceExclVat,
    totalCostWithSecurityMargin,
  );

  return {
    ...recipe,
    ingredientLines: results.map((r) => r.line),
    pricing: {
      ...recipe.pricing,
      priceExclVat: priceExclVat.toFixed(MONEY_DP),
      totalCost: totalCost.toFixed(MONEY_DP),
      totalCostWithSecurityMargin:
        totalCostWithSecurityMargin.toFixed(MONEY_DP),
      grossContributionMargin: grossContributionMargin.toFixed(MONEY_DP),
      foodCostPercent: parseFloat(foodCostPercent.toFixed(1)),
    },
  };
}

// ── Entry point ─────────────────────────────────────────────────────────────

export interface CascadeResult {
  subRecipes: SubRecipe[];
  recipes: Recipe[];
  affected: Dependents;
}

/**
 * Re-cost everything downstream of a changed product or sub-recipe.
 *
 * Returns complete replacement arrays; entities that were not affected are
 * passed through by reference so React can skip re-rendering them.
 */
export function cascadeFrom(
  changedEntityId: string,
  state: EntityState,
): CascadeResult {
  const affected = getDependents(changedEntityId, state);

  const productById = new Map(state.products.map((p) => [p.id, p]));
  // Mutated as we go: a sub-recipe's new cost must be visible to its consumers.
  const subRecipeById = new Map(state.subRecipes.map((s) => [s.id, s]));

  for (const id of topologicalOrder(affected.subRecipeIds, subRecipeById)) {
    const sub = subRecipeById.get(id);
    if (!sub) continue;
    subRecipeById.set(id, recalculateSubRecipe(sub, productById, subRecipeById));
  }

  const recipeIds = new Set(affected.recipeIds);
  const recipes = state.recipes.map((recipe) =>
    recipeIds.has(recipe.id)
      ? recalculateRecipe(recipe, productById, subRecipeById)
      : recipe,
  );

  return {
    subRecipes: state.subRecipes.map((s) => subRecipeById.get(s.id) ?? s),
    recipes,
    affected,
  };
}
