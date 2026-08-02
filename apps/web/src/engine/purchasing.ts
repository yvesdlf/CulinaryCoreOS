// ---------------------------------------------------------------------------
// Purchasing — requisition and purchase order rules
// ---------------------------------------------------------------------------
// The database is the authority on segregation of duties and approval
// authority: a trigger refuses an approval by the requester, or by somebody
// whose role is below what the amount requires.
//
// This module holds the same rules a second time, and that duplication is
// deliberate. The database can only say no at the moment somebody presses the
// button, which is too late to be useful — the screen has to be able to say
// "this needs an admin, and you raised it" while the document is still being
// looked at. The rules therefore live here for explanation and there for
// enforcement, and the enforcement one wins.
// ---------------------------------------------------------------------------

import type { Decimal } from "@ccos/shared";
import { toDecimal } from "./cost-engine";

export type OrgRole = "OWNER" | "ADMIN" | "CHEF" | "VIEWER";

export type PurchaseStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "ORDERED"
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
  | "CLOSED";

/** Seniority, for comparing a role against what a policy demands. */
const ROLE_RANK: Record<OrgRole, number> = {
  VIEWER: 0,
  CHEF: 1,
  ADMIN: 2,
  OWNER: 3,
};

export interface ApprovalPolicy {
  documentType: "REQUISITION" | "PURCHASE_ORDER";
  minAmount: string;
  requiredRole: OrgRole;
}

export interface Approver {
  id: string | null;
  email: string | null;
  role: OrgRole;
}

export interface ApprovableDocument {
  status: PurchaseStatus;
  totalAmount: string;
  requestedById: string | null;
  requestedByEmail: string | null;
}

export interface ApprovalVerdict {
  allowed: boolean;
  /** The role the amount demands, for showing who to ask. */
  requiredRole: OrgRole | null;
  /** Why not, in words that name the rule rather than the error. */
  reason: string | null;
}

/**
 * The strictest policy the amount reaches.
 *
 * Highest threshold wins, so adding a tier for large orders leaves the
 * smaller tiers alone.
 */
export function requiredRoleFor(
  amount: Decimal | number | string,
  documentType: ApprovalPolicy["documentType"],
  policies: ApprovalPolicy[],
): OrgRole | null {
  const value = toDecimal(amount);
  const applicable = policies
    .filter((p) => p.documentType === documentType)
    .filter((p) => value.gte(toDecimal(p.minAmount)))
    .sort((a, b) => toDecimal(b.minAmount).comparedTo(toDecimal(a.minAmount)));
  return applicable[0]?.requiredRole ?? null;
}

/**
 * Whether this person may approve this document, and if not, why.
 *
 * Order matters. A requester who is also the only admin should be told that
 * they cannot approve their own request, not that they lack a role they
 * actually hold — the second reading sends them to change permissions when
 * the answer is to ask a colleague.
 */
export function canApprove(
  doc: ApprovableDocument,
  approver: Approver,
  documentType: ApprovalPolicy["documentType"],
  policies: ApprovalPolicy[],
): ApprovalVerdict {
  const requiredRole = requiredRoleFor(doc.totalAmount, documentType, policies);

  if (doc.status !== "SUBMITTED") {
    return {
      allowed: false,
      requiredRole,
      reason:
        doc.status === "DRAFT"
          ? "This has not been submitted for approval yet."
          : `This is already ${doc.status.toLowerCase().replace("_", " ")}.`,
    };
  }

  const sameId =
    doc.requestedById !== null &&
    approver.id !== null &&
    doc.requestedById === approver.id;
  const sameEmail =
    doc.requestedByEmail !== null &&
    approver.email !== null &&
    doc.requestedByEmail.toLowerCase() === approver.email.toLowerCase();

  if (sameId || sameEmail) {
    return {
      allowed: false,
      requiredRole,
      reason:
        "You raised this, so you cannot approve it. Ask someone else with the right authority.",
    };
  }

  if (requiredRole && ROLE_RANK[approver.role] < ROLE_RANK[requiredRole]) {
    return {
      allowed: false,
      requiredRole,
      reason: `Approving this amount needs the ${requiredRole} role.`,
    };
  }

  return { allowed: true, requiredRole, reason: null };
}

// ── Status transitions ──────────────────────────────────────────────────────

/**
 * Where a document may go from where it is.
 *
 * A requisition that has been ordered against cannot go back to draft: the
 * purchase order downstream was raised on the strength of the approval, and
 * reopening it would leave that order authorised by nothing.
 */
