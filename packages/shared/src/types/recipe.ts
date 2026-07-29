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

  totalCost: Decimal;        // sum of ingredient lines, before buffers
  costPerUnit: Decimal;      // (cost + buffers) / batch yield

  /**
   * Costing buffers and tax, editable per sub-recipe.
   *
   * Defaults follow the venue's costing workbook: waste is taken when costing
   * a batch (5%), while the inflation buffer is applied at dish level (0% here)
   * so it is not counted twice on anything built from this sub-recipe. Tax is
   * carried for the case where a preparation is sold directly.
   */
  wastePercent: number;
  inflationPercent: number;
  taxPercent: number;

  /** @deprecated Superseded by wastePercent/inflationPercent. */
  securityMarginPercent?: number;

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
    /**
     * The price the chef sets, EXCLUDING tax and service. Every margin is
     * measured against this; the guest-facing figure is derived from it.
     */
    menuPrice: Decimal;
    /** Derived: menuPrice * (1 + taxPercent/100). */
    priceInclTax: Decimal;

    totalCost: Decimal;      // sum of ingredient lines, before buffers
    wasteAmount: Decimal;    // totalCost * wastePercent
    inflationAmount: Decimal; // totalCost * inflationPercent
    totalCog: Decimal;       // cost + waste + inflation

    grossProfit: Decimal;    // menuPrice - totalCog
    grossProfitPercent: number;
    foodCostPercent: number; // totalCog / menuPrice * 100

    currency: string;

    /** @deprecated Renamed to menuPrice / priceInclTax. */
    priceInclVat?: Decimal;
    priceExclVat?: Decimal;
    /** @deprecated Renamed to totalCog. */
    totalCostWithSecurityMargin?: Decimal;
    /** @deprecated Renamed to grossProfit. */
    grossContributionMargin?: Decimal;
  };

  /** Costing buffers and tax, editable per recipe. */
  wastePercent: number;
  inflationPercent: number;
  taxPercent: number;

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
