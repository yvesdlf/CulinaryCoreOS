// ---------------------------------------------------------------------------
// Turning one unit into another
// ---------------------------------------------------------------------------
// Before this, costing did not reconcile units at all. `calculateLineCost`
// takes a quantity and a cost per unit and multiplies them, and nothing
// anywhere compares the recipe line's unit against the unit the product is
// priced in. A line reading "0.2 kg" against a product priced per gram costs
// a thousandth of the truth, silently, and a dish built from it reads as
// almost free.
//
// That has not yet produced a wrong number in this database — every one of
// the existing recipe lines happens to carry its product's own unit, because
// the import writes it there. It is latent, not harmless: it goes wrong the
// first time somebody types a unit by hand.
//
// Four ways to get from one unit to another, tried in this order:
//
//   1. They are the same unit. No arithmetic, so no rounding.
//   2. A global conversion — kg to g, litre to ml. Physics, identical for
//      every product and every venue.
//   3. A conversion recorded against this product — "1 bunch = 80 g",
//      "1 egg = 55 g". The brief's motivating case, and the reason this file
//      exists: no amount of general knowledge converts a bunch.
//   4. Density, where the product has one, for crossing between mass and
//      volume — 1 ml of honey is not 1 g.
//
// Global before product-specific on purpose, and the brief orders it that way
// too. A venue that fat-fingers "1 kg = 100 g" into its own conversion table
// should not thereby redefine the kilogram; the one that is the same
// everywhere wins, and the one somebody typed is only consulted where there
// is no general answer.
//
// Nothing here guesses. Where there is no path, it says so and names both
// units, because the alternative — the one this replaces — is costing the
// line at a number that is wrong without saying anything. `AGENTS.md` §8
// makes the same argument about allergens: silence is not a claim, and a
// confident wrong answer is worse than an admitted gap.
// ---------------------------------------------------------------------------

import Decimal from "decimal.js";

/** A conversion a venue has recorded for one of its own products. */
export interface ProductConversion {
  fromUnit: string;
  toUnit: string;
  /** How many `toUnit` in one `fromUnit`. String-backed: it is `numeric`. */
  factor: Decimal.Value;
}

export type ConversionRoute = "identical" | "global" | "product" | "density";

export type ConversionResult =
  | { ok: true; factor: Decimal; via: ConversionRoute }
  /**
   * A typed refusal rather than a thrown error or a zero. The recipe screen
   * shows the line in a warning state and the "missing conversions" report
   * lists it; neither can happen if the failure is a silent 0.
   */
  | { ok: false; reason: "unresolved"; from: string; to: string };

/**
 * Spellings seen in the source workbooks and in supplier price lists. Folded
 * rather than rejected, because refusing "Gr" would push somebody to retype
 * the quantity in a unit they did not mean.
 */
const ALIASES: Record<string, string> = {
  g: "g", gr: "g", gram: "g", grams: "g", gramme: "g", grammes: "g",
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg",
  mg: "mg", milligram: "mg", milligrams: "mg",
  ml: "ml", milliliter: "ml", millilitre: "ml", milliliters: "ml", millilitres: "ml",
  cl: "cl", centiliter: "cl", centilitre: "cl",
  l: "l", lt: "l", ltr: "l", liter: "l", litre: "l", liters: "l", litres: "l",
};

/** Everything mass in grams, everything volume in millilitres. */
const BASE: Record<string, { dimension: "mass" | "volume"; inBase: Decimal }> = {
  mg: { dimension: "mass", inBase: new Decimal("0.001") },
  g: { dimension: "mass", inBase: new Decimal(1) },
  kg: { dimension: "mass", inBase: new Decimal(1000) },
  ml: { dimension: "volume", inBase: new Decimal(1) },
  cl: { dimension: "volume", inBase: new Decimal(10) },
  l: { dimension: "volume", inBase: new Decimal(1000) },
};

/**
 * The canonical spelling of a unit, or the trimmed lower-case original where
 * it is not one this file knows — "bunch", "piece", "egg". Those are perfectly
 * good units; they simply have no general conversion.
 */
