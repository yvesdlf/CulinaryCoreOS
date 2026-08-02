// ---------------------------------------------------------------------------
// People — leave balances, certification currency, shift eligibility
// ---------------------------------------------------------------------------
// Three calculations a hospitality venue actually argues about, done
// deterministically so the answer is the same for everyone looking at it.
//
// Payroll is deliberately absent. The brief is explicit that tax, statutory
// filing and payment belong to a specialist provider, and a half-built payroll
// engine is worse than none: it produces numbers people believe.
// ---------------------------------------------------------------------------

import { toDecimal } from "./cost-engine";

export type EmploymentStatus =
  | "APPLICANT" | "OFFER" | "PROBATION" | "ACTIVE"
  | "SUSPENDED" | "NOTICE" | "RESIGNED" | "TERMINATED" | "ARCHIVED";

export interface Employee {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  departmentId: string | null;
  jobRoleId: string | null;
  managerId: string | null;
  employmentStatus: EmploymentStatus;
  employmentType: string;
  startedOn: string | null;
  contractedHoursPerWeek: number | null;
}

export interface Certification {
  id: string;
  employeeId: string;
  kind: string;
  expiresOn: string | null;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  startsOn: string;
  endsOn: string;
  days: number;
  status: string;
}

export interface LeaveType {
  id: string;
  code: string;
  name: string;
  paid: boolean;
  annualEntitlementDays: number | null;
  maxCarryoverDays: number | null;
}

export function fullName(e: Employee): string {
  return `${e.firstName} ${e.lastName}`.trim();
}

/** Statuses where somebody is actually working and can be rostered. */
export const WORKING_STATUSES: EmploymentStatus[] = ["PROBATION", "ACTIVE", "NOTICE"];

export function isWorking(e: Employee): boolean {
  return WORKING_STATUSES.includes(e.employmentStatus);
}

// ── Leave ───────────────────────────────────────────────────────────────────

export interface LeaveBalance {
  leaveType: LeaveType;
  /** Pro-rated for a part-time contract and for a mid-year start. */
  entitlement: number;
  taken: number;
  /** Approved but not yet started. Committed, like an approved purchase order. */
  booked: number;
  remaining: number;
}

/**
 * Days a full-time week is assumed to be, for pro-rating a part-time
 * entitlement. A venue with a different pattern changes this once.
 */
const FULL_TIME_HOURS = 40;

/**
 * Leave balance for one employee.
 *
 * Approved-but-not-taken leave is subtracted as well as leave already taken.
 * A balance that counted only the past would tell somebody they have a fortnight
 * left in December when they have already booked it for Christmas.
 *
 * A mid-year start is pro-rated by whole months remaining, which is the
 * convention a rota is argued about with — not by days, which produces figures
 * nobody can check in their head.
 */
export function leaveBalance(
  employee: Employee,
  type: LeaveType,
  requests: LeaveRequest[],
  yearStart: Date,
  yearEnd: Date,
): LeaveBalance {
  const base = type.annualEntitlementDays ?? 0;

  const partTime =
    employee.contractedHoursPerWeek && employee.contractedHoursPerWeek < FULL_TIME_HOURS
      ? employee.contractedHoursPerWeek / FULL_TIME_HOURS
      : 1;

  let proRata = 1;
  if (employee.startedOn) {
    const started = new Date(`${employee.startedOn}T00:00:00Z`);
    if (started > yearStart && started <= yearEnd) {
      const monthsWorked =
        (yearEnd.getUTCFullYear() - started.getUTCFullYear()) * 12 +
        (yearEnd.getUTCMonth() - started.getUTCMonth()) + 1;
      proRata = Math.max(0, Math.min(12, monthsWorked)) / 12;
    } else if (started > yearEnd) {
      proRata = 0;
    }
  }

  const entitlement = Number((base * partTime * proRata).toFixed(2));

  const mine = requests.filter(
    (r) => r.employeeId === employee.id && r.leaveTypeId === type.id,
  );
  const inYear = (r: LeaveRequest) =>
    Date.parse(`${r.startsOn}T00:00:00Z`) >= yearStart.getTime() &&
    Date.parse(`${r.startsOn}T00:00:00Z`) <= yearEnd.getTime();

  const taken = mine
    .filter((r) => r.status === "TAKEN" && inYear(r))
    .reduce((n, r) => n + r.days, 0);
  const booked = mine
    .filter((r) => r.status === "APPROVED" && inYear(r))
    .reduce((n, r) => n + r.days, 0);

  return {
    leaveType: type,
    entitlement,
    taken,
    booked,
    remaining: Number((entitlement - taken - booked).toFixed(2)),
  };
}

export interface LeaveConflict {
  employeeName: string;
  startsOn: string;
  endsOn: string;
}

/**
 * Who else in the same department is already off across these dates.
 *
 * Not a refusal — a venue sometimes has to let two chefs go at once — but the
 * manager approving it should not have to remember.
 */
