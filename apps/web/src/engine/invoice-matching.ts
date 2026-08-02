// ---------------------------------------------------------------------------
// Three-way matching and budget control
// ---------------------------------------------------------------------------
// Most of the value in accounts payable is not in the invoices that agree.
// Those could be paid by a script. It is in the ones that do not, and in
// refusing to pay them quietly.
//
// So matching produces exceptions as data rather than a pass/fail: each one
// names what disagreed, by how much, and against which document, because an
// invoice held for "mismatch" tells a supplier nothing and a buyer less.
//
// Tolerances are percentage OR absolute, whichever is more generous. A five
// rupiah rounding difference on a small line is not worth a person's time; two
// percent on a large one is. Using only a percentage makes small lines
// hypersensitive, and only an absolute makes large ones blind.
// ---------------------------------------------------------------------------

import { toDecimal } from "./cost-engine";

export type ExceptionKind =
  | "NO_ORDER"
  | "PRICE_ABOVE_ORDER"
  | "QUANTITY_ABOVE_ORDER"
  | "QUANTITY_ABOVE_RECEIVED"
  | "NOT_RECEIVED"
  | "LINE_NOT_ON_ORDER"
  | "DUPLICATE_INVOICE"
  | "TOTAL_MISMATCH";

export interface MatchException {
  kind: ExceptionKind;
  /** Which invoice line, when the problem is on one. */
  lineNumber: number | null;
  description: string;
  /** What the money difference is, where the exception is about money. */
  variance: string | null;
}

export interface Tolerances {
  pricePercent: number;
  priceAbsolute: string;
  quantityPercent: number;
  quantityAbsolute: number;
}

export const DEFAULT_TOLERANCES: Tolerances = {
  pricePercent: 2,
  priceAbsolute: "5000",
  quantityPercent: 2,
  quantityAbsolute: 0.5,
};

export interface OrderLine {
  id: string;
  description: string | null;
  quantity: number;
  unitPrice: string;
  quantityReceived: number;
}

