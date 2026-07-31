// ---------------------------------------------------------------------------
// Nutrition calculation engine
// ---------------------------------------------------------------------------

import { resolveAllergens } from "@/lib/allergens";

/** Nutrition values per 100 g — local definition to avoid import coupling. */
export interface NutritionPer100g {
  fatG: number;
  carbsG: number;
  proteinG: number;
  vitAMg: number;
  vitCMg: number;
  calciumMg: number;
  ironMg: number;
  sodiumMg: number;
  kcal: number;
}

/** A zeroed-out nutrition record. */
export const ZERO_NUTRITION: NutritionPer100g = {
  fatG: 0,
  carbsG: 0,
  proteinG: 0,
  vitAMg: 0,
  vitCMg: 0,
  calciumMg: 0,
  ironMg: 0,
  sodiumMg: 0,
  kcal: 0,
};

/**
 * Scale nutrition values from per-100 g to the actual nett quantity used.
 *
 * Each nutrient = (nutrient per 100 g) * (nettQty / 100)
 */
export function calculateLineNutrition(
  nettQty: number,
  nutritionPer100g: NutritionPer100g,
): NutritionPer100g {
  const factor = nettQty / 100;
  return {
    fatG: nutritionPer100g.fatG * factor,
    carbsG: nutritionPer100g.carbsG * factor,
    proteinG: nutritionPer100g.proteinG * factor,
    vitAMg: nutritionPer100g.vitAMg * factor,
    vitCMg: nutritionPer100g.vitCMg * factor,
    calciumMg: nutritionPer100g.calciumMg * factor,
    ironMg: nutritionPer100g.ironMg * factor,
    sodiumMg: nutritionPer100g.sodiumMg * factor,
    kcal: nutritionPer100g.kcal * factor,
  };
}

/** Sum nutrition across an array of nutrition records. */
export function sumNutrition(items: NutritionPer100g[]): NutritionPer100g {
  return items.reduce<NutritionPer100g>(
    (acc, n) => ({
      fatG: acc.fatG + n.fatG,
      carbsG: acc.carbsG + n.carbsG,
      proteinG: acc.proteinG + n.proteinG,
      vitAMg: acc.vitAMg + n.vitAMg,
      vitCMg: acc.vitCMg + n.vitCMg,
      calciumMg: acc.calciumMg + n.calciumMg,
      ironMg: acc.ironMg + n.ironMg,
      sodiumMg: acc.sodiumMg + n.sodiumMg,
      kcal: acc.kcal + n.kcal,
    }),
    { ...ZERO_NUTRITION },
  );
}

/** Divide total nutrition by number of portions. */
export function calculatePerPortionNutrition(
  totalNutrition: NutritionPer100g,
  portions: number,
): NutritionPer100g {
  if (portions <= 0) return { ...ZERO_NUTRITION };
  return {
    fatG: totalNutrition.fatG / portions,
    carbsG: totalNutrition.carbsG / portions,
    proteinG: totalNutrition.proteinG / portions,
    vitAMg: totalNutrition.vitAMg / portions,
    vitCMg: totalNutrition.vitCMg / portions,
    calciumMg: totalNutrition.calciumMg / portions,
    ironMg: totalNutrition.ironMg / portions,
    sodiumMg: totalNutrition.sodiumMg / portions,
    kcal: totalNutrition.kcal / portions,
  };
}

/**
 * Calculate kcal from macronutrients using the 4-4-9 rule.
 *
 * kcal = fat * 9 + carbs * 4 + protein * 4
 */
export function calculateKcal(
  fatG: number,
  carbsG: number,
  proteinG: number,
): number {
  return fatG * 9 + carbsG * 4 + proteinG * 4;
}

// ── Derivation from ingredient lines ────────────────────────────────────────
// Shared by the nutrition panel and the save handlers. Keeping one
// implementation is the point: when these were separate, the panel computed
// live values while save wrote back the previous ones, so what a chef saw and
// what was stored drifted apart silently.

/** Minimal shapes needed to resolve a line — avoids importing the full types. */
interface NutritionSources {
  getProduct: (id: string) => { nutrition?: NutritionPer100g } | undefined;
  getSubRecipe: (id: string) => { nutritionPer100g?: NutritionPer100g } | undefined;
}

interface NutritionLine {
  productId: string | null;
  subRecipeId: string | null;
  nettQty: number;
}

/** Total nutrition contributed by every line, before any per-portion scaling. */
export function calculateTotalNutrition(
  lines: NutritionLine[],
  sources: NutritionSources,
): NutritionPer100g {
  return sumNutrition(
    lines.map((line) => {
      let per100g: NutritionPer100g = { ...ZERO_NUTRITION };
      if (line.productId) {
        per100g = sources.getProduct(line.productId)?.nutrition ?? per100g;
      } else if (line.subRecipeId) {
        per100g =
          sources.getSubRecipe(line.subRecipeId)?.nutritionPer100g ?? per100g;
      }
      return calculateLineNutrition(line.nettQty, per100g);
    }),
  );
}

