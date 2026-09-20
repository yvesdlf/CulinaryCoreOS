// ---------------------------------------------------------------------------
// How much leave somebody has left
// ---------------------------------------------------------------------------
// The figure on the home screen, and the one people argue about. Kept pure and
// tested because "how many days do I have?" is asked constantly and a wrong
// answer is discovered in December when it cannot be fixed.
//
// Three positions worth stating, because each is a choice somebody could make
// differently:
//
//   A request that is still waiting counts against the balance. Somebody with
//   twenty days who has asked for fifteen has five left to plan with, not
//   twenty — showing twenty invites them to book a holiday they cannot take.
//   It is shown separately as "pending" so the figure is explainable.
//
//   A rejected or cancelled request counts for nothing. Obvious, and worth a
//   test, because filtering on "not taken" instead of "approved or pending"
//   silently gives everybody their rejected days back.
//
//   Leave with no annual entitlement — sick, unpaid, parental — has no balance
//   to run down. It is counted and reported as days used, never as a remainder,
//   because a "sick days remaining" figure reads as an allowance to spend.
// ---------------------------------------------------------------------------

export interface LeaveTypeLike {
  id: string;
  code: string;
  name: string;
  paid: boolean;
  annualEntitlementDays: number | null;
  maxCarryoverDays?: number | null;
}

export interface LeaveRequestLike {
  leaveTypeId: string;
  days: number;
  status: string;
  startsOn: string;
}

export interface LeaveBalance {
  type: LeaveTypeLike;
  /** Null where the type has no annual allowance. */
  entitlement: number | null;
  taken: number;
  pending: number;
  /** Entitlement less taken and pending. Null where there is no entitlement. */
  remaining: number | null;
}

const COUNTS_AS_TAKEN = ["APPROVED", "TAKEN"];
const COUNTS_AS_PENDING = ["REQUESTED", "SUBMITTED"];

/**
 * Balances for one person, for one leave year.
 *
 * The year is passed in rather than assumed, because a venue's leave year is
 * not always the calendar year and the caller knows which one it is showing.
 */
export function leaveBalances(
  types: LeaveTypeLike[],
  requests: LeaveRequestLike[],
  yearStart: Date,
  yearEnd: Date,
): LeaveBalance[] {
  const from = yearStart.getTime();
  const to = yearEnd.getTime();

  const inYear = requests.filter((r) => {
    const at = new Date(r.startsOn).getTime();
    return Number.isFinite(at) && at >= from && at <= to;
  });

  return types.map((type) => {
    const mine = inYear.filter((r) => r.leaveTypeId === type.id);
    const taken = round(sum(mine.filter((r) => COUNTS_AS_TAKEN.includes(r.status))));
    const pending = round(sum(mine.filter((r) => COUNTS_AS_PENDING.includes(r.status))));
    const entitlement = type.annualEntitlementDays;

    return {
      type,
      entitlement,
      taken,
      pending,
      // Never clamped at zero: somebody who has overrun their allowance needs
      // to see -2, not 0. Hiding it is how it reaches payroll unnoticed.
      remaining: entitlement === null ? null : round(entitlement - taken - pending),
    };
  });
}

function sum(rows: LeaveRequestLike[]): number {
  return rows.reduce((n, r) => n + (Number.isFinite(r.days) ? r.days : 0), 0);
}

/** Half days are real; a long tail of binary floating point is not. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The one balance worth putting at the top of a screen.
 *
 * Annual leave, because it is the only one most people are counting. Falls
 * back to whichever entitled type has the most days if a venue does not use
 * that code.
 */
export function headlineBalance(balances: LeaveBalance[]): LeaveBalance | null {
  const annual = balances.find((b) => b.type.code === "ANNUAL");
  if (annual) return annual;
  const entitled = balances.filter((b) => b.entitlement !== null);
  if (entitled.length === 0) return null;
  return entitled.reduce((best, b) =>
    (b.entitlement ?? 0) > (best.entitlement ?? 0) ? b : best);
}
