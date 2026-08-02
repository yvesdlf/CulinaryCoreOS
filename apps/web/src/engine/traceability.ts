// ---------------------------------------------------------------------------
// Traceability, date marking and lot status — EU food law
// ---------------------------------------------------------------------------
// The distinction this module exists to keep is between the two date marks,
// because treating them the same is wrong in both directions.
//
//   Use by is a safety limit. Regulation 1169/2011 Annex X: food past its
//   use-by date is deemed unsafe under Regulation 178/2002 Article 14 and must
//   not be used. There is no judgement call and no "smells fine".
//
//   Best before is a quality limit. Food past it is legal to use, and binning
//   it is waste rather than caution.
//
// So the two never share a code path here, and a lot with no stated kind is
// treated as unknown rather than assumed to be the lenient one.
//
// Everything is computed against a date passed in rather than `new Date()`, so
// the same lot gives the same answer in a test, in a report run at midnight,
// and in a browser whose clock is wrong.
// ---------------------------------------------------------------------------

export type ExpiryKind = "USE_BY" | "BEST_BEFORE";
export type LotStatus = "OK" | "BLOCKED" | "RECALLED" | "WITHDRAWN";

export interface StockLot {
  id: string;
  productId: string;
  lotCode: string;
  supplierId: string | null;
  supplierName: string | null;
  deliveryReference: string | null;
  receivedOn: string;
  expiresOn: string | null;
  expiryKind: ExpiryKind | null;
  receiptTemperatureC: number | null;
  status: LotStatus;
  statusReason: string | null;
}

export type DateMarkState =
  /** No date given. Dry goods often have none. */
  | "none"
  /** Past a use-by date: unsafe, must not be used. */
  | "unsafe"
  /** Past a best-before date: legal to use, quality declining. */
  | "past-best"
  /** Within the warning window. */
  | "expiring"
  | "ok"
  /** A date exists but nobody said which kind it is. */
  | "unknown-kind";

export interface LotAssessment {
  lot: StockLot;
  dateMark: DateMarkState;
  /** Whole days until expiry; negative once passed. Null with no date. */
  daysLeft: number | null;
  /** Whether the lot may be used in production. */
  usable: boolean;
  /** Why not, in words a chef can act on. */
  reason: string | null;
}

/** Days of notice before an expiry is worth surfacing. */
export const DEFAULT_EXPIRY_WARNING_DAYS = 7;

/** Whole days between two calendar dates, ignoring time of day. */
function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86_400_000);
}