/**
 * How much of a dish the nutrition figures actually account for.
 *
 * Every one of the 1.106 imported ingredients arrived with no nutrition data,
 * so the panel showed a confident "0 kcal" on a wagyu dish. Zero is a number,
 * and presenting an absence as one is the same failure as a recipe claiming to
 * be gluten-free because nobody filled in its allergens.
 *
 * `withData` counts lines whose source carries any nutrition at all, so a
 * caller can tell "this dish has no calories" from "nobody has entered any".
 */
export function nutritionCoverage(
  lines: NutritionLine[],
  sources: NutritionSources,
): { withData: number; total: number } {
  let withData = 0;
  for (const line of lines) {
    const n = line.productId
      ? sources.getProduct(line.productId)?.nutrition
      : line.subRecipeId
        ? sources.getSubRecipe(line.subRecipeId)?.nutritionPer100g
        : undefined;
    // kcal alone is not enough: it is derived from the macros, so a row with
    // macros and an unset kcal still counts as having data.
    if (n && (n.kcal > 0 || n.fatG > 0 || n.carbsG > 0 || n.proteinG > 0)) {
      withData++;
    }
  }
  return { withData, total: lines.length };
}

/** Nutrition for one portion of a recipe. */
export function deriveRecipeNutrition(
  lines: NutritionLine[],
  portions: number,
  sources: NutritionSources,
): NutritionPer100g {
  const total = calculateTotalNutrition(lines, sources);
  return portions > 0 ? calculatePerPortionNutrition(total, portions) : total;
}

/**
 * Nutrition per 100 g of a sub-recipe batch.
 *
 * The batch total is divided by however many 100 g units the batch yields —
 * not by a portion count, which is why this is a separate entry point.
 */
export function deriveSubRecipeNutrition(
  lines: NutritionLine[],
  batchQty: number,
  sources: NutritionSources,
): NutritionPer100g {
  const total = calculateTotalNutrition(lines, sources);
  const hundredGramUnits = batchQty / 100;
  return hundredGramUnits > 0
    ? calculatePerPortionNutrition(total, hundredGramUnits)
    : { ...ZERO_NUTRITION };
}

/**
 * The "free-from" dietary flags implied by a recipe's allergens.
 *
 * Only the negative claims are derivable: an allergen list tells you what is
 * present, so absence of gluten means gluten-free. Vegetarian and vegan cannot
 * be inferred this way — beef carries no allergen — so those stay
 * author-controlled and are passed through by the caller.
 *
 * Resolution goes through the EU14 registry rather than matching literal
 * strings. This previously tested for "gluten" and "dairy", which are aliases
 * and not what anything actually stores: the real catalogue carries
 * EU14_GLUTEN_CEREALS and EU14_MILK, so every imported dish claimed to be
 * gluten-free and dairy-free no matter what was in it.
 *
 * An allergen we cannot map fails every claim closed. "Free from" is an
 * assertion about the absence of something, and an unrecognised declaration is
 * precisely the case where absence is not established.
 */
export function deriveDietaryFlags(allergens: string[]): {
  glutenFree: boolean;
  dairyFree: boolean;
  nutsFree: boolean;
  soyFree: boolean;
  sulfitesFree: boolean;
} {
  const resolved = resolveAllergens(allergens);
  const anyUnknown = resolved.some((r) => !r.known);
  const ids = new Set(
    resolved.filter((r) => r.known).map((r) => r.definition.id),
  );
  const free = (...of: string[]) =>
    !anyUnknown && !of.some((id) => ids.has(id));

  return {
    glutenFree: free("EU14_GLUTEN_CEREALS"),
    dairyFree: free("EU14_MILK"),
    // Legally distinct allergens, but one colloquial claim: "nut free" is
    // untrue if either is present.
    nutsFree: free("EU14_TREE_NUTS", "EU14_PEANUTS"),
    soyFree: free("EU14_SOYBEANS"),
    sulfitesFree: free("EU14_SULPHITES"),
  };
}

/**
 * Union of the allergens of every ingredient, in registry order.
 *
 * Allergens are inherited, never authored: if a sub-recipe contains gluten then
 * so does everything built on it.
 *
 * Values are canonicalised to registry ids on the way through, so a product
 * declaring "dairy" and one declaring "EU14_MILK" collapse to one entry instead
 * of showing the same allergen twice. Anything unmappable is kept verbatim —
 * dropping a declaration we do not understand is a safety failure.
 */
export function deriveAllergens(
  lines: NutritionLine[],
  sources: {
    getProduct: (id: string) => { allergens?: string[] } | undefined;
    getSubRecipe: (id: string) => { allergens?: string[] } | undefined;
  },
): string[] {
  const found: string[] = [];
  for (const line of lines) {
    const from = line.productId
      ? sources.getProduct(line.productId)?.allergens
      : line.subRecipeId
        ? sources.getSubRecipe(line.subRecipeId)?.allergens
        : undefined;
    for (const a of from ?? []) found.push(a);
  }
  return resolveAllergens(found).map((r) =>
    r.known ? r.definition.id : r.raw,
  );
}