const REQUISITION_TRANSITIONS: Record<PurchaseStatus, PurchaseStatus[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["ORDERED", "CANCELLED"],
  REJECTED: ["DRAFT", "CANCELLED"],
  ORDERED: ["CLOSED"],
  PARTIALLY_RECEIVED: ["RECEIVED", "CLOSED"],
  RECEIVED: ["CLOSED"],
  CANCELLED: [],
  CLOSED: [],
};

const PURCHASE_ORDER_TRANSITIONS: Record<PurchaseStatus, PurchaseStatus[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["ORDERED", "CANCELLED"],
  ORDERED: ["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
  PARTIALLY_RECEIVED: ["RECEIVED", "CLOSED"],
  RECEIVED: ["CLOSED"],
  REJECTED: ["DRAFT", "CANCELLED"],
  CANCELLED: [],
  CLOSED: [],
};

export function canTransition(
  from: PurchaseStatus,
  to: PurchaseStatus,
  documentType: ApprovalPolicy["documentType"],
): boolean {
  const table =
    documentType === "REQUISITION"
      ? REQUISITION_TRANSITIONS
      : PURCHASE_ORDER_TRANSITIONS;
  return table[from].includes(to);
}

// ── Turning an approved requisition into orders ─────────────────────────────

export interface RequisitionLine {
  id: string;
  productId: string | null;
  description: string | null;
  quantity: number;
  unit: string;
  estimatedUnitPrice: string;
  suggestedSupplierId: string | null;
}

export interface DraftOrder {
  supplierId: string | null;
  lines: RequisitionLine[];
  subtotal: string;
}

/**
 * Split an approved requisition into one draft order per supplier.
 *
 * A requisition is a list of what a kitchen needs; an order is a contract with
 * one company. Lines with no supplier are grouped under null rather than
 * dropped or guessed at — somebody has to choose, and the page has to show
 * them what is waiting on that choice.
 */
export function draftOrdersFrom(lines: RequisitionLine[]): DraftOrder[] {
  const bySupplier = new Map<string | null, RequisitionLine[]>();
  for (const line of lines) {
    const key = line.suggestedSupplierId;
    bySupplier.set(key, [...(bySupplier.get(key) ?? []), line]);
  }
  return [...bySupplier.entries()]
    .map(([supplierId, group]) => ({
      supplierId,
      lines: group,
      subtotal: group
        .reduce(
          (acc, l) => acc.plus(toDecimal(l.estimatedUnitPrice).times(l.quantity)),
          toDecimal(0),
        )
        .toFixed(2),
    }))
    // Unassigned last: it is the pile that needs a decision, not an order.
    .sort(
      (a, b) =>
        Number(a.supplierId === null) - Number(b.supplierId === null) ||
        Number(b.subtotal) - Number(a.subtotal),
    );
}

/** Next reference in a per-year sequence, e.g. REQ-2026-0007. */
export function nextReference(
  prefix: string,
  existing: string[],
  year = new Date().getFullYear(),
): string {
  const pattern = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  const highest = existing.reduce((max, ref) => {
    const m = pattern.exec(ref);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  return `${prefix}-${year}-${String(highest + 1).padStart(4, "0")}`;
}

// ── Receiving against an order ──────────────────────────────────────────────

export interface OrderLineProgress {
  ordered: number;
  received: number;
  outstanding: number;
  /** Received more than ordered — worth showing, not silently allowing. */
  over: boolean;
}

export function lineProgress(
  ordered: number,
  received: number,
): OrderLineProgress {
  return {
    ordered,
    received,
    outstanding: Math.max(0, ordered - received),
    over: received > ordered,
  };
}

/**
 * What an order's status should be, given what has arrived.
 *
 * Derived rather than set by hand: a status somebody has to remember to change
 * is a status that goes stale, and "received" on an order still missing a case
 * of wine is worse than no status at all.
 */
export function statusFromReceipts(
  lines: { quantity: number; quantityReceived: number }[],
  current: PurchaseStatus,
): PurchaseStatus {
  if (current === "CANCELLED" || current === "CLOSED") return current;
  if (lines.length === 0) return current;
  const anything = lines.some((l) => l.quantityReceived > 0);
  const everything = lines.every((l) => l.quantityReceived >= l.quantity);
  if (everything) return "RECEIVED";
  if (anything) return "PARTIALLY_RECEIVED";
  return current === "ORDERED" ? "ORDERED" : current;
}
