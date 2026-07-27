// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

import { DEFAULT_CURRENCY } from "./constants";

/**
 * Format a number as currency — e.g. "AED 12.50".
 *
 * @param decimals  Decimal places (default 2). Per-unit ingredient costs are
 *                  fractions of a fils per gram, so those callers pass 4 —
 *                  at 2dp they would all render as "AED 0.00".
 */
export function formatCurrency(
  value: number,
  currency: string = DEFAULT_CURRENCY,
  decimals: number = 2,
): string {
  const formatted = value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${currency} ${formatted}`;
}

/** Format a number as a percentage — e.g. "25.5%" */
export function formatPercent(value: number): string {
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

/**
 * Format a number with locale-appropriate thousands separator.
 * @param decimals  Number of decimal places (default 2)
 */
export function formatNumber(value: number, decimals: number = 2): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format a weight value with its unit — e.g. "250 g", "1.5 kg" */
export function formatWeight(value: number, unit: string): string {
  // Use up to 2 decimal places but strip trailing zeroes
  const formatted = value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${formatted} ${unit}`;
}
