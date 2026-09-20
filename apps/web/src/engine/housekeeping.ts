// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------
// Building a morning's assignment sheets, and judging what came back.
//
// The sheet is the whole job. Everything else on a housekeeping screen is a
// report on how it went; this is the part that decides whether the day works.
//
// Three positions worth stating:
//
//   Balance on minutes, never on room count. Six villas and six standards are
//   the same number and twice the work, and an attendant given the villas
//   finishes two hours late every time while the board says the load was even.
//
//   Never plan past somebody's rostered minutes. The database refuses it, and
//   this refuses to propose it — a proposal the database will reject is not a
//   proposal. What overflows is reported as unassigned, by name, because an
//   unassignable room is a staffing decision somebody has to make rather than
//   a row to hide.
//
//   A room with a blocking fault is not offered for cleaning at all. Sending
//   an attendant to a room engineering has open wastes the visit and teaches
//   people the sheet is wrong.
// ---------------------------------------------------------------------------

export type TaskKind = "DEPARTURE" | "STAYOVER" | "DEEP_CLEAN" | "TURNDOWN" | "PUBLIC_AREA" | "LINEN";

export interface RoomTypeLike {
  id: string;
  code: string;
  departureMinutes: number;
  stayoverMinutes: number;
  deepCleanMinutes: number;
}

export interface RoomLike {
  id: string;
  roomNumber: string;
  roomTypeId: string | null;
  state: string;
  occupancy: string;
  /** Open EMERGENCY or HIGH work orders against this room. */
  jobsBlocking: number;
}

export interface AttendantLike {
  employeeId: string;
  name: string;
  minutesRostered: number;
  /** Minutes already on their sheet before this run. */
  minutesAssigned: number;
}

/**
 * How long this room takes, for this kind of clean.
 *
 * A room with no type falls back to a departure standard rather than to zero.
 * Zero would make an untyped room free, and free rooms are exactly what a
 * balancing pass piles onto one person.
 */
export function standardMinutes(
  kind: TaskKind,
  type: RoomTypeLike | null | undefined,
  fallback = 40,
): number {
  if (!type) return fallback;
  switch (kind) {
    case "DEPARTURE":
      return type.departureMinutes;
    case "STAYOVER":
    case "TURNDOWN":
      return type.stayoverMinutes;
    case "DEEP_CLEAN":
      return type.deepCleanMinutes;
    default:
      return fallback;
  }
}

/**
 * Which rooms need doing today, and what kind of clean each needs.
 *
 * Derived from occupancy, which without a property management system is
 * whatever somebody last recorded. A room whose occupancy is unknown is
 * offered as a departure — the longer job — because under-planning a room
 * leaves an attendant stranded and over-planning one gives back time.
 */
export function cleanKindFor(room: RoomLike): TaskKind | null {
  if (room.state === "OUT_OF_SERVICE") return null;
  if (room.state === "INSPECTED") return null;
  switch (room.occupancy) {
    case "DEPARTURE":
    case "VACANT":
      return "DEPARTURE";
    case "STAYOVER":
    case "OCCUPIED":
      return "STAYOVER";
    case "ARRIVAL":
      return "DEPARTURE";
    default:
      return "DEPARTURE";
  }
}

export interface ProposedTask {
  roomId: string;
  roomNumber: string;
  kind: TaskKind;
  standardMinutes: number;
  employeeId: string;
  attendantName: string;
}

export interface UnassignedRoom {
  roomId: string;
  roomNumber: string;
  kind: TaskKind;
  standardMinutes: number;
  reason: string;
}

export interface SheetProposal {
  tasks: ProposedTask[];
  unassigned: UnassignedRoom[];
  /** Minutes per attendant after the run, for showing the balance achieved. */
  load: { employeeId: string; name: string; minutes: number; rostered: number }[];
}

/**
 * Build the morning's sheets.
 *
 * Longest room first onto whoever has the most room left. Taking rooms in
 * order instead leaves the villas until last, by which point the only person
 * with capacity is the one who should not have them.
 *
 * Deterministic on ties — attendant order, then room number — because a
 * proposal that shuffles between two runs is one nobody trusts enough to
 * accept.
 */
