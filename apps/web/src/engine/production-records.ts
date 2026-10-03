// ---------------------------------------------------------------------------
// Production records — SRS PRO-FUNC-002 AC6, INV-FUNC-005
// ---------------------------------------------------------------------------
// Recording what was actually made, and setting it against what the recipes
// said should have been used.
//
// Three positions worth stating, because each is a place where the easy answer
// is the wrong one:
//
//   A batch cannot be recorded in a unit the preparation does not yield in.
//   The planner already refuses to add grams to kilograms for one ingredient
//   and says so; the same line is held here, and the database holds it again
//   so neither screen nor script can get round it. Two batches of a 2 kg
//   preparation entered as 2 g understates everything downstream by a factor
//   of a thousand, and every figure that follows stays plausible.
//
//   A preparation with no batch yield cannot be recorded at all, and is said
//   to be unrecordable rather than offered with a zero. "Nobody set a yield"
//   and "it yields nothing" are different statements.
//
//   A variance that cannot be computed is reported as not comparable, never as
//   zero or as a hundred per cent. No production recorded, nothing taken from
//   the ledger, or two different units for one ingredient — in all three cases
//   the honest answer is that the question cannot be answered yet, and that is
//   the finding.
//
// Money is decimal.js throughout. Quantities stay plain numbers, as everywhere
// else here, except where a difference between two of them is displayed:
// `4 - 20.87` in binary floating point is `-16.869999999999997`.
// ---------------------------------------------------------------------------

import type { Product, SubRecipe } from "@ccos/shared";
import { toDecimal } from "./cost-engine";
import type { PrepTask } from "./production";

/** The unit the ledger counts a product in. */
export function stockUnitOf(product: Product): string {
  return product.stockUnit ?? product.packing.totalUnit;
}

export interface ConsumptionLine {
  productId: string;
  productName: string;
  /** Positive: what comes off the shelf. The ledger holds the sign. */
  quantity: number;
  unit: string;
  unitCost: string;
  /** What this will cost the kitchen, at the current price. */
  lineCost: string;
}

export interface ProposedCompletion {
  subRecipe: SubRecipe;
  batches: number;
  unit: string;
  quantityMade: number;
  consumption: ConsumptionLine[];
  /**
   * What could not be worked out. A prep cook who cannot see this is recording
   * a figure the database will refuse, or worse, accept.
   */
  problems: string[];
}

/**
 * Why a preparation cannot be recorded, or null when it can.
 *
 * Separate from the proposal so a screen can disable the action and say why in
 * the same breath. An action that fails on click, with the reason arriving as
 * a toast, teaches people the screen is unreliable.
 */
export function unrecordableReason(sub: SubRecipe): string | null {
  if (!sub.batchYield.qty || sub.batchYield.qty <= 0) {
    return `${sub.name} has no batch yield, so there is no quantity a batch of it makes. Set one on the preparation first.`;
  }
  if (!sub.batchYield.unit.trim()) {
    return `${sub.name} has a batch yield with no unit, so what it made cannot be added to anything.`;
  }
  return null;
}

/**
 * What a given number of batches consumes, ready to be adjusted by hand.
 *
 * Gross quantity, not nett: the ledger records what left the shelf, and trim
 * leaves the shelf. Pre-filling the nett figure would make every vegetable
 * look over-portioned the moment the cook accepted the default.
 *
 * Lines that reference another preparation are left out rather than exploded.
 * The stock ledger knows nothing about preparations, and the inner one carries
 * its own completion record with its own ingredients — exploding here would
 * count those ingredients twice.
 */
