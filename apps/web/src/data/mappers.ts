// ---------------------------------------------------------------------------
// Row <-> domain mapping
// ---------------------------------------------------------------------------
// Postgres rows are flat and snake_case; the domain types are nested and
// camelCase. Money is numeric in the database and arrives as a string from
// PostgREST, which is what we want — it goes straight into decimal.js without
// passing through a float.
// ---------------------------------------------------------------------------

import type {
  Product,
  SubRecipe,
  Recipe,
  IngredientLine,
  NutritionPer100g,
  ProductStatus,
  RecipeStatus,
} from "@ccos/shared";

/** PostgREST hands numerics back as string | number depending on the driver. */
type Numeric = string | number | null;

/** Money keeps its string form so decimal.js can parse it exactly. */
function money(v: Numeric, fallback = "0"): string {
  if (v === null || v === undefined) return fallback;
  return typeof v === "string" ? v : String(v);
}

/** Quantities and percentages are plain numbers in the domain model. */
function num(v: Numeric, fallback = 0): number {
  if (v === null || v === undefined) return fallback;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

const NUTRITION_COLUMNS = [
  "fat_g",
  "carbs_g",
  "protein_g",
  "vit_a_mg",
  "vit_c_mg",
  "calcium_mg",
  "iron_mg",
  "sodium_mg",
  "kcal",
] as const;

function nutritionFromRow(row: Record<string, Numeric>): NutritionPer100g {
  return {
    fatG: num(row.fat_g),
    carbsG: num(row.carbs_g),
    proteinG: num(row.protein_g),
    vitAMg: num(row.vit_a_mg),
    vitCMg: num(row.vit_c_mg),
    calciumMg: num(row.calcium_mg),
    ironMg: num(row.iron_mg),
    sodiumMg: num(row.sodium_mg),
    kcal: num(row.kcal),
  };
}

function nutritionToRow(n: NutritionPer100g): Record<string, number> {
  return {
    fat_g: n.fatG,
    carbs_g: n.carbsG,
    protein_g: n.proteinG,
    vit_a_mg: n.vitAMg,
    vit_c_mg: n.vitCMg,
    calcium_mg: n.calciumMg,
    iron_mg: n.ironMg,
    sodium_mg: n.sodiumMg,
    kcal: n.kcal,
  };
}

export const NUTRITION_SELECT = NUTRITION_COLUMNS.join(", ");

// ── Product ─────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */


/**
 * Preparation, shared by dishes and the preparations they are built from.
 *
 * A null column becomes an empty list rather than undefined: "nobody has
 * written the method down" is a state the UI must render, and undefined would
 * make every consumer guard for it separately.
 */
function preparationFromRow(row: any) {
  return {
    method: row.method ?? [],
    prepMinutes: row.prep_minutes ?? null,
    cookMinutes: row.cook_minutes ?? null,
    internalNotes: row.internal_notes ?? null,
  };
}

function preparationToRow(
  p: { method?: string[]; prepMinutes?: number | null; cookMinutes?: number | null; internalNotes?: string | null } | undefined,
  row: Record<string, unknown>,
): void {
  if (!p) return;
  // Blank steps are what an empty editor row leaves behind; storing them would
  // print a numbered gap on a sheet.
  if (p.method !== undefined) row.method = p.method.map((s) => s.trim()).filter(Boolean);
  if (p.prepMinutes !== undefined) row.prep_minutes = p.prepMinutes;
  if (p.cookMinutes !== undefined) row.cook_minutes = p.cookMinutes;
  if (p.internalNotes !== undefined) row.internal_notes = p.internalNotes;
}

export function productFromRow(row: any): Product {
  return {
    id: row.id,
    category: row.category ?? "",
    supplier: row.supplier ?? null,
    name: row.name,
    brand: row.brand ?? null,
    packing: {
      packQty: num(row.pack_qty, 1),
      packUnit: row.pack_unit ?? "",
      unitsPerPack: num(row.units_per_pack, 1),
      unitsPerPackUnit: row.units_per_pack_unit ?? "",
      totalQty: num(row.total_qty),
      totalUnit: row.total_unit ?? "",
    },
    cost: {
      buyingPricePerPack: money(row.buying_price_per_pack),
      buyingPricePerUnit: money(row.buying_price_per_unit),
      grossPricePerUnit: money(row.gross_price_per_unit),
      nettPricePerUnit: money(row.nett_price_per_unit),
    },
    yield_: {
      grossQty: num(row.gross_qty),
      grossUnit: row.gross_unit ?? "",
      wasteQty: num(row.waste_qty),
      wasteUnit: row.waste_unit ?? "",
      nettQty: num(row.nett_qty),
      nettUnit: row.nett_unit ?? "",
      refPercent: num(row.ref_percent),
      yieldPercent: num(row.yield_percent, 100),
    },
    status: (row.status ?? "ACTIVE") as ProductStatus,
    nutrition: nutritionFromRow(row),
    allergens: row.allergens ?? [],
    version: num(row.version, 1),
    allergensNeedReview: row.allergens_need_review === true,
    allergenReviewNote: row.allergen_review_note ?? null,
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
  };
}

export function productToRow(p: Partial<Product>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (p.category !== undefined) row.category = p.category;
  if (p.supplier !== undefined) row.supplier = p.supplier;
  if (p.name !== undefined) row.name = p.name;
  if (p.brand !== undefined) row.brand = p.brand;
  if (p.status !== undefined) row.status = p.status;
  if (p.allergens !== undefined) row.allergens = p.allergens;
  if (p.allergensNeedReview !== undefined)
    row.allergens_need_review = p.allergensNeedReview;
  if (p.allergenReviewNote !== undefined)
    row.allergen_review_note = p.allergenReviewNote;

  if (p.packing) {
    row.pack_qty = p.packing.packQty;
    row.pack_unit = p.packing.packUnit;
    row.units_per_pack = p.packing.unitsPerPack;
    row.units_per_pack_unit = p.packing.unitsPerPackUnit;
    row.total_qty = p.packing.totalQty;
    row.total_unit = p.packing.totalUnit;
  }
  if (p.cost) {
    row.buying_price_per_pack = p.cost.buyingPricePerPack;
    row.buying_price_per_unit = p.cost.buyingPricePerUnit;
    row.gross_price_per_unit = p.cost.grossPricePerUnit;
    row.nett_price_per_unit = p.cost.nettPricePerUnit;
  }
  if (p.yield_) {
    row.gross_qty = p.yield_.grossQty;
    row.gross_unit = p.yield_.grossUnit;
    row.waste_qty = p.yield_.wasteQty;
    row.waste_unit = p.yield_.wasteUnit;
    row.nett_qty = p.yield_.nettQty;
    row.nett_unit = p.yield_.nettUnit;
    row.ref_percent = p.yield_.refPercent;
    row.yield_percent = p.yield_.yieldPercent;
  }
  if (p.nutrition) Object.assign(row, nutritionToRow(p.nutrition));
  return row;
}

// ── Ingredient lines ────────────────────────────────────────────────────────

/**
 * @param childKey Sub-recipe lines name their nested reference
 *                 `child_sub_recipe_id`; recipe lines use `sub_recipe_id`.
 */
export function lineFromRow(row: any, childKey: string): IngredientLine {
  return {
    id: row.id,
    lineNumber: num(row.line_number),
    productId: row.product_id ?? null,
    subRecipeId: row[childKey] ?? null,
    nettQty: num(row.nett_qty),
    nettUnit: row.nett_unit ?? "",
    refPercent: num(row.ref_percent),
    grossQty: num(row.gross_qty),
    grossUnit: row.gross_unit ?? "",
    costPerUnit: money(row.cost_per_unit),
    lineCost: money(row.line_cost),
  };
}

export function lineToRow(
  line: IngredientLine,
  parentKey: string,
  parentId: string,
  childKey: string,
): Record<string, unknown> {
  return {
    [parentKey]: parentId,
    line_number: line.lineNumber,
    product_id: line.productId,
    [childKey]: line.subRecipeId,
    nett_qty: line.nettQty,
    nett_unit: line.nettUnit,
    ref_percent: line.refPercent,
    gross_qty: line.grossQty,
    gross_unit: line.grossUnit,
    cost_per_unit: line.costPerUnit,
    line_cost: line.lineCost,
  };
}

// ── Sub-recipe ──────────────────────────────────────────────────────────────

export function subRecipeFromRow(row: any): SubRecipe {
  return {
    id: row.id,
    name: row.name,
    category: row.category ?? "",
    status: (row.status ?? "NEW") as RecipeStatus,
    ingredientLines: (row.sub_recipe_lines ?? [])
      .map((l: any) => lineFromRow(l, "child_sub_recipe_id"))
      .sort((a: IngredientLine, b: IngredientLine) => a.lineNumber - b.lineNumber),
    batchYield: {
      qty: num(row.batch_yield_qty),
      unit: row.batch_yield_unit ?? "g",
    },
    totalCost: money(row.total_cost),
    costPerUnit: money(row.cost_per_unit),
    wastePercent: num(row.waste_percent, 5),
    inflationPercent: num(row.inflation_percent, 0),
    taxPercent: num(row.tax_percent, 21),
    securityMarginPercent: num(row.security_margin_percent, 5),
    nutritionPer100g: nutritionFromRow(row),
    allergens: row.allergens ?? [],
    preparation: preparationFromRow(row),
    version: num(row.version, 1),
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
  };
}

export function subRecipeToRow(s: Partial<SubRecipe>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (s.name !== undefined) row.name = s.name;
  if (s.category !== undefined) row.category = s.category;
  if (s.status !== undefined) row.status = s.status;
  if (s.totalCost !== undefined) row.total_cost = s.totalCost;
  if (s.costPerUnit !== undefined) row.cost_per_unit = s.costPerUnit;
  if (s.wastePercent !== undefined) row.waste_percent = s.wastePercent;
  if (s.inflationPercent !== undefined)
    row.inflation_percent = s.inflationPercent;
  if (s.taxPercent !== undefined) row.tax_percent = s.taxPercent;
  if (s.allergens !== undefined) row.allergens = s.allergens;
  preparationToRow(s.preparation, row);
  if (s.version !== undefined) row.version = s.version;
  if (s.batchYield) {
    row.batch_yield_qty = s.batchYield.qty;
    row.batch_yield_unit = s.batchYield.unit;
  }
  if (s.nutritionPer100g) Object.assign(row, nutritionToRow(s.nutritionPer100g));
  return row;
}

// ── Recipe ──────────────────────────────────────────────────────────────────

export function recipeFromRow(row: any): Recipe {
  return {
    id: row.id,
    name: row.name,
    category: row.category ?? "",
    status: (row.status ?? "NEW") as RecipeStatus,
    ingredientLines: (row.recipe_lines ?? [])
      .map((l: any) => lineFromRow(l, "sub_recipe_id"))
      .sort((a: IngredientLine, b: IngredientLine) => a.lineNumber - b.lineNumber),
    portion: {
      yieldQty: num(row.yield_qty, 1),
      yieldUnit: row.yield_unit ?? "por",
    },
    pricing: {
      menuPrice: money(row.menu_price),
      priceInclTax: money(row.price_incl_tax),
      totalCost: money(row.total_cost),
      wasteAmount: money(row.waste_amount),
      inflationAmount: money(row.inflation_amount),
      totalCog: money(row.total_cog),
      grossProfit: money(row.gross_profit),
      grossProfitPercent: num(row.gross_profit_percent),
      foodCostPercent: num(row.food_cost_percent),
      currency: row.currency ?? "IDR",
    },
    wastePercent: num(row.waste_percent, 0),
    inflationPercent: num(row.inflation_percent, 4),
    taxPercent: num(row.tax_percent, 21),
    nutritionPerPortion: nutritionFromRow(row),
    allergens: row.allergens ?? [],
    preparation: preparationFromRow(row),
    dietaryFlags: {
      glutenFree: Boolean(row.gluten_free),
      dairyFree: Boolean(row.dairy_free),
      vegetarian: Boolean(row.vegetarian),
      vegan: Boolean(row.vegan),
      nutsFree: Boolean(row.nuts_free),
      soyFree: Boolean(row.soy_free),
      sulfitesFree: Boolean(row.sulfites_free),
    },
    version: num(row.version, 1),
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
  };
}

export function recipeToRow(r: Partial<Recipe>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (r.name !== undefined) row.name = r.name;
  if (r.category !== undefined) row.category = r.category;
  if (r.status !== undefined) row.status = r.status;
  if (r.allergens !== undefined) row.allergens = r.allergens;
  preparationToRow(r.preparation, row);
  if (r.version !== undefined) row.version = r.version;
  if (r.portion) {
    row.yield_qty = r.portion.yieldQty;
    row.yield_unit = r.portion.yieldUnit;
  }
  if (r.wastePercent !== undefined) row.waste_percent = r.wastePercent;
  if (r.inflationPercent !== undefined)
    row.inflation_percent = r.inflationPercent;
  if (r.taxPercent !== undefined) row.tax_percent = r.taxPercent;
  if (r.pricing) {
    row.menu_price = r.pricing.menuPrice;
    row.price_incl_tax = r.pricing.priceInclTax;
    row.total_cost = r.pricing.totalCost;
    row.waste_amount = r.pricing.wasteAmount;
    row.inflation_amount = r.pricing.inflationAmount;
    row.total_cog = r.pricing.totalCog;
    row.gross_profit = r.pricing.grossProfit;
    row.gross_profit_percent = r.pricing.grossProfitPercent;
    row.food_cost_percent = r.pricing.foodCostPercent;
    row.currency = r.pricing.currency;
  }
  if (r.nutritionPerPortion)
    Object.assign(row, nutritionToRow(r.nutritionPerPortion));
  if (r.dietaryFlags) {
    row.gluten_free = r.dietaryFlags.glutenFree;
    row.dairy_free = r.dietaryFlags.dairyFree;
    row.vegetarian = r.dietaryFlags.vegetarian;
    row.vegan = r.dietaryFlags.vegan;
    row.nuts_free = r.dietaryFlags.nutsFree;
    row.soy_free = r.dietaryFlags.soyFree;
    row.sulfites_free = r.dietaryFlags.sulfitesFree;
  }
  return row;
}
