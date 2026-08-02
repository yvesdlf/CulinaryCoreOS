// ---------------------------------------------------------------------------
// Procurement analytics
// ---------------------------------------------------------------------------
// Aggregates over what purchasing already records. Nothing here is a new fact:
// every figure traces to an order, a receipt or an invoice, which is what
// makes it arguable with rather than merely impressive.
//
// Two measures are deliberately conservative. Supplier concentration counts
// committed money rather than invoiced, because the risk of depending on one
// supplier is present the moment the order is placed. And on-time delivery
// only counts orders that had an expected date — scoring an order nobody gave
// a date to would flatter the number.
// ---------------------------------------------------------------------------

import { toDecimal } from "./cost-engine";

export interface OrderSummary {
  id: string;
  reference: string;
  supplierId: string;
  supplierName: string | null;
  costCentreId: string | null;
  status: string;
  orderedOn: string | null;
  expectedOn: string | null;
  totalAmount: string;
}

export interface InvoiceSummary {
  id: string;
  supplierId: string;
  supplierName: string | null;
  invoiceDate: string;
  dueDate: string | null;
  totalAmount: string;
  status: string;
  exceptionCount: number;
}

export interface SpendBySupplier {
  supplierId: string;
  supplierName: string;
  orders: number;
  committed: string;
  /** Share of total committed spend, as a percentage. */
  sharePercent: number;
}

/**
 * Spend by supplier, biggest first.
 *
 * Concentration is a risk measure as much as a commercial one: a venue with
 * 60% of its buying through one company has a service problem the day that
 * company has one.
 */
export function spendBySupplier(orders: OrderSummary[]): SpendBySupplier[] {
  const counted = orders.filter(
    (o) => !["DRAFT", "CANCELLED", "REJECTED"].includes(o.status),
  );
  const total = counted.reduce(
    (acc, o) => acc.plus(toDecimal(o.totalAmount)),
    toDecimal(0),
  );

  const grouped = new Map<string, { name: string; orders: number; amount: ReturnType<typeof toDecimal> }>();
  for (const o of counted) {
    const prior = grouped.get(o.supplierId);
    grouped.set(o.supplierId, {
      name: o.supplierName ?? "Unknown supplier",
      orders: (prior?.orders ?? 0) + 1,
      amount: (prior?.amount ?? toDecimal(0)).plus(toDecimal(o.totalAmount)),
    });
  }

  return [...grouped.entries()]
    .map(([supplierId, g]) => ({
      supplierId,
      supplierName: g.name,
      orders: g.orders,
      committed: g.amount.toFixed(2),
      sharePercent: total.gt(0) ? g.amount.dividedBy(total).times(100).toNumber() : 0,
    }))
    .sort((a, b) => Number(b.committed) - Number(a.committed));
}

export interface InvoiceAgeBucket {
  label: string;
  count: number;
  amount: string;
}

/**
 * Unpaid invoices by how overdue they are.
 *
 * Buckets rather than an average, because an average of one invoice ninety
 * days late and nine paid on time reads as "nine days" and describes nothing
 * anybody needs to act on.
 */
export function invoiceAgeing(
  invoices: InvoiceSummary[],
  today: Date,
): InvoiceAgeBucket[] {
  const open = invoices.filter(
    (i) => !["PAID", "CANCELLED"].includes(i.status),
  );
  const buckets: { label: string; min: number; max: number }[] = [
    { label: "Not yet due", min: -Infinity, max: 0 },
    { label: "1–30 days late", min: 1, max: 30 },
    { label: "31–60 days late", min: 31, max: 60 },
    { label: "Over 60 days late", min: 61, max: Infinity },
  ];

  return buckets.map((b) => {
    const inBucket = open.filter((i) => {
      if (!i.dueDate) return b.label === "Not yet due";
      const days = Math.floor(
        (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
          Date.parse(`${i.dueDate}T00:00:00Z`)) /
          86_400_000,
      );
      return days >= b.min && days <= b.max;
    });
    return {
      label: b.label,
      count: inBucket.length,
      amount: inBucket
        .reduce((acc, i) => acc.plus(toDecimal(i.totalAmount)), toDecimal(0))
        .toFixed(2),
    };
  });
}

export interface MatchRate {
  total: number;
  clean: number;
  held: number;
  /** Share matched with no exception, as a percentage. */
  straightThroughPercent: number;
  valueHeld: string;
}

/** How much of AP goes through untouched — the measure that says whether the controls are usable. */
export function matchRate(invoices: InvoiceSummary[]): MatchRate {
  const total = invoices.length;
  const held = invoices.filter((i) => i.exceptionCount > 0);
  return {
    total,
    clean: total - held.length,
    held: held.length,
    straightThroughPercent: total > 0 ? ((total - held.length) / total) * 100 : 0,
    valueHeld: held
      .reduce((acc, i) => acc.plus(toDecimal(i.totalAmount)), toDecimal(0))
      .toFixed(2),
  };
}

export interface CycleTime {
  /** Median days from submission to approval. Null when nothing has been approved. */
  medianDays: number | null;
  count: number;
}

/**
 * Median rather than mean.
 *
 * One requisition approved after a fortnight because somebody was on leave
 * should not make a team that normally turns them round in a day look slow.
 */
export function approvalCycleTime(
  pairs: { submittedAt: string | null; approvedAt: string | null }[],
): CycleTime {
  const days = pairs
    .filter((p) => p.submittedAt && p.approvedAt)
    .map(
      (p) =>
        (Date.parse(p.approvedAt!) - Date.parse(p.submittedAt!)) / 86_400_000,
    )
    .filter((d) => d >= 0)
    .sort((a, b) => a - b);
  if (days.length === 0) return { medianDays: null, count: 0 };
  const mid = Math.floor(days.length / 2);
  return {
    medianDays:
      days.length % 2 === 1 ? days[mid] : (days[mid - 1] + days[mid]) / 2,
    count: days.length,
  };
}

export interface DeliveryPerformance {
  supplierName: string;
  ordersScored: number;
  onTime: number;
  onTimePercent: number;
}

/**
 * On-time delivery, counting only orders that carried an expected date.
 *
 * Scoring an order nobody gave a date to would flatter the figure, and a
 * supplier scorecard that flatters is worse than none.
 */
export function deliveryPerformance(
  orders: (OrderSummary & { receivedOn: string | null })[],
): DeliveryPerformance[] {
  const scored = orders.filter((o) => o.expectedOn && o.receivedOn);
  const grouped = new Map<string, { onTime: number; total: number }>();
  for (const o of scored) {
    const name = o.supplierName ?? "Unknown supplier";
    const prior = grouped.get(name) ?? { onTime: 0, total: 0 };
    grouped.set(name, {
      onTime: prior.onTime + (o.receivedOn! <= o.expectedOn! ? 1 : 0),
      total: prior.total + 1,
    });
  }
  return [...grouped.entries()]
    .map(([supplierName, g]) => ({
      supplierName,
      ordersScored: g.total,
      onTime: g.onTime,
      onTimePercent: g.total > 0 ? (g.onTime / g.total) * 100 : 0,
    }))
    .sort((a, b) => a.onTimePercent - b.onTimePercent);
}
