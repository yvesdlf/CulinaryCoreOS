// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

import type Decimal from "decimal.js";
import { DEFAULT_CURRENCY, CURRENCY_LOCALE } from "./constants";

/** Anything money-ish the UI might hold: Decimal, string field, or number. */
export type Formattable = number | string | Decimal;

function toNumber(value: Formattable): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return parseFloat(value);
  return value.toNumber();
}

/**
 * Rupiah is quoted in whole units — Rp 795.000, not Rp 795.000,00. Sub-unit
 * figures (a per-gram ingredient cost) are the exception and pass `decimals`.
 */
const DEFAULT_DECIMALS: Record<string, number> = {
  IDR: 0,
  AED: 2,
  USD: 2,
  EUR: 2,
};

function defaultDecimalsFor(currency: string): number {
  return DEFAULT_DECIMALS[currency] ?? 2;
}

/**
 * Format a value as currency — e.g. "Rp 795.000".
 *
 * @param decimals Overrides the currency's convention. Per-unit ingredient
 *                 costs are fractions of a rupiah per gram, so those callers
 *                 pass 2-4; at 0 they would all render as "Rp 0".
 */
export function formatCurrency(
  value: Formattable,
  currency: string = DEFAULT_CURRENCY,
  decimals?: number,
): string {
  const dp = decimals ?? defaultDecimalsFor(currency);
  const n = toNumber(value);
  if (!Number.isFinite(n)) return "--";

  return new Intl.NumberFormat(CURRENCY_LOCALE, {
    style: "currency",
    currency,
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  }).format(n);
}

/** Format a value as a percentage — e.g. "25,5%" under id-ID. */
export function formatPercent(value: Formattable, decimals = 1): string {
  const n = toNumber(value);
  if (!Number.isFinite(n)) return "--";
  return `${n.toLocaleString(CURRENCY_LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}%`;
}

/** Format a number with locale-appropriate separators. */
export function formatNumber(value: Formattable, decimals = 2): string {
  const n = toNumber(value);
  if (!Number.isFinite(n)) return "--";
  return n.toLocaleString(CURRENCY_LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format a quantity with its unit — e.g. "250 g", "1,5 kg". */
export function formatWeight(value: Formattable, unit: string): string {
  const n = toNumber(value);
  if (!Number.isFinite(n)) return `-- ${unit}`;
  const formatted = n.toLocaleString(CURRENCY_LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${formatted} ${unit}`;
}
