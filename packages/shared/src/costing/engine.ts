import type { Decimal } from "../types/product";
import type { Recipe, SubRecipe, IngredientLine } from "../types/recipe";

/**
 * Cost Engine — interface stubs only. Implementation pending (see
 * docs/PROGRESS.md backlog). Mirrors SRS Section 4.4 (Cost Engine):
 * real-time cascading cost calculations with configurable security margins,
 * waste adjustments, and multi-currency support.
 *
 * Cascading rule (per SRS): a price change on a Product must propagate
 * automatically through every Sub-Recipe and Recipe that references it,
 * directly or via nested Sub-Recipes — this is the #1 gap in the Excel
 * workbooks this platform replaces (see SRS 1.3, item 6).
 */
export interface CostEngine {
  /** Recalculate a single ingredient line's gross qty and line cost. */
  calculateLineCost(line: IngredientLine, costPerUnit: Decimal): IngredientLine;

  /** Recalculate a Sub-Recipe's total cost from its ingredient lines. */
  recalculateSubRecipe(subRecipe: SubRecipe): SubRecipe;

  /** Recalculate a Recipe's total cost, margin, and food cost % from its ingredient lines. */
  recalculateRecipe(recipe: Recipe): Recipe;

  /**
   * Given a Product (or Sub-Recipe) id whose cost changed, return the full
   * set of Sub-Recipe and Recipe ids that need recalculation, walking the
   * dependency graph to unlimited depth.
   */
  getDependents(entityId: string): Promise<{ subRecipeIds: string[]; recipeIds: string[] }>;
}