export function normaliseUnit(unit: string | null | undefined): string {
  const trimmed = (unit ?? "").trim().toLowerCase();
  if (trimmed === "") return "";
  return ALIASES[trimmed] ?? trimmed;
}

function globalFactor(from: string, to: string): Decimal | null {
  const a = BASE[from];
  const b = BASE[to];
  if (!a || !b) return null;
  if (a.dimension !== b.dimension) return null;   // Needs a density. See below.
  return a.inBase.dividedBy(b.inBase);
}

/**
 * How many `to` units are in one `from` unit, for this product.
 *
 * `conversions` are the rows recorded against the product. `densityGPerMl` is
 * its density where one is known. Both are optional: most products need
 * neither.
 */
export function convertUnit(
  from: string | null | undefined,
  to: string | null | undefined,
  options: {
    conversions?: readonly ProductConversion[];
    densityGPerMl?: Decimal.Value | null;
  } = {},
): ConversionResult {
  const a = normaliseUnit(from);
  const b = normaliseUnit(to);

  // An empty unit is not the same as an unknown one, and pretending a blank
  // matches a blank would convert "no unit recorded" into a factor of 1.
  if (a === "" || b === "") {
    return { ok: false, reason: "unresolved", from: a, to: b };
  }

  if (a === b) return { ok: true, factor: new Decimal(1), via: "identical" };

  const global = globalFactor(a, b);
  if (global) return { ok: true, factor: global, via: "global" };

  // 3 · This product's own. Either direction: "1 bunch = 80 g" also answers
  // "how many bunches in a gram", and making somebody record both rows is how
  // the second one ends up disagreeing with the first.
  for (const c of options.conversions ?? []) {
    const cf = normaliseUnit(c.fromUnit);
    const ct = normaliseUnit(c.toUnit);
    const factor = new Decimal(c.factor);
    if (!factor.isFinite() || factor.lessThanOrEqualTo(0)) continue;
    if (cf === a && ct === b) return { ok: true, factor, via: "product" };
    if (cf === b && ct === a) {
      return { ok: true, factor: new Decimal(1).dividedBy(factor), via: "product" };
    }
  }

  /*
   * 4 · Density, only for crossing mass and volume.
   *
   * Reached after the product's own rows, so a venue that has measured its
   * own flour in cups is not overruled by a general figure. The arithmetic
   * goes through the base units — grams and millilitres — so that kg to l
   * works without a second rule.
   */
  const density = options.densityGPerMl == null ? null : new Decimal(options.densityGPerMl);
  const da = BASE[a];
  const db = BASE[b];
  if (density && density.isFinite() && density.greaterThan(0) && da && db) {
    if (da.dimension === "volume" && db.dimension === "mass") {
      // ml -> g -> target mass unit
      return {
        ok: true,
        factor: da.inBase.times(density).dividedBy(db.inBase),
        via: "density",
      };
    }
    if (da.dimension === "mass" && db.dimension === "volume") {
      return {
        ok: true,
        factor: da.inBase.dividedBy(density).dividedBy(db.inBase),
        via: "density",
      };
    }
  }

  return { ok: false, reason: "unresolved", from: a, to: b };
}

/**
 * The quantity itself, converted.
 *
 * Separate from `convertUnit` because the factor is worth having on its own —
 * the recipe screen shows it, and a report counts lines by route — and
 * because a caller that only wants the number should not have to remember to
 * multiply.
 */
export function convertQuantity(
  quantity: Decimal.Value,
  from: string | null | undefined,
  to: string | null | undefined,
  options: Parameters<typeof convertUnit>[2] = {},
): ConversionResult & { quantity?: Decimal } {
  const resolved = convertUnit(from, to, options);
  if (!resolved.ok) return resolved;
  return { ...resolved, quantity: new Decimal(quantity).times(resolved.factor) };
}

/** What to put on screen when a line cannot be costed. */
export function unresolvedMessage(result: {
  from: string;
  to: string;
}): string {
  return `No way to convert ${result.from || "(no unit)"} to ${
    result.to || "(no unit)"
  }. Record a conversion for this product.`;
}
