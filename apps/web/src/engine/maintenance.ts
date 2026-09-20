// ---------------------------------------------------------------------------
// Engineering and maintenance
// ---------------------------------------------------------------------------
// The judgements a maintenance screen makes, kept out of the screen so they can
// be tested and so two screens cannot disagree about the same asset.
//
// Three positions worth stating, because each is a choice somebody could make
// differently:
//
//   A statutory inspection that is late is not "amber". Missing a gas or
//   pressure-vessel inspection is a legal finding rather than a deferred job,
//   so it is graded by a different scale that starts at overdue and has no
//   comfortable colour above it.
//
//   Whether to repair or replace is decided on cumulative spend against what
//   the asset cost, not on the number of faults. Four cheap visits and one
//   compressor are the same fault count and a completely different decision.
//
//   Capacity compares assigned minutes to rostered minutes, never to a count
//   of jobs. Eleven jobs is fine with four technicians on and impossible with
//   one, and a backlog figure that does not know who is in says nothing.
// ---------------------------------------------------------------------------

export type DueState = "overdue" | "due" | "soon" | "ok";

export interface PlanLike {
  code: string;
  title: string;
  intervalDays: number;
  estimatedMinutes: number;
  statutory: boolean;
  lastCompletedOn: string | null;
  jobOpen?: boolean;
}

export interface PlanDue {
  dueOn: string;
  daysOverdue: number;
  state: DueState;
  /** True when this is late and missing it is a legal finding, not a delay. */
  statutoryBreach: boolean;
}

function toDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.round(ms / 86400000);
}

/**
 * When a plan is next due, and how late it is.
 *
 * A plan that has never been done is due today rather than at some point in the
 * past. Back-dating it would report a brand-new venue as months behind on
 * everything it has just bought, and a screen that opens red on day one is a
 * screen nobody reads on day two.
 */
export function planDue(plan: PlanLike, today = new Date()): PlanDue {
  const last = plan.lastCompletedOn ? toDate(plan.lastCompletedOn) : null;
  const due = last
    ? new Date(last.getTime() + plan.intervalDays * 86400000)
    : new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const daysOverdue = daysBetween(due, today);

  let state: DueState;
  if (daysOverdue > 0) state = "overdue";
  else if (daysOverdue === 0) state = "due";
  // "Soon" is a tenth of the interval, not a fixed week. A weekly check warns a
  // day ahead; an annual inspection warns five weeks ahead, which is the notice
  // somebody needs to book a contractor.
  else if (-daysOverdue <= Math.max(1, Math.round(plan.intervalDays / 10))) state = "soon";
  else state = "ok";

  return {
    dueOn: toIso(due),
    daysOverdue,
    state,
    statutoryBreach: plan.statutory && daysOverdue > 0,
  };
}

/**
 * What is worth showing first.
 *
 * A statutory breach outranks everything, then how late it is. Ties break on
 * the shorter interval, because a daily check that is two days late has been
 * missed twice and an annual one has been missed once.
 */
export function comparePlanUrgency(a: PlanLike, b: PlanLike, today = new Date()): number {
  const da = planDue(a, today);
  const db = planDue(b, today);
  if (da.statutoryBreach !== db.statutoryBreach) return da.statutoryBreach ? -1 : 1;
  if (da.daysOverdue !== db.daysOverdue) return db.daysOverdue - da.daysOverdue;
  return a.intervalDays - b.intervalDays;
}

export type AssetGrade = "replace" | "watch" | "healthy" | "unknown";

export interface AssetHealthLike {
  code: string;
  jobsYear: number;
  jobsOpen: number;
  downtimeMinutesYear: number;
  partsCostYear: number;
  purchaseCost: number | null;
  criticality: "CRITICAL" | "IMPORTANT" | "ROUTINE";
}

export interface AssetVerdict {
  grade: AssetGrade;
  /** Repair spend this year as a share of what the asset cost. Null if unknown. */
  spendRatio: number | null;
  reason: string;
}