export function proposeCompletion(
  sub: SubRecipe,
  batches: number,
  products: Product[],
): ProposedCompletion {
  const byId = new Map(products.map((p) => [p.id, p]));
  const problems: string[] = [];
  const blocked = unrecordableReason(sub);
  if (blocked) problems.push(blocked);

  const consumption: ConsumptionLine[] = [];
  for (const line of sub.ingredientLines) {
    if (line.subRecipeId) continue;
    if (!line.productId) continue;
    const product = byId.get(line.productId);
    if (!product) {
      problems.push(
        `${sub.name} uses an ingredient that no longer exists, so what it consumed is incomplete.`,
      );
      continue;
    }
    const unit = stockUnitOf(product);
    if (unit.trim().toLowerCase() !== line.grossUnit.trim().toLowerCase()) {
      // Refused rather than converted. A conversion factor guessed from two
      // unit names is how grams become kilograms, and the figure that comes
      // out is wrong by a thousand with nothing on screen to say so.
      problems.push(
        `${product.name} is measured in ${line.grossUnit} in ${sub.name} and held in ${unit} ` +
          `on the shelf, so what the batch consumed cannot be filled in. Record it by hand.`,
      );
      continue;
    }
    const quantity = round(line.grossQty * batches);
    consumption.push({
      productId: product.id,
      productName: product.name,
      quantity,
      unit,
      unitCost: product.cost.grossPricePerUnit,
      lineCost: toDecimal(product.cost.grossPricePerUnit).times(quantity).toFixed(2),
    });
  }

  return {
    subRecipe: sub,
    batches,
    unit: sub.batchYield.unit,
    quantityMade: round(batches * (sub.batchYield.qty || 0)),
    consumption,
    problems,
  };
}

/**
 * Which lot a batch most likely came off.
 *
 * Without a lot on the consumption, the forward step of Regulation 178/2002
 * Article 18 stays broken: the ledger knows a batch used 650 g of butter and
 * not which delivery it came from, so a recall cannot be followed to the
 * plate. Leaving the field blank by default guarantees that, which is the
 * thing this work exists to fix — so a suggestion is made and shown, and the
 * cook can change it.
 *
 * First expired, first out, which is the rule a kitchen is meant to follow
 * anyway. A lot that is not OK is never suggested: the database refuses to
 * consume one, and proposing a write that will be refused is worse than
 * proposing nothing.
 */
export interface LotChoice {
  id: string;
  productId: string;
  lotCode: string;
  receivedOn: string;
  expiresOn: string | null;
  status: string;
}

export function suggestLot(lots: LotChoice[]): LotChoice | null {
  const usable = lots.filter((l) => l.status === "OK");
  if (usable.length === 0) return null;
  return [...usable].sort((a, b) => {
    // A lot with no date is not a lot that never expires. It sorts last,
    // because nothing can be said about how urgent it is.
    if (a.expiresOn !== b.expiresOn) {
      if (a.expiresOn === null) return 1;
      if (b.expiresOn === null) return -1;
      return a.expiresOn < b.expiresOn ? -1 : 1;
    }
    if (a.receivedOn !== b.receivedOn) return a.receivedOn < b.receivedOn ? -1 : 1;
    return a.lotCode.localeCompare(b.lotCode);
  })[0];
}

/** What the whole proposal costs, at current prices. */
export function completionCost(proposal: ProposedCompletion): string {
  return proposal.consumption
    .reduce((acc, l) => acc.plus(toDecimal(l.lineCost)), toDecimal(0))
    .toFixed(2);
}

/**
 * Prep tasks a cook can tick off, with the ones they cannot and why.
 *
 * The planner's sheet and the recording screen are the same list, so the
 * reason a row has no button sits on the row rather than somewhere else.
 */
export interface RecordableTask {
  task: PrepTask;
  recordable: boolean;
  reason: string | null;
  /** Batches already recorded against this preparation today. */
  batchesRecorded: number;
}

export function recordableTasks(
  prep: PrepTask[],
  recordedBatches: Map<string, number>,
): RecordableTask[] {
  return prep.map((task) => {
    const reason = unrecordableReason(task.subRecipe);
    return {
      task,
      recordable: reason === null,
      reason,
      batchesRecorded: recordedBatches.get(task.subRecipe.id) ?? 0,
    };
  });
}

// ── The variance report ─────────────────────────────────────────────────────

/** One row as the database computes it. Nulls are "not known", never zero. */
export interface VarianceRow {
  productId: string;
  productName: string;
  category: string | null;
  unit: string;
  theoreticalQty: number | null;
  actualQty: number | null;
  actualQtyUnlinked: number;
  varianceQty: number | null;
  variancePercent: number | null;
  unitCost: string;
  theoreticalCost: string | null;
  actualCost: string | null;
  varianceCost: string | null;
  batchesRecorded: number;
  movements: number;
  recipeChanged: boolean;
  comparable: boolean;
  note: string | null;
}