export function overlappingLeave(
  candidate: { employeeId: string; startsOn: string; endsOn: string },
  requests: LeaveRequest[],
  employees: Employee[],
  departmentId: string | null,
): LeaveConflict[] {
  const byId = new Map(employees.map((e) => [e.id, e]));
  return requests
    .filter((r) => r.employeeId !== candidate.employeeId)
    .filter((r) => ["APPROVED", "TAKEN"].includes(r.status))
    .filter((r) => {
      const other = byId.get(r.employeeId);
      if (!other) return false;
      if (departmentId && other.departmentId !== departmentId) return false;
      // Overlap if neither range ends before the other begins.
      return !(r.endsOn < candidate.startsOn || r.startsOn > candidate.endsOn);
    })
    .map((r) => ({
      employeeName: fullName(byId.get(r.employeeId)!),
      startsOn: r.startsOn,
      endsOn: r.endsOn,
    }))
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
}

// ── Certification ───────────────────────────────────────────────────────────

export type CertificationState = "valid" | "expiring" | "expired" | "missing";

export interface EligibilityVerdict {
  eligible: boolean;
  /** What the role needs and the state of each. */
  requirements: { kind: string; state: CertificationState; expiresOn: string | null }[];
  reason: string | null;
}

const CERT_WARNING_DAYS = 30;

function daysUntil(iso: string, today: Date): number {
  return Math.floor(
    (Date.parse(`${iso}T00:00:00Z`) -
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) /
      86_400_000,
  );
}

/**
 * Whether somebody may work a role today.
 *
 * Food-safety training is a legal requirement under Regulation 852/2004
 * Annex II Chapter XII, so an expired certificate is a reason not to roster
 * somebody rather than a note for later. A certificate with no expiry is
 * treated as valid: many do not expire, and inventing one would ground half
 * a kitchen.
 */
export function checkEligibility(
  employee: Employee,
  requiredKinds: string[],
  certifications: Certification[],
  today: Date,
): EligibilityVerdict {
  const mine = certifications.filter((c) => c.employeeId === employee.id);

  const requirements = requiredKinds.map((kind) => {
    const held = mine
      .filter((c) => c.kind === kind)
      // The most generous expiry wins: holding two, one lapsed, is still held.
      .sort((a, b) => (b.expiresOn ?? "9999").localeCompare(a.expiresOn ?? "9999"));
    const best = held[0];
    if (!best) return { kind, state: "missing" as const, expiresOn: null };
    if (!best.expiresOn) return { kind, state: "valid" as const, expiresOn: null };
    const left = daysUntil(best.expiresOn, today);
    return {
      kind,
      state: (left < 0 ? "expired" : left <= CERT_WARNING_DAYS ? "expiring" : "valid") as CertificationState,
      expiresOn: best.expiresOn,
    };
  });

  const blocking = requirements.filter(
    (r) => r.state === "missing" || r.state === "expired",
  );

  if (!isWorking(employee)) {
    return {
      eligible: false,
      requirements,
      reason: `${fullName(employee)} is ${employee.employmentStatus.toLowerCase()} and cannot be rostered.`,
    };
  }

  return {
    eligible: blocking.length === 0,
    requirements,
    reason:
      blocking.length === 0
        ? null
        : `${blocking.map((b) => b.kind).join(", ")} ${blocking.length === 1 ? "is" : "are"} ${
            blocking.every((b) => b.state === "missing") ? "missing" : "not current"
          }.`,
  };
}

/** Certificates that have lapsed or will within the window, most urgent first. */
export function lapsingCertifications(
  certifications: Certification[],
  employees: Employee[],
  today: Date,
  withinDays = CERT_WARNING_DAYS,
): { certification: Certification; employeeName: string; daysLeft: number }[] {
  const byId = new Map(employees.map((e) => [e.id, e]));
  return certifications
    .filter((c) => c.expiresOn)
    .map((c) => ({
      certification: c,
      employeeName: byId.has(c.employeeId)
        ? fullName(byId.get(c.employeeId)!)
        : "Unknown",
      daysLeft: daysUntil(c.expiresOn!, today),
    }))
    .filter((r) => r.daysLeft <= withinDays)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

// ── Headcount ───────────────────────────────────────────────────────────────

export interface Headcount {
  total: number;
  working: number;
  byStatus: Record<string, number>;
  byDepartment: { departmentId: string | null; count: number }[];
  /** Full-time equivalent, from contracted hours. */
  fte: string;
}

export function headcount(employees: Employee[]): Headcount {
  const working = employees.filter(isWorking);
  const byStatus: Record<string, number> = {};
  for (const e of employees) {
    byStatus[e.employmentStatus] = (byStatus[e.employmentStatus] ?? 0) + 1;
  }
  const byDepartment = new Map<string | null, number>();
  for (const e of working) {
    byDepartment.set(e.departmentId, (byDepartment.get(e.departmentId) ?? 0) + 1);
  }
  const fte = working.reduce(
    (acc, e) =>
      acc.plus(
        toDecimal(
          e.contractedHoursPerWeek
            ? e.contractedHoursPerWeek / FULL_TIME_HOURS
            : 1,
        ),
      ),
    toDecimal(0),
  );
  return {
    total: employees.length,
    working: working.length,
    byStatus,
    byDepartment: [...byDepartment.entries()]
      .map(([departmentId, count]) => ({ departmentId, count }))
      .sort((a, b) => b.count - a.count),
    fte: fte.toFixed(2),
  };
}
