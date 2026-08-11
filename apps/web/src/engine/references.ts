// ---------------------------------------------------------------------------
// Document reference numbers
// ---------------------------------------------------------------------------
// REQ-KIT-260809-001
// │   │   │      └── sequence, restarting each day
// │   │   └───────── the date, yymmdd
// │   └───────────── the business unit, first three letters of its cost centre
// └───────────────── what kind of document this is
//
// Four segments because each answers a question somebody asks out loud. "Which
// kitchen order was that?" is answered by KIT. "When?" by the date, without
// opening anything. "Which one of that day's?" by the sequence. And the type
// prefix is what lets a requisition and the purchase order raised from it be
// told apart in a filing cabinet, an inbox and a supplier's accounts system.
//
// The old scheme was REQ-2026-0001 — a running number per year with no unit and
// no date. It told a buyer nothing without looking the document up, and by
// November nobody could say whether 0847 was recent.
//
// Two-digit years are a deliberate choice and not an oversight. This is a
// reference, not a date field: it is read aloud, written on a delivery note and
// typed into a supplier's system, and four digits there buys nothing. The date
// a document was actually raised is a timestamp column.
//
// The number is issued once, when the request is raised, and every document
// after it carries the same three digits — PR, then PO, then the goods receipt,
// then the invoice — until it is paid and archived. A request goes to one
// supplier, so there is exactly one of each and nothing ever needs a second
// number.
//
// The sequence is NOT allocated here. See next_reference_stem() in migration
// 0047 — two people raising a request in the same second both compute 001 if
// the number comes from the browser.
// ---------------------------------------------------------------------------

/** Document types that carry a reference. */
export type DocumentType = "REQ" | "PR" | "PO" | "GRN" | "INV" | "RFQ" | "HR";

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  REQ: "Requisition",
  PR: "Purchase request",
  PO: "Purchase order",
  GRN: "Goods received",
  INV: "Supplier invoice",
  RFQ: "Request for quotation",
  HR: "Hiring request",
};

export interface ReferenceParts {
  type: DocumentType | string;
  unit: string;
  /** The date the document was raised, as yymmdd. */
  yymmdd: string;
  sequence: number;
  /**
   * A suffix from a scheme that briefly numbered split orders -2, -3.
   *
   * Nothing generates one. A request goes to one supplier, so it never splits
   * and there is nothing to suffix. Still parsed, because a venue that ran
   * that scheme has orders carrying it, and reading those as malformed would
   * flag real paperwork as broken.
   */
  split?: number | null;
}

/**
 * The part that belongs to the document rather than to its current standing.
 *
 * KIT-260809-001 out of REQ-KIT-260809-001. This is what stays put while the
 * prefix moves from REQ to PR to PO, and what ties an order back to the
 * requisition it came from by eye rather than by join.
 */
export function referenceStem(ref: string): string | null {
  const parts = parseReference(ref);
  if (!parts) return null;
  return `${parts.unit}-${parts.yymmdd}-${String(parts.sequence).padStart(3, "0")}`;
}

/**
 * The same transaction, under the name its current stage gives it.
 *
 * REQ to PR to PO to GRN to INV, all on one number. It is issued once when the
 * request is raised and stays with the transaction until the invoice is paid
 * and archived — because a request goes to one supplier, so it becomes exactly
 * one order, one delivery and one invoice.
 */
export function withType(ref: string, type: DocumentType | string): string | null {
  const stem = referenceStem(ref);
  return stem ? `${type}-${stem}` : null;
}

/**
 * The unit code for a cost centre or department.
 *
 * First three letters, upper case, letters and digits only. "Kitchen" gives
 * KIT, "Front of house" gives FOH via its code rather than its name, and "IT"
 * gives IT — a two-letter unit stays two letters rather than being padded into
 * something nobody would recognise.
 */
