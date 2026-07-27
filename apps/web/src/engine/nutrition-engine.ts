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