/**
 * Repair or replace, as a number rather than a feeling.
 *
 * The threshold is a share of purchase cost, because that is the comparison
 * being made: another year of this against a new one. A third is the usual
 * trade rule of thumb and is deliberately visible here rather than buried.
 *
 * With no purchase cost the answer is "unknown", never "healthy". An asset
 * nobody costed is not thereby cheap to run, and grading it green would hide
 * exactly the equipment most likely to be old.
 */
export function assetVerdict(a: AssetHealthLike): AssetVerdict {
  const ratio =
    a.purchaseCost && a.purchaseCost > 0 ? a.partsCostYear / a.purchaseCost : null;

  if (ratio === null) {
    return {
      grade: "unknown",
      spendRatio: null,
      reason: "No purchase cost recorded, so repair spend cannot be judged against it.",
    };
  }

  if (ratio >= 0.33) {
    return {
      grade: "replace",
      spendRatio: ratio,
      reason: `Repairs this year are ${Math.round(ratio * 100)}% of what it cost.`,
    };
  }

  // A critical asset is watched sooner. The cost of it stopping is not in the
  // repair bill.
  const watchAt = a.criticality === "CRITICAL" ? 0.12 : 0.2;
  if (ratio >= watchAt || a.jobsYear >= 6) {
    return {
      grade: "watch",
      spendRatio: ratio,
      reason:
        a.jobsYear >= 6
          ? `${a.jobsYear} faults this year.`
          : `Repairs are ${Math.round(ratio * 100)}% of purchase cost on a critical asset.`,
    };
  }

  return { grade: "healthy", spendRatio: ratio, reason: "Nothing unusual this year." };
}

export type LoadState = "over" | "full" | "ok" | "idle" | "off";

export interface ManningLike {
  name: string;
  shiftsToday: number;
  jobsOpen: number;
  jobsLate: number;
  minutesAssigned: number;
}

export interface ManningVerdict {
  state: LoadState;
  /** Assigned minutes as a share of the shift. Null when they are not in. */
  load: number | null;
  note: string;
}

/**
 * Whether today's list is possible with today's people.
 *
 * Somebody not rostered is "off" rather than "idle". They are not a spare
 * capacity to be filled; counting them as available is how a plan that looks
 * fine on screen collapses at seven in the morning.
 */
export function manningVerdict(
  m: ManningLike,
  shiftMinutes = 420,
): ManningVerdict {
  if (m.shiftsToday === 0) {
    return {
      state: "off",
      load: null,
      note: m.jobsOpen > 0 ? `${m.jobsOpen} open job(s), not in today` : "Not in today",
    };
  }
  const capacity = m.shiftsToday * shiftMinutes;
  const load = m.minutesAssigned / capacity;

  if (load > 1) return { state: "over", load, note: `${m.minutesAssigned} minutes on a ${capacity} minute day` };
  if (load >= 0.85) return { state: "full", load, note: "Full" };
  if (load <= 0.25) return { state: "idle", load, note: "Room for more" };
  return { state: "ok", load, note: "Working" };
}

export const PRIORITY_ORDER: Record<string, number> = {
  EMERGENCY: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

export interface WorkOrderLike {
  reference: string | null;
  priority: string;
  status: string;
  dueBy: string | null;
  raisedAt: string;
}

/**
 * The order a technician should work in.
 *
 * Priority first, then how late. Within the same priority an older job outranks
 * a newer one — otherwise a busy week quietly buries everything raised on
 * Monday, which is the complaint every paper system produces.
 */
export function compareWorkOrders(
  a: WorkOrderLike,
  b: WorkOrderLike,
  today = new Date(),
): number {
  const pa = PRIORITY_ORDER[a.priority] ?? 9;
  const pb = PRIORITY_ORDER[b.priority] ?? 9;
  if (pa !== pb) return pa - pb;

  const la = a.dueBy ? daysBetween(toDate(a.dueBy), today) : -9999;
  const lb = b.dueBy ? daysBetween(toDate(b.dueBy), today) : -9999;
  if (la !== lb) return lb - la;

  return new Date(a.raisedAt).getTime() - new Date(b.raisedAt).getTime();
}

/** Open means somebody still has to do something about it. */
export function isOpen(status: string): boolean {
  return status !== "VERIFIED" && status !== "CANCELLED";
}
