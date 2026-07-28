// ---------------------------------------------------------------------------
// Nutrition calculation engine
// ---------------------------------------------------------------------------

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
 * Union of the allergens of every ingredient, sorted for a stable value.
 *
 * Allergens are inherited, never authored on a recipe: if a sub-recipe
 * contains gluten then so does everything built on it.
 */
/**
 * The "free-from" dietary flags implied by a recipe's allergens.
 *
 * Only the negative claims are derivable: an allergen list tells you what is
 * present, so absence of "gluten" means gluten-free. Vegetarian and vegan
 * cannot be inferred this way — beef carries no allergen — so those stay
 * author-controlled and are passed through by the caller.
 */
export function deriveDietaryFlags(allergens: string[]): {
  glutenFree: boolean;
  dairyFree: boolean;
  nutsFree: boolean;
  soyFree: boolean;
  sulfitesFree: boolean;
} {
  const has = (a: string) => allergens.includes(a);
  return {
    glutenFree: !has("gluten"),
    dairyFree: !has("dairy"),
    nutsFree: !has("nuts"),
    soyFree: !has("soy"),
    sulfitesFree: !has("sulfites"),
  };
}

export function deriveAllergens(
  lines: NutritionLine[],
  sources: {
    getProduct: (id: string) => { allergens?: string[] } | undefined;
    getSubRecipe: (id: string) => { allergens?: string[] } | undefined;
  },
): string[] {
  const found = new Set<string>();
  for (const line of lines) {
    const from = line.productId
      ? sources.getProduct(line.productId)?.allergens
      : line.subRecipeId
        ? sources.getSubRecipe(line.subRecipeId)?.allergens
        : undefined;
    for (const a of from ?? []) found.add(a);
  }
  return [...found].sort();
}