export type VarianceVerdict =
  /** Used materially more than the recipes expect. */
  | "over"
  /** Used materially less. Not good news by default — see below. */
  | "under"
  | "within"
  /** The two sides cannot be set against each other at all. */
  | "incomparable";

/**
 * How to read one row.
 *
 * A tolerance exists because without one every rounding difference is a
 * finding, and a report that paints a kitchen weighing to the gram red is a
 * report nobody opens twice. It comes from the venue's own parameter rather
 * than being compiled in.
 *
 * Under-usage is flagged as loudly as over-usage. The comfortable reading is
 * that the kitchen is being careful; the likelier ones are a batch that was
 * never recorded, a short-measured recipe, or stock leaving by a route the
 * ledger has not been told about. Either way somebody should look.
 */
export function varianceVerdict(
  row: VarianceRow,
  tolerancePercent: number,
): VarianceVerdict {
  if (!row.comparable || row.variancePercent === null) return "incomparable";
  if (Math.abs(row.variancePercent) <= tolerancePercent) return "within";
  return row.variancePercent > 0 ? "over" : "under";
}

/**
 * What to show first.
 *
 * Money, descending, because that is the order somebody acts in: a 400 of
 * over-portioned butter outranks a 2 discrepancy on salt however large the
 * percentage. Rows that cannot be compared sit under the material findings and
 * above the ones inside tolerance — a missing record is a real problem and
 * must not be buried, but it is not more urgent than a known loss.
 */
export function compareVarianceRows(
  a: VarianceRow,
  b: VarianceRow,
  tolerancePercent: number,
): number {
  const rank = (row: VarianceRow) => {
    switch (varianceVerdict(row, tolerancePercent)) {
      case "over":
      case "under":
        return 0;
      case "incomparable":
        return 1;
      default:
        return 2;
    }
  };
  const byRank = rank(a) - rank(b);
  if (byRank !== 0) return byRank;

  const money = (row: VarianceRow) =>
    row.varianceCost === null ? toDecimal(0) : toDecimal(row.varianceCost).abs();
  const diff = money(b).minus(money(a));
  if (!diff.isZero()) return diff.isPositive() ? 1 : -1;
  return a.productName.localeCompare(b.productName);
}

export interface VarianceSummary {
  /** Ingredients where both sides are known. */
  comparable: number;
  /** Ingredients where they are not, which is a data finding in itself. */
  incomparable: number;
  over: number;
  under: number;
  within: number;
  /** Net money difference across the comparable rows. */
  netCost: string;
  /** Money lost on the rows that used more than expected. */
  overCost: string;
  /** Preparations edited since a batch of them was recorded. */
  recipeChanged: number;
}

/**
 * The figures above the table.
 *
 * `netCost` and `overCost` are both given on purpose. A net close to zero can
 * hide a large overrun on one ingredient cancelled by an unrecorded batch of
 * another, and netting them off is how a usage report ends up reassuring.
 */
export function summariseVariance(
  rows: VarianceRow[],
  tolerancePercent: number,
): VarianceSummary {
  const summary: VarianceSummary = {
    comparable: 0,
    incomparable: 0,
    over: 0,
    under: 0,
    within: 0,
    netCost: "0.00",
    overCost: "0.00",
    recipeChanged: 0,
  };
  let net = toDecimal(0);
  let over = toDecimal(0);

  for (const row of rows) {
    if (row.recipeChanged) summary.recipeChanged += 1;
    const verdict = varianceVerdict(row, tolerancePercent);
    if (verdict === "incomparable") {
      summary.incomparable += 1;
      continue;
    }
    summary.comparable += 1;
    if (verdict === "over") summary.over += 1;
    else if (verdict === "under") summary.under += 1;
    else summary.within += 1;

    const cost = toDecimal(row.varianceCost ?? 0);
    net = net.plus(cost);
    if (cost.isPositive()) over = over.plus(cost);
  }

  summary.netCost = net.toFixed(2);
  summary.overCost = over.toFixed(2);
  return summary;
}

/** Kitchen quantities to three decimals — a scale does not do more. */
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
