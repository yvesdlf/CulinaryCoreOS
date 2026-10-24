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
//
//   Days carried in from last year are part of the allowance and shown
//   separately. They come from `leave_carryover` (0112), already capped and
//   with expiry already applied — this never recomputes either. The cap was
//   decided on the day the year closed, under a policy that may since have
//   changed, and recomputing it here would quietly rewrite what somebody was
//   told they had.
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

/**
 * Days brought forward, as the database decided them.
 *
 * `days` is what is still live: `leave_entitlement_now.carried_in_now`, which
 * is zero once the balance has lapsed. `expiresOn` is carried so a screen can
 * say "3 days, until 1 April" — a number with no date on it is one people
 * assume they can use in December.
 */
export interface CarriedIn {
  leaveTypeId: string;
  days: number;
  expiresOn: string | null;
}

export interface LeaveBalance {
  type: LeaveTypeLike;
  /** This year's allowance alone. Null where the type has none. */
  entitlement: number | null;
  /** Brought forward from last year, already capped and not yet lapsed. */
  carriedIn: number;
  /** Entitlement plus carry-over: what there actually is to spend. */
  allowance: number | null;
  /** When the carried days lapse, where any are still live. */
  carryExpiresOn: string | null;
  taken: number;
  pending: number;
  /** Allowance less taken and pending. Null where there is no entitlement. */
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
  carried: CarriedIn[] = [],
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

    /*
     * Taken as given. A type with no annual allowance gets none regardless of
     * what arrives, because carried sick days are not a thing and a figure
     * saying otherwise would read as an allowance to spend.
     */
    const brought = entitlement === null
      ? 0
      : round(sum2(carried.filter((c) => c.leaveTypeId === type.id)));
    const expiry = brought > 0
      ? (carried.find((c) => c.leaveTypeId === type.id && c.days > 0)?.expiresOn ?? null)
      : null;
    const allowance = entitlement === null ? null : round(entitlement + brought);

    return {
      type,
      entitlement,
      carriedIn: brought,
      allowance,
      carryExpiresOn: expiry,
      taken,
      pending,
      // Never clamped at zero: somebody who has overrun their allowance needs
      // to see -2, not 0. Hiding it is how it reaches payroll unnoticed.
      remaining: allowance === null ? null : round(allowance - taken - pending),
    };
  });
}

function sum(rows: LeaveRequestLike[]): number {
  return rows.reduce((n, r) => n + (Number.isFinite(r.days) ? r.days : 0), 0);
}

function sum2(rows: CarriedIn[]): number {
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