export interface InvoiceLine {
  lineNumber: number;
  purchaseOrderLineId: string | null;
  description: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

export interface MatchInput {
  invoiceNumber: string;
  supplierId: string;
  orderLines: OrderLine[] | null;
  invoiceLines: InvoiceLine[];
  invoiceTotal: string;
  /** Invoice numbers already recorded for this supplier. */
  existingInvoiceNumbers: string[];
  tolerances?: Tolerances;
}

/** Within tolerance if either the percentage or the absolute allowance covers it. */
function withinTolerance(
  expected: number,
  actual: number,
  percent: number,
  absolute: number,
): boolean {
  const difference = Math.abs(actual - expected);
  if (difference <= absolute) return true;
  if (expected === 0) return difference === 0;
  return (difference / Math.abs(expected)) * 100 <= percent;
}

/**
 * Check an invoice against its order and what was received.
 *
 * Only overcharges and over-deliveries are exceptions. An invoice for less
 * than was ordered is normal — a partial delivery, a short shipment — and
 * flagging it would train people to click past the warnings that matter.
 */
export function matchInvoice(input: MatchInput): MatchException[] {
  const tol = input.tolerances ?? DEFAULT_TOLERANCES;
  const exceptions: MatchException[] = [];

  const duplicate = input.existingInvoiceNumbers.some(
    (n) => n.trim().toLowerCase() === input.invoiceNumber.trim().toLowerCase(),
  );
  if (duplicate) {
    // Paying the same invoice twice is the most expensive mistake in AP, so
    // this is reported first and never softened by a tolerance.
    exceptions.push({
      kind: "DUPLICATE_INVOICE",
      lineNumber: null,
      description: `Invoice ${input.invoiceNumber} has already been recorded for this supplier.`,
      variance: null,
    });
  }

  if (!input.orderLines) {
    exceptions.push({
      kind: "NO_ORDER",
      lineNumber: null,
      description:
        "This invoice is not linked to a purchase order, so it cannot be matched.",
      variance: null,
    });
    return exceptions;
  }

  const byId = new Map(input.orderLines.map((l) => [l.id, l]));

  for (const line of input.invoiceLines) {
    const order = line.purchaseOrderLineId
      ? byId.get(line.purchaseOrderLineId)
      : undefined;

    if (!order) {
      exceptions.push({
        kind: "LINE_NOT_ON_ORDER",
        lineNumber: line.lineNumber,
        description: `"${line.description ?? "This line"}" does not appear on the order.`,
        variance: toDecimal(line.lineTotal).toFixed(2),
      });
      continue;
    }

    const ordered = toDecimal(order.unitPrice).toNumber();
    const charged = toDecimal(line.unitPrice).toNumber();
    if (charged > ordered && !withinTolerance(ordered, charged, tol.pricePercent, toDecimal(tol.priceAbsolute).toNumber())) {
      exceptions.push({
        kind: "PRICE_ABOVE_ORDER",
        lineNumber: line.lineNumber,
        description: `Charged ${charged.toLocaleString()} against an ordered price of ${ordered.toLocaleString()}.`,
        variance: toDecimal(charged).minus(ordered).times(line.quantity).toFixed(2),
      });
    }

    if (
      line.quantity > order.quantity &&
      !withinTolerance(order.quantity, line.quantity, tol.quantityPercent, tol.quantityAbsolute)
    ) {
      exceptions.push({
        kind: "QUANTITY_ABOVE_ORDER",
        lineNumber: line.lineNumber,
        description: `Invoiced ${line.quantity} against ${order.quantity} ordered.`,
        variance: toDecimal(line.unitPrice)
          .times(line.quantity - order.quantity)
          .toFixed(2),
      });
    }

    /*
     * The third leg. An invoice for goods nobody has confirmed arrived is the
     * classic way a fraudulent or mistaken charge gets paid, so it is checked
     * against the receipt rather than against the order alone.
     */
    if (order.quantityReceived === 0) {
      exceptions.push({
        kind: "NOT_RECEIVED",
        lineNumber: line.lineNumber,
        description: `Nothing has been received against "${order.description ?? "this line"}".`,
        variance: toDecimal(line.lineTotal).toFixed(2),
      });
    } else if (
      line.quantity > order.quantityReceived &&
      !withinTolerance(
        order.quantityReceived,
        line.quantity,
        tol.quantityPercent,
        tol.quantityAbsolute,
      )
    ) {
      exceptions.push({
        kind: "QUANTITY_ABOVE_RECEIVED",
        lineNumber: line.lineNumber,
        description: `Invoiced ${line.quantity} but only ${order.quantityReceived} was received.`,
        variance: toDecimal(line.unitPrice)
          .times(line.quantity - order.quantityReceived)
          .toFixed(2),
      });
    }
  }

  // The header must agree with its own lines, or somebody has edited one.
  const lineSum = input.invoiceLines.reduce(
    (acc, l) => acc.plus(toDecimal(l.lineTotal)),
    toDecimal(0),
  );
  if (!withinTolerance(lineSum.toNumber(), toDecimal(input.invoiceTotal).toNumber(), 0, 1)) {
    exceptions.push({
      kind: "TOTAL_MISMATCH",
      lineNumber: null,
      description: `The invoice total does not equal the sum of its lines.`,
      variance: toDecimal(input.invoiceTotal).minus(lineSum).toFixed(2),
    });
  }

  return exceptions;
}

/** Total money at risk across a set of exceptions. */
export function exceptionValue(exceptions: MatchException[]): string {
  return exceptions
    .reduce((acc, e) => acc.plus(toDecimal(e.variance ?? 0)), toDecimal(0))
    .toFixed(2);
}

// ── Budgets ─────────────────────────────────────────────────────────────────

export interface BudgetPosition {
  budgetId: string;
  costCentreId: string;
  name: string;
  amount: string;
  committed: string;
  actual: string;
  hardStop: boolean;
}

export interface BudgetVerdict {
  /** Budget less what is already committed and spent. */
  remaining: string;
  /** What would remain if this amount were approved. */
  remainingAfter: string;
  /** Fraction of the budget used, including the proposed amount. */
  usedPercent: number;
  state: "ok" | "warning" | "over";
  /** Whether the policy refuses the approval outright. */
  blocked: boolean;
  message: string | null;
}

/** Used above this share of a budget is worth saying out loud. */
const WARN_AT_PERCENT = 85;

/**
 * Check a proposed spend against a budget.
 *
 * Committed and actual are both subtracted. Money promised on an approved
 * order is gone even though it has not been invoiced, and a budget that
 * counts only invoices tells a kitchen it can afford something it has already
 * ordered twice.
 */
export function checkBudget(
  position: BudgetPosition | null,
  proposedAmount: string,
): BudgetVerdict {
  if (!position) {
    return {
      remaining: "0.00",
      remainingAfter: "0.00",
      usedPercent: 0,
      state: "ok",
      blocked: false,
      message: "No budget is set for this cost centre and period.",
    };
  }

  const amount = toDecimal(position.amount);
  const used = toDecimal(position.committed).plus(toDecimal(position.actual));
  const proposed = toDecimal(proposedAmount);
  const remaining = amount.minus(used);
  const remainingAfter = remaining.minus(proposed);
  const usedPercent = amount.gt(0)
    ? used.plus(proposed).dividedBy(amount).times(100).toNumber()
    : 0;

  const over = remainingAfter.lt(0);
  const state = over ? "over" : usedPercent >= WARN_AT_PERCENT ? "warning" : "ok";

  return {
    remaining: remaining.toFixed(2),
    remainingAfter: remainingAfter.toFixed(2),
    usedPercent,
    state,
    blocked: over && position.hardStop,
    message: over
      ? position.hardStop
        ? `This exceeds ${position.name} by ${remainingAfter.abs().toFixed(2)}. The budget is a hard stop, so it cannot be approved.`
        : `This exceeds ${position.name} by ${remainingAfter.abs().toFixed(2)}. It can be approved, and the overspend is recorded.`
      : state === "warning"
        ? `This would use ${usedPercent.toFixed(0)}% of ${position.name}.`
        : null,
  };
}
