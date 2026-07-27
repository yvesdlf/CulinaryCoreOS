// ---------------------------------------------------------------------------
// Cost calculation engine
// ---------------------------------------------------------------------------
// All functions handle edge cases: division by zero returns 0, negative
// results are clamped to 0.
// ---------------------------------------------------------------------------

/**
 * Calculate gross quantity from nett quantity and waste reference %.
 *
 * Formula: (100 * nettQty) / (100 - refPercent)
 */
export function calculateGrossQty(
  nettQty: number,
  refPercent: number,
): number {
  const divisor = 100 - refPercent;
  if (divisor <= 0) return 0;
  return (100 * nettQty) / divisor;
}

/**
 * Calculate gross quantity and line cost for an ingredient line.
 *
 * grossQty = calculateGrossQty(nettQty, refPercent)
 * lineCost = grossQty * costPerUnit
 */
export function calculateLineCost(
  nettQty: number,
  refPercent: number,
  costPerUnit: number,
): { grossQty: number; lineCost: number } {
  const grossQty = calculateGrossQty(nettQty, refPercent);
  const lineCost = Math.max(0, grossQty * costPerUnit);
  return { grossQty, lineCost };
}

/** Sum all line costs to get the recipe/sub-recipe total cost. */
export function calculateRecipeTotalCost(
  lines: { lineCost: number }[],
): number {
  return lines.reduce((sum, line) => sum + line.lineCost, 0);
}

/** Apply a security margin to total cost: totalCost * (1 + marginPercent / 100) */
export function calculateCostWithMargin(
  totalCost: number,
  marginPercent: number,
): number {
  return Math.max(0, totalCost * (1 + marginPercent / 100));
}

/** Food cost % = (totalCost / sellingPrice) * 100 */
export function calculateFoodCostPercent(
  totalCost: number,
  sellingPrice: number,
): number {
  if (sellingPrice <= 0) return 0;
  return Math.max(0, (totalCost / sellingPrice) * 100);
}

/** Gross contribution margin = sellingPrice - totalCost */
export function calculateContributionMargin(
  sellingPrice: number,
  totalCost: number,
): number {
  return Math.max(0, sellingPrice - totalCost);
}

/** Strip VAT from a VAT-inclusive price: priceInclVat / (1 + vatRate / 100) */
export function calculatePriceExclVat(
  priceInclVat: number,
  vatRate: number,
): number {
  const divisor = 1 + vatRate / 100;
  if (divisor <= 0) return 0;
  return priceInclVat / divisor;
}

/** Sub-recipe cost per unit = totalCost / batchYieldQty */
export function calculateSubRecipeCostPerUnit(
  totalCost: number,
  batchYieldQty: number,
): number {
  if (batchYieldQty <= 0) return 0;
  return totalCost / batchYieldQty;
}

/**
 * Recommended selling price for a target food cost %.
 *
 * price = totalCost / (targetFoodCostPercent / 100)
 */
export function calculateRecommendedPrice(
  totalCost: number,
  targetFoodCostPercent: number,
): number {
  if (targetFoodCostPercent <= 0) return 0;
  return totalCost / (targetFoodCostPercent / 100);
}
