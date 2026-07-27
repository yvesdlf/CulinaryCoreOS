// ---------------------------------------------------------------------------
// Cost calculation engine
// ---------------------------------------------------------------------------
// Money is handled with decimal.js, never with `number`, per docs/DECISIONS.md:
// "DECIMAL for financial calculations — floating point rounding errors are
// unacceptable for money."
//
// Concretely: in binary floating point, 30 * 0.0055 is 0.16499999999999998, so
// a line worth 0.165 renders as "0.16" and every such line drags the batch
// total down by a fils. Decimal arithmetic is exact for these values.
//
// Inputs accept `Decimal.Value` (number | string | Decimal) so callers can pass
// the string-backed money fields straight from the data model. Outputs are
// always `Decimal` — convert at the UI boundary with `toNumber()`/`toFixed()`.
// ---------------------------------------------------------------------------

import Decimal from "decimal.js";

export type Money = Decimal;
export type MoneyInput = Decimal.Value;

const ZERO = new Decimal(0);
const HUNDRED = new Decimal(100);

/** Coerce anything user- or data-supplied into a Decimal, treating junk as 0. */
export function toDecimal(value: MoneyInput | null | undefined): Decimal {
  if (value === null || value === undefined || value === "") return ZERO;
  try {
    const d = new Decimal(value);
    return d.isFinite() ? d : ZERO;
  } catch {
    return ZERO;
  }
}

/**
 * Calculate gross quantity from nett quantity and waste reference %.
 *
 * Formula: (100 * nettQty) / (100 - refPercent)
 */
export function calculateGrossQty(
  nettQty: MoneyInput,
  refPercent: MoneyInput,
): Decimal {
  const divisor = HUNDRED.minus(toDecimal(refPercent));
  if (divisor.lte(0)) return ZERO;
  return HUNDRED.times(toDecimal(nettQty)).dividedBy(divisor);
}

/**
 * Calculate gross quantity and line cost for an ingredient line.
 *
 * lineCost = grossQty * costPerUnit
 */
export function calculateLineCost(
  nettQty: MoneyInput,
  refPercent: MoneyInput,
  costPerUnit: MoneyInput,
): { grossQty: Decimal; lineCost: Decimal } {
  const grossQty = calculateGrossQty(nettQty, refPercent);
  const lineCost = Decimal.max(0, grossQty.times(toDecimal(costPerUnit)));
  return { grossQty, lineCost };
}

/**
 * Sum line costs into a recipe / sub-recipe total.
 *
 * Sums at full precision: rounding each line first would let a half-unit error
 * per line accumulate into the total.
 */
export function calculateRecipeTotalCost(
  lines: { lineCost: MoneyInput }[],
): Decimal {
  return lines.reduce<Decimal>(
    (sum, line) => sum.plus(toDecimal(line.lineCost)),
    ZERO,
  );
}

/** Apply a security margin: totalCost * (1 + marginPercent / 100) */
export function calculateCostWithMargin(
  totalCost: MoneyInput,
  marginPercent: MoneyInput,
): Decimal {
  const factor = new Decimal(1).plus(toDecimal(marginPercent).dividedBy(HUNDRED));
  return Decimal.max(0, toDecimal(totalCost).times(factor));
}

/** Food cost % = (totalCost / sellingPrice) * 100 */
export function calculateFoodCostPercent(
  totalCost: MoneyInput,
  sellingPrice: MoneyInput,
): Decimal {
  const price = toDecimal(sellingPrice);
  if (price.lte(0)) return ZERO;
  return Decimal.max(0, toDecimal(totalCost).dividedBy(price).times(HUNDRED));
}

/** Gross contribution margin = sellingPrice - totalCost */
export function calculateContributionMargin(
  sellingPrice: MoneyInput,
  totalCost: MoneyInput,
): Decimal {
  return Decimal.max(0, toDecimal(sellingPrice).minus(toDecimal(totalCost)));
}

/** Strip VAT from a VAT-inclusive price: priceInclVat / (1 + vatRate / 100) */
export function calculatePriceExclVat(
  priceInclVat: MoneyInput,
  vatRate: MoneyInput,
): Decimal {
  const divisor = new Decimal(1).plus(toDecimal(vatRate).dividedBy(HUNDRED));
  if (divisor.lte(0)) return ZERO;
  return toDecimal(priceInclVat).dividedBy(divisor);
}

/** Sub-recipe cost per unit = totalCost / batchYieldQty */
export function calculateSubRecipeCostPerUnit(
  totalCost: MoneyInput,
  batchYieldQty: MoneyInput,
): Decimal {
  const yieldQty = toDecimal(batchYieldQty);
  if (yieldQty.lte(0)) return ZERO;
  return toDecimal(totalCost).dividedBy(yieldQty);
}

/**
 * Recommended selling price for a target food cost %.
 *
 * price = totalCost / (targetFoodCostPercent / 100)
 */
export function calculateRecommendedPrice(
  totalCost: MoneyInput,
  targetFoodCostPercent: MoneyInput,
): Decimal {
  const target = toDecimal(targetFoodCostPercent);
  if (target.lte(0)) return ZERO;
  return toDecimal(totalCost).dividedBy(target.dividedBy(HUNDRED));
}