export function unitCode(source: string | null | undefined): string {
  const cleaned = (source ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return "GEN";
  return cleaned.slice(0, 3);
}

/** yymmdd in local time, which is the day the person raising it is having. */
export function yymmdd(date = new Date()): string {
  const yy = String(date.getFullYear() % 100).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

export function formatReference(parts: ReferenceParts): string {
  // Three digits gives 999 documents of one type, for one unit, in one day.
  // Past that it widens rather than wrapping — a duplicate reference is worse
  // than an ugly one, and the unique index would refuse it anyway.
  const seq = String(parts.sequence).padStart(3, "0");
  // `split` is not written back. See the note on the field.
  return `${parts.type}-${parts.unit}-${parts.yymmdd}-${seq}`;
}

const REFERENCE_PATTERN = /^([A-Z]{2,4})-([A-Z0-9]{2,4})-(\d{6})-(\d{3,})(?:-(\d+))?$/;
/** The scheme this replaced. Kept so old documents still parse. */
const LEGACY_PATTERN = /^([A-Z]{2,4})-(\d{4})-(\d{3,})$/;

export function parseReference(ref: string): ReferenceParts | null {
  const m = REFERENCE_PATTERN.exec(ref.trim().toUpperCase());
  if (!m) return null;
  return {
    type: m[1], unit: m[2], yymmdd: m[3],
    sequence: Number(m[4]),
    split: m[5] ? Number(m[5]) : null,
  };
}

/**
 * Whether a reference is one of the old ones.
 *
 * Worth being able to answer: a venue's existing purchase orders keep their
 * REQ-2026-0001 references forever, and a screen that treats those as
 * malformed would flag its own history as broken.
 */
export function isLegacyReference(ref: string): boolean {
  return LEGACY_PATTERN.test(ref.trim().toUpperCase());
}

/** The date a reference says it was raised, for sorting and for display. */
export function referenceDate(ref: string): Date | null {
  const parts = parseReference(ref);
  if (!parts) return null;
  const yy = Number(parts.yymmdd.slice(0, 2));
  const mm = Number(parts.yymmdd.slice(2, 4));
  const dd = Number(parts.yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  // A two-digit year is this century. The alternative is a sliding window,
  // which would silently reinterpret old references as the window moved.
  return new Date(2000 + yy, mm - 1, dd);
}

/**
 * Work out the next reference from references already held.
 *
 * The fallback for when the database cannot be reached, and for the preview a
 * dialog shows before anything is saved. The authoritative number comes from
 * next_document_reference(); this one races and is only ever a suggestion.
 */
export function nextReferenceLocal(
  type: DocumentType | string,
  unit: string,
  existing: string[],
  date = new Date(),
): string {
  const day = yymmdd(date);
  const highest = existing.reduce((max, ref) => {
    const parts = parseReference(ref);
    if (!parts) return max;
    if (parts.type !== type || parts.unit !== unit || parts.yymmdd !== day) return max;
    return Math.max(max, parts.sequence);
  }, 0);
  return formatReference({ type, unit, yymmdd: day, sequence: highest + 1, split: null });
}

/**
 * The unit a document belongs to, taken from its own reference.
 *
 * How a goods receipt inherits the unit of the order it settles: the order's
 * reference already carries it, so the receipt does not need to look up a cost
 * centre it has no other reason to know about.
 *
 * Falls back to GEN for a legacy reference, which carries no unit at all.
 */
export function unitFromReference(ref: string | null | undefined): string {
  if (!ref) return "GEN";
  return parseReference(ref)?.unit ?? "GEN";
}


/**
 * What a requisition is called at its current status.
 *
 * It is a request while somebody is writing it or deciding on it. The moment
 * it is approved it stops being a request from a kitchen and becomes an
 * authorised purchase request, and its number says so. A rejected or cancelled
 * one stays a REQ, because it never became anything else.
 *
 * Mirrors requisition_prefix() in migration 0048, which is what actually
 * renames the row. This is for screens that need the label before a round trip.
 */
export function prefixForRequisitionStatus(status: string): "REQ" | "PR" {
  return ["DRAFT", "SUBMITTED", "REJECTED", "CANCELLED"].includes(status)
    ? "REQ"
    : "PR";
}
