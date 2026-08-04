// ---------------------------------------------------------------------------
// Inventory — SRS 4.10
// ---------------------------------------------------------------------------
// Stock is the sum of a product's movements, never a stored number. A count, a
// delivery and a spillage are the same kind of fact differing only in reason,
// and "why is this 4 kg short" stays answerable a week later.
//
// Money uses decimal.js like everything else here. Quantities are plain
// numbers: they are measured, not computed from other money, and a kitchen
// scale does not have five decimal places.
// ---------------------------------------------------------------------------

import type { Product } from "@ccos/shared";
import { toDecimal } from "./cost-engine";

export type MovementKind =
  | "RECEIPT"
  | "WASTE"
  | "USAGE"
  | "COUNT"
  | "TRANSFER"
  | "RETURN";

export interface StockMovement {
  id: string;
  productId: string;
  kind: MovementKind;
  /** Signed: positive adds, negative removes. */
  quantity: number;
  unit: string;
  unitCost: string | null;
  reason: string | null;
  note: string | null;
  occurredAt: string;
  actorEmail: string | null;
}

export type ParStatus = "unmanaged" | "out" | "reorder" | "low" | "ok";

export interface StockLine {
  product: Product;
  onHand: number;
  status: ParStatus;
  /** How much to buy to reach par. Zero when nothing is needed. */
  suggestedOrder: number;
  /** On-hand at the current price. */
  value: string;
  lastMovementAt: string | null;
}

/**
 * Where a product sits against its par level.
 *
 * A product with no par is "unmanaged" rather than "out of stock": most of a
 * 1.100-line catalogue is bought to order, and showing a thousand spices as
 * critically low would bury the twelve things that are.
 */
export function parStatus(
  onHand: number,
  parLevel: number | null,
  reorderPoint: number | null,
): ParStatus {
  if (parLevel === null || parLevel <= 0) return "unmanaged";
  if (onHand <= 0) return "out";
  // Half of par is the conventional default when nobody has set a point.
  const reorder = reorderPoint ?? parLevel / 2;
  if (onHand <= reorder) return "reorder";
  if (onHand < parLevel) return "low";
  return "ok";
}

/** Rank for sorting: the things needing attention first. */
export const PAR_ORDER: Record<ParStatus, number> = {
  out: 0,
  reorder: 1,
  low: 2,
  ok: 3,
  unmanaged: 4,
};

/**
 * Build the stock picture for a catalogue.
 *
 * `levels` comes from the database view rather than being recomputed here —
 * summing every movement in the browser would mean shipping the whole ledger
 * to draw one page.
 */
export function buildStockLines(
  products: Product[],
  levels: Map<string, { onHand: number; lastMovementAt: string | null }>,
): StockLine[] {
  return products
    .map((product) => {
      const level = levels.get(product.id);
      const onHand = level?.onHand ?? 0;
      const status = parStatus(onHand, product.parLevel, product.reorderPoint);
      return {
        product,
        onHand,
        status,
        /*
         * Never negative: a suggestion to order minus three kilos is noise.
         *
         * Subtracted in decimal for the same reason the count variance is —
         * `20 - 5.47` in binary floating point is 14.530000000000001, and an
         * order column reading that beside a clean par of 20 looks like the
         * app cannot do arithmetic.
         */
        suggestedOrder:
          status === "ok" || status === "unmanaged"
            ? 0
            : Math.max(
                0,
                toDecimal(product.parLevel ?? 0)
                  .minus(onHand)
                  .toDecimalPlaces(4)
                  .toNumber(),
              ),
        value: toDecimal(product.cost.grossPricePerUnit)
          .times(Math.max(0, onHand))
          .toFixed(2),
        lastMovementAt: level?.lastMovementAt ?? null,
      };
    })
    .sort(
      (a, b) =>
        PAR_ORDER[a.status] - PAR_ORDER[b.status] ||
        a.product.name.localeCompare(b.product.name),
    );
}

export interface CountVariance {
  product: Product;
  expected: number;
  counted: number;
  /** counted - expected. Negative means less on the shelf than the books say. */
  variance: number;
  /** The variance valued at the current price, signed the same way. */
  valueDelta: string;
  /** Fraction of expected, for spotting the ones worth investigating. */
  percent: number;
}

/**
 * Compare a physical count against the books — SRS INV-FUNC-002 AC4.
 *
 * A zero variance is dropped: a count sheet of two hundred lines where six
 * disagree should show six, and the rest is noise that hides them.
 */
export function countVariances(
  counts: { productId: string; counted: number }[],
  products: Product[],
  levels: Map<string, { onHand: number }>,
): CountVariance[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const out: CountVariance[] = [];

  for (const c of counts) {
    const product = byId.get(c.productId);
    if (!product) continue;
    const expected = levels.get(c.productId)?.onHand ?? 0;
    /*
     * Subtracted in decimal, not in binary floating point.
     *
     * `4 - 20.87` is -16.869999999999997, and a count sheet full of measured
     * quantities produced a variance column reading "-15.670000000000002".
     * That is not a rounding subtlety anybody needs to see on a stock report;
     * it reads as a broken number and undermines the figure beside it.
     *
     * Four places, which is finer than any unit a kitchen counts in and coarse
     * enough that the artefact is gone.
     */
    const variance = toDecimal(c.counted)
      .minus(expected)
      .toDecimalPlaces(4)
      .toNumber();
    if (variance === 0) continue;
    out.push({
      product,
      expected,
      counted: c.counted,
      variance,
      valueDelta: toDecimal(product.cost.grossPricePerUnit)
        .times(variance)
        .toFixed(2),
      // Against expected, so a shelf that should hold 2 and holds 0 reads as
      // -100% rather than as a small absolute number nobody looks at.
      percent: expected > 0 ? (variance / expected) * 100 : 0,
    });
  }

  // Biggest money difference first — that is what an investigation starts with.
  return out.sort(
    (a, b) => Math.abs(Number(b.valueDelta)) - Math.abs(Number(a.valueDelta)),
  );
}

/** Total value of everything on hand. */
export function stockValue(lines: StockLine[]): string {
  return lines
    .reduce((acc, l) => acc.plus(toDecimal(l.value)), toDecimal(0))
    .toFixed(2);
}

/** Waste in a period, valued at what it cost when it happened. */
export function wasteValue(movements: StockMovement[]): string {
  return movements
    .filter((m) => m.kind === "WASTE")
    .reduce(
      // unitCost is captured on the movement, so last month's waste stays
      // valued at last month's price.
      (acc, m) => acc.plus(toDecimal(m.unitCost ?? 0).times(Math.abs(m.quantity))),
      toDecimal(0),
    )
    .toFixed(2);
}
