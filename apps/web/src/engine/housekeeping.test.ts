import { describe, it, expect } from "vitest";
import {
  standardMinutes, cleanKindFor, proposeSheets, cleanVariance, summariseBoard,
  type RoomTypeLike, type RoomLike, type AttendantLike,
} from "./housekeeping";

/**
 * Building the morning's sheets.
 *
 * The cases that matter are the ones where an even-looking board hides an
 * impossible day: rooms balanced by count rather than by minutes, a villa that
 * nobody has time for, and a room engineering has open.
 */

const villa: RoomTypeLike = {
  id: "t-villa", code: "VILLA",
  departureMinutes: 110, stayoverMinutes: 45, deepCleanMinutes: 240,
};
const standard: RoomTypeLike = {
  id: "t-std", code: "STD",
  departureMinutes: 40, stayoverMinutes: 20, deepCleanMinutes: 100,
};
const types = [villa, standard];

const room = (n: string, typeId: string | null, over: Partial<RoomLike> = {}): RoomLike => ({
  id: `r-${n}`, roomNumber: n, roomTypeId: typeId,
  state: "DIRTY", occupancy: "DEPARTURE", jobsBlocking: 0, ...over,
});

const attendant = (
  id: string, name: string, rostered: number, assigned = 0,
): AttendantLike => ({ employeeId: id, name, minutesRostered: rostered, minutesAssigned: assigned });

describe("how long a room takes", () => {
  it("costs a departure and a stayover differently", () => {
    // Different jobs. Costing them the same makes every sheet wrong in
    // whichever direction the day happens to lean.
    expect(standardMinutes("DEPARTURE", villa)).toBe(110);
    expect(standardMinutes("STAYOVER", villa)).toBe(45);
  });

  it("falls back to a departure standard for a room with no type, not to zero", () => {
    // Zero would make an untyped room free, and free rooms are exactly what a
    // balancing pass piles onto one person.
    expect(standardMinutes("DEPARTURE", null)).toBe(40);
    expect(standardMinutes("DEPARTURE", null, 55)).toBe(55);
  });
});

describe("what kind of clean a room needs", () => {
  it("leaves an out-of-service room alone", () => {
    expect(cleanKindFor(room("101", "t-std", { state: "OUT_OF_SERVICE" }))).toBeNull();
  });

  it("leaves an already inspected room alone", () => {
    expect(cleanKindFor(room("101", "t-std", { state: "INSPECTED" }))).toBeNull();
  });

  it("treats unknown occupancy as a departure", () => {
    // Under-planning strands an attendant; over-planning gives time back.
    expect(cleanKindFor(room("101", "t-std", { occupancy: "UNKNOWN" }))).toBe("DEPARTURE");
  });

  it("gives an occupied room a stayover", () => {
    expect(cleanKindFor(room("101", "t-std", { occupancy: "OCCUPIED" }))).toBe("STAYOVER");
  });
});

describe("building the sheets", () => {
  it("balances on minutes rather than on room count", () => {
    // Three villas and three standards split evenly by count gives one person
    // 330 minutes and the other 120, while the board claims the load is even.
    const rooms = [
      room("101", "t-villa"), room("102", "t-villa"), room("103", "t-villa"),
      room("201", "t-std"), room("202", "t-std"), room("203", "t-std"),
    ];
    const people = [attendant("a", "Nyoman", 420), attendant("b", "Kadek", 420)];
    const out = proposeSheets(rooms, types, people);

    expect(out.unassigned).toHaveLength(0);
    const [one, two] = out.load.map((l) => l.minutes);
    expect(Math.abs(one - two)).toBeLessThanOrEqual(40);
    expect(one + two).toBe(3 * 110 + 3 * 40);
  });

  it("never proposes past somebody's rostered minutes", () => {
    // The database refuses it. A proposal the database will reject is not a
    // proposal.
    const rooms = [room("101", "t-villa"), room("102", "t-villa")];
    const people = [attendant("a", "Nyoman", 150)];
    const out = proposeSheets(rooms, types, people);

    expect(out.tasks).toHaveLength(1);
    expect(out.load[0].minutes).toBeLessThanOrEqual(150);
    expect(out.unassigned).toHaveLength(1);
    expect(out.unassigned[0].reason).toContain("110 minutes left");
  });

  it("names the rooms nobody can take rather than dropping them", () => {
    // An unassignable room is a staffing decision somebody has to make.
    const rooms = [room("101", "t-villa")];
    const out = proposeSheets(rooms, types, [attendant("a", "Nyoman", 60)]);
    expect(out.tasks).toHaveLength(0);
    expect(out.unassigned[0].roomNumber).toBe("101");
  });

  it("does not send anybody to a room with an open engineering job", () => {
    const rooms = [room("101", "t-std", { jobsBlocking: 1 }), room("102", "t-std")];
    const out = proposeSheets(rooms, types, [attendant("a", "Nyoman", 420)]);
    expect(out.tasks.map((t) => t.roomNumber)).toEqual(["102"]);
    expect(out.unassigned[0].reason).toContain("engineering job");
  });

  it("counts minutes already on a sheet before adding more", () => {
    const rooms = [room("101", "t-villa")];
    const out = proposeSheets(rooms, types, [attendant("a", "Nyoman", 420, 350)]);
    expect(out.tasks).toHaveLength(0); // 350 + 110 > 420
  });

  it("gives the same answer twice", () => {
    // A proposal that shuffles between runs is one nobody trusts enough to
    // accept.
    const rooms = [room("101", "t-std"), room("102", "t-std"), room("103", "t-std")];
    const people = () => [attendant("a", "Nyoman", 420), attendant("b", "Kadek", 420)];
    const first = proposeSheets(rooms, types, people());
    const second = proposeSheets(rooms, types, people());
    expect(first.tasks).toEqual(second.tasks);
  });

  it("skips out-of-service rooms without calling them unassigned", () => {
    const rooms = [room("101", "t-std", { state: "OUT_OF_SERVICE" })];
    const out = proposeSheets(rooms, types, [attendant("a", "Nyoman", 420)]);
    expect(out.tasks).toHaveLength(0);
    expect(out.unassigned).toHaveLength(0);
  });
});

describe("how it actually went", () => {
  it("reports a gap in both directions and judges neither", () => {
    expect(cleanVariance(40, 20).state).toBe("fast");
    expect(cleanVariance(40, 60).state).toBe("slow");
    expect(cleanVariance(40, 42).state).toBe("on");
  });

  it("says unknown rather than on-time when nobody recorded a finish", () => {
    const v = cleanVariance(40, null);
    expect(v.state).toBe("unknown");
    expect(v.deltaMinutes).toBeNull();
  });
});

describe("the board summary", () => {
  it("counts only inspected rooms as sellable", () => {
    // Clean but not inspected is the attendant's opinion. A front desk that
    // sells on it finds out the difference through the guest.
    const s = summariseBoard([
      { state: "CLEAN", jobsBlocking: 0, taskStatus: "DONE" },
      { state: "INSPECTED", jobsBlocking: 0, taskStatus: "INSPECTED" },
      { state: "DIRTY", jobsBlocking: 0, taskStatus: null },
    ]);
    expect(s.clean).toBe(1);
    expect(s.inspected).toBe(1);
    expect(s.sellable).toBe(1);
  });

  it("counts a blocked room separately from its cleaning state", () => {
    const s = summariseBoard([
      { state: "DIRTY", jobsBlocking: 2, taskStatus: null },
    ]);
    expect(s.blocked).toBe(1);
    expect(s.dirty).toBe(1);
  });
});
