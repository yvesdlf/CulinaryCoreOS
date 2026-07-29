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

import type Decimal from "decimal.js";
import type { Product, SubRecipe, Recipe, IngredientLine } from "@ccos/shared";
import {
  calculateLineCost,
  calculateRecipeTotalCost,
  calculateFoodCostPercent,
  calculateContributionMargin,
  calculateSubRecipeCostPerUnit,
  calculatePercentAmount,
  calculateTotalCog,
  calculatePriceInclTax,
  calculateGrossProfitPercent,
  toDecimal,
} from "./cost-engine";

/** Per-unit costs are fractions of a rupiah per gram, so they need precision. */
const UNIT_COST_DP = 5;
/** Money totals as stored on the entities. */
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
): { line: IngredientLine; lineCost: Decimal } {
  // Source of truth for cost is the referenced entity, not the stored line.
  let costPerUnit: string = line.costPerUnit;

  if (line.productId) {
    const product = productById.get(line.productId);
    // Deliberately the GROSS (as-purchased) price, not the nett one. Line cost
    // is grossQty * costPerUnit, and grossQty already carries the waste
    // adjustment — nettPricePerUnit carries it too, so pairing them would
    // charge for the trim twice. Beef at 20% trim would come out 25% high.
    if (product) costPerUnit = product.cost.grossPricePerUnit;
  } else if (line.subRecipeId) {
    const sub = subRecipeById.get(line.subRecipeId);
    if (sub) costPerUnit = sub.costPerUnit;
  }

  const { grossQty, lineCost } = calculateLineCost(
    line.nettQty,
    line.refPercent,
    costPerUnit,
  );

  // The rounded string is what the user sees; the exact Decimal is returned
  // alongside so totals sum at full precision and round exactly once.
  return {
    line: {
      ...line,
      grossQty: grossQty.toNumber(),
      costPerUnit: toDecimal(costPerUnit).toFixed(UNIT_COST_DP),
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
  // Cost per unit is taken on cost plus buffers — that is what a dish using
  // this preparation actually consumes.
  const costWithBuffers = calculateTotalCog(
    totalCost,
    sub.wastePercent,
    sub.inflationPercent,
  );
  const costPerUnit = calculateSubRecipeCostPerUnit(
    costWithBuffers,
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

  // Buffers and tax come from the recipe itself, not a global constant, so a
  // dish priced under a different tax regime re-costs on its own terms.
  const wasteAmount = calculatePercentAmount(totalCost, recipe.wastePercent);
  const inflationAmount = calculatePercentAmount(
    totalCost,
    recipe.inflationPercent,
  );
  const totalCog = calculateTotalCog(
    totalCost,
    recipe.wastePercent,
    recipe.inflationPercent,
  );
  const menuPrice = toDecimal(recipe.pricing.menuPrice);
  const priceInclTax = calculatePriceInclTax(menuPrice, recipe.taxPercent);
  const foodCostPercent = calculateFoodCostPercent(totalCog, menuPrice);
  const grossProfit = calculateContributionMargin(menuPrice, totalCog);
  const grossProfitPercent = calculateGrossProfitPercent(menuPrice, totalCog);

  return {
    ...recipe,
    ingredientLines: results.map((r) => r.line),
    pricing: {
      ...recipe.pricing,
      menuPrice: menuPrice.toFixed(MONEY_DP),
      priceInclTax: priceInclTax.toFixed(MONEY_DP),
      totalCost: totalCost.toFixed(MONEY_DP),
      wasteAmount: wasteAmount.toFixed(MONEY_DP),
      inflationAmount: inflationAmount.toFixed(MONEY_DP),
      totalCog: totalCog.toFixed(MONEY_DP),
      grossProfit: grossProfit.toFixed(MONEY_DP),
      grossProfitPercent: grossProfitPercent.toDecimalPlaces(1).toNumber(),
      // The data model stores this one as a number; round in Decimal first so
      // the conversion happens after the arithmetic, not during it.
      foodCostPercent: foodCostPercent.toDecimalPlaces(1).toNumber(),
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
