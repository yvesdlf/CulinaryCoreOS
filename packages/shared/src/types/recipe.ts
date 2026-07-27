import type { Decimal, NutritionPer100g } from "./product";

export type RecipeStatus = "NEW" | "ACTUAL" | "PENDING" | "UPDATE" | "DISCONTINUED";

/**
 * A single ingredient (or sub-recipe) line inside a Recipe or Sub-Recipe.
 * Modeled from the ingredient-line columns shared by both the RECIPE and
 * SubRec template sheets: NETT QTY, U, REF %, GROSS QTY, U, COST/U, COST.
 */
export interface IngredientLine {
  id: string;
  lineNumber: number;

  /** Exactly one of these is set — a line references either a raw Product or a Sub-Recipe. */
  productId: string | null;
  subRecipeId: string | null;

  nettQty: number;
  nettUnit: string;
  refPercent: number; // waste/trim reference %, inherited from the product/sub-recipe
  grossQty: number; // = nettQty / (1 - refPercent/100)
  grossUnit: string;

  costPerUnit: Decimal;
  lineCost: Decimal; // = grossQty * costPerUnit
}

/**
 * Sub-Recipe — an intermediate, reusable component (sauce, marinade, base,
 * dough, etc.) that can itself be used as an ingredient line in a Recipe or
 * in another Sub-Recipe. Source: 2_-_Sub_Rec.xlsm (250 sheets).
 *
 * Nesting is unlimited per SRS decision #11 ("unlimited ingredient lines;
 * workbook limit of 26 is arbitrary — remove it").
 */
export interface SubRecipe {
  id: string;
  name: string;
  category: string;
  status: RecipeStatus;

  ingredientLines: IngredientLine[];

  batchYield: {
    qty: number;
    unit: string; // e.g. "g", "PCS", "btc"
  };

  totalCost: Decimal;
  costPerUnit: Decimal;
  securityMarginPercent: number; // default 5, per SRS decision #8

  nutritionPer100g: NutritionPer100g;
  allergens: string[];

  version: number; // per SRS 4.16 Version Control & Audit
  createdAt: string;
  updatedAt: string;
}

/**
 * Recipe — a sellable/servable menu item. Source: 1_-_Recipes.xlsm (89 sheets).
 */
export interface Recipe {
  id: string;
  name: string;
  category: string; // e.g. "01.BITES", "05.MAINS" — from the "Set Up" sheet categories
  status: RecipeStatus;

  ingredientLines: IngredientLine[];

  portion: {
    yieldQty: number; // workbook: YIELD
    yieldUnit: string; // e.g. "por", "pc"
  };

  pricing: {
    priceInclVat: Decimal;
    priceExclVat: Decimal;
    totalCost: Decimal;
    totalCostWithSecurityMargin: Decimal; // cost + 5% default margin
    grossContributionMargin: Decimal; // price - cost
    foodCostPercent: number;
    currency: string; // default from tenant settings, e.g. "AED", "IDR"
  };

  nutritionPerPortion: NutritionPer100g;
  allergens: string[];
  dietaryFlags: {
    glutenFree: boolean;
    dairyFree: boolean;
    vegetarian: boolean;
    vegan: boolean;
    nutsFree: boolean;
    soyFree: boolean;
    sulfitesFree: boolean;
  };

  version: number;
  createdAt: string;
  updatedAt: string;
}