function parseDate(iso: string): Date | null {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Assess one lot against a date.
 *
 * Status is checked before expiry: a recalled lot that is also in date is
 * still recalled, and saying "expires in 4 days" about it would bury the
 * thing that matters.
 */
export function assessLot(
  lot: StockLot,
  today: Date,
  warningDays: number = DEFAULT_EXPIRY_WARNING_DAYS,
): LotAssessment {
  const expiry = lot.expiresOn ? parseDate(lot.expiresOn) : null;
  const daysLeft = expiry ? daysBetween(today, expiry) : null;

  let dateMark: DateMarkState;
  if (!expiry) {
    dateMark = "none";
  } else if (!lot.expiryKind) {
    // A date without a kind cannot be acted on: it is either a safety limit
    // or a quality one and the difference is whether the food is binned.
    dateMark = "unknown-kind";
  } else if (lot.expiryKind === "USE_BY") {
    // Annex X: the day shown is the last day of use, so it expires after it.
    dateMark = daysLeft! < 0 ? "unsafe" : daysLeft! <= warningDays ? "expiring" : "ok";
  } else {
    dateMark = daysLeft! < 0 ? "past-best" : daysLeft! <= warningDays ? "expiring" : "ok";
  }

  if (lot.status !== "OK") {
    return {
      lot,
      dateMark,
      daysLeft,
      usable: false,
      reason:
        lot.status === "RECALLED"
          ? `Recalled${lot.statusReason ? `: ${lot.statusReason}` : ""}. Do not use; quarantine and return.`
          : lot.status === "WITHDRAWN"
            ? `Withdrawn${lot.statusReason ? `: ${lot.statusReason}` : ""}. Do not use.`
            : `On hold${lot.statusReason ? `: ${lot.statusReason}` : ""}. Not to be used until released.`,
    };
  }

  if (dateMark === "unsafe") {
    return {
      lot,
      dateMark,
      daysLeft,
      usable: false,
      reason: `Past its use-by date by ${Math.abs(daysLeft!)} day${Math.abs(daysLeft!) === 1 ? "" : "s"}. Food past a use-by date is unsafe and must not be used.`,
    };
  }

  if (dateMark === "past-best") {
    // Legal to use. Saying so plainly prevents good food being thrown away.
    return {
      lot,
      dateMark,
      daysLeft,
      usable: true,
      reason: `Past its best-before date by ${Math.abs(daysLeft!)} day${Math.abs(daysLeft!) === 1 ? "" : "s"}. Still legal to use; check quality.`,
    };
  }

  if (dateMark === "unknown-kind") {
    return {
      lot,
      dateMark,
      daysLeft,
      usable: true,
      reason:
        "This date is not marked as use-by or best-before, so it cannot be judged. Check the packaging.",
    };
  }

  return { lot, dateMark, daysLeft, usable: true, reason: null };
}

/** Rank for sorting: what has to be dealt with first. */
const URGENCY: Record<DateMarkState, number> = {
  unsafe: 0,
  expiring: 1,
  "unknown-kind": 2,
  "past-best": 3,
  ok: 4,
  none: 5,
};

/*
 * Among lots that cannot be used, a recall outranks a date breach.
 *
 * Both stop the lot being used, but they are not equally urgent. A recalled
 * lot may already have been served, and Article 19 puts a duty on the business
 * to act and to inform the authorities. Food that has quietly gone past its
 * use-by date is still on the shelf and the harm is contained to throwing it
 * away. So the recall is what someone should read first.
 */
const STATUS_URGENCY: Record<LotStatus, number> = {
  RECALLED: 0,
  WITHDRAWN: 1,
  BLOCKED: 2,
  OK: 3,
};

/** Everything needing attention, most urgent first. */
export function lotsNeedingAttention(
  lots: StockLot[],
  today: Date,
  warningDays: number = DEFAULT_EXPIRY_WARNING_DAYS,
): LotAssessment[] {
  return lots
    .map((l) => assessLot(l, today, warningDays))
    .filter((a) => !a.usable || a.dateMark !== "ok")
    .filter((a) => a.dateMark !== "none" || !a.usable)
    .sort(
      (a, b) =>
        Number(a.usable) - Number(b.usable) ||
        STATUS_URGENCY[a.lot.status] - STATUS_URGENCY[b.lot.status] ||
        URGENCY[a.dateMark] - URGENCY[b.dateMark] ||
        (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999),
    );
}

export interface CertificateState {
  kind: string;
  reference: string | null;
  expiresOn: string | null;
  daysLeft: number | null;
  state: "expired" | "expiring" | "ok" | "none";
}

/**
 * Supplier certificate validity.
 *
 * An expired HACCP or organic certificate is the same shape of problem as an
 * expired ingredient: fine until the day it is not, and invisible without a
 * date to check.
 */
export function assessCertificate(
  cert: { kind: string; reference: string | null; expiresOn: string | null },
  today: Date,
  warningDays = 30,
): CertificateState {
  if (!cert.expiresOn) {
    return { ...cert, daysLeft: null, state: "none" };
  }
  const expiry = parseDate(cert.expiresOn);
  if (!expiry) return { ...cert, daysLeft: null, state: "none" };
  const daysLeft = daysBetween(today, expiry);
  return {
    ...cert,
    daysLeft,
    state: daysLeft < 0 ? "expired" : daysLeft <= warningDays ? "expiring" : "ok",
  };
}

export interface TraceStep {
  label: string;
  detail: string;
}

/**
 * One step back — Regulation 178/2002 Article 18.
 *
 * What an inspector or a recall notice asks for: who supplied this, when,
 * against which delivery, and at what temperature it arrived. Anything the
 * record does not hold is said to be missing rather than left blank, because
 * a gap in a traceability record is itself the finding.
 */
export function traceBack(lot: StockLot): TraceStep[] {
  return [
    {
      label: "Supplier",
      detail: lot.supplierName ?? "Not recorded — required for traceability",
    },
    { label: "Lot code", detail: lot.lotCode },
    {
      label: "Delivery reference",
      detail: lot.deliveryReference ?? "Not recorded",
    },
    { label: "Received", detail: lot.receivedOn },
    {
      label: "Date mark",
      detail: lot.expiresOn
        ? `${lot.expiryKind === "USE_BY" ? "Use by" : lot.expiryKind === "BEST_BEFORE" ? "Best before" : "Date"} ${lot.expiresOn}`
        : "None given",
    },
    {
      label: "Temperature on receipt",
      detail:
        lot.receiptTemperatureC === null
          ? "Not recorded"
          : `${lot.receiptTemperatureC} °C`,
    },
  ];
}