export function proposeSheets(
  rooms: RoomLike[],
  types: RoomTypeLike[],
  attendants: AttendantLike[],
): SheetProposal {
  const typeById = new Map(types.map((t) => [t.id, t]));
  const load = attendants.map((a) => ({
    employeeId: a.employeeId,
    name: a.name,
    minutes: a.minutesAssigned,
    rostered: a.minutesRostered,
  }));

  const tasks: ProposedTask[] = [];
  const unassigned: UnassignedRoom[] = [];

  const work = rooms
    .map((room) => {
      const kind = cleanKindFor(room);
      if (!kind) return null;
      return {
        room,
        kind,
        minutes: standardMinutes(kind, room.roomTypeId ? typeById.get(room.roomTypeId) : null),
      };
    })
    .filter((w): w is { room: RoomLike; kind: TaskKind; minutes: number } => w !== null)
    .sort((a, b) =>
      b.minutes !== a.minutes
        ? b.minutes - a.minutes
        : a.room.roomNumber.localeCompare(b.room.roomNumber, undefined, { numeric: true }),
    );

  for (const item of work) {
    if (item.room.jobsBlocking > 0) {
      unassigned.push({
        roomId: item.room.id,
        roomNumber: item.room.roomNumber,
        kind: item.kind,
        standardMinutes: item.minutes,
        reason: "An engineering job is open on this room.",
      });
      continue;
    }

    // Most remaining capacity wins; ties keep the order attendants arrived in.
    let best: (typeof load)[number] | null = null;
    let bestRoom = -1;
    for (const person of load) {
      const remaining = person.rostered - person.minutes;
      if (remaining < item.minutes) continue;
      if (remaining > bestRoom) {
        best = person;
        bestRoom = remaining;
      }
    }

    if (!best) {
      unassigned.push({
        roomId: item.room.id,
        roomNumber: item.room.roomNumber,
        kind: item.kind,
        standardMinutes: item.minutes,
        reason: `No attendant has ${item.minutes} minutes left today.`,
      });
      continue;
    }

    best.minutes += item.minutes;
    tasks.push({
      roomId: item.room.id,
      roomNumber: item.room.roomNumber,
      kind: item.kind,
      standardMinutes: item.minutes,
      employeeId: best.employeeId,
      attendantName: best.name,
    });
  }

  return { tasks, unassigned, load };
}

export type VarianceState = "fast" | "on" | "slow" | "unknown";

/**
 * How a finished room compared with its standard.
 *
 * Reported both ways and judged neither way on its own. Consistently fast can
 * mean an efficient attendant or a room that was not really cleaned, and the
 * only honest thing a number can do here is show the gap and let the
 * inspection record say which it was.
 */
export function cleanVariance(
  standard: number,
  actual: number | null,
): { state: VarianceState; deltaMinutes: number | null; share: number | null } {
  if (actual === null || standard <= 0) {
    return { state: "unknown", deltaMinutes: null, share: null };
  }
  const delta = actual - standard;
  const share = delta / standard;
  if (share <= -0.25) return { state: "fast", deltaMinutes: delta, share };
  if (share >= 0.25) return { state: "slow", deltaMinutes: delta, share };
  return { state: "on", deltaMinutes: delta, share };
}

export interface BoardRowLike {
  state: string;
  jobsBlocking: number;
  taskStatus: string | null;
}

export interface BoardSummary {
  total: number;
  dirty: number;
  inProgress: number;
  clean: number;
  inspected: number;
  outOfService: number;
  blocked: number;
  /** Rooms that may be sold right now. */
  sellable: number;
}

/**
 * The one line at the top of the board.
 *
 * Sellable counts only inspected rooms. Clean-but-not-inspected is the
 * attendant's opinion, and a front desk that sells on it discovers the
 * difference through the guest.
 */
export function summariseBoard(rows: BoardRowLike[]): BoardSummary {
  const s: BoardSummary = {
    total: rows.length,
    dirty: 0, inProgress: 0, clean: 0, inspected: 0,
    outOfService: 0, blocked: 0, sellable: 0,
  };
  for (const r of rows) {
    if (r.jobsBlocking > 0) s.blocked += 1;
    switch (r.state) {
      case "DIRTY": s.dirty += 1; break;
      case "IN_PROGRESS": s.inProgress += 1; break;
      case "CLEAN": s.clean += 1; break;
      case "INSPECTED": s.inspected += 1; s.sellable += 1; break;
      case "OUT_OF_SERVICE": s.outOfService += 1; break;
    }
  }
  return s;
}
