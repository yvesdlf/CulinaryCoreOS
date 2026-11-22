import { describe, it, expect } from "vitest";
import { financialRanges, variancePct } from "./financial-compare";

const TODAY = "2026-11-21"; // a Saturday

describe("variancePct", () => {
  it("is the signed percentage change", () => {
    expect(variancePct(120, 100)).toBe(20);
    expect(variancePct(80, 100)).toBe(-20);
  });
  it("is null against a zero prior, not an invented 100%", () => {
    // A period with no prior figure has no trend; the dashboard shows a dash.
    expect(variancePct(500, 0)).toBeNull();
  });
  it("rounds to one decimal", () => {
    expect(variancePct(1015, 1000)).toBe(1.5);
  });
});

describe("financialRanges", () => {
  it("previous of an incomplete month is clipped to the same elapsed days", () => {
    // Today is 2026-11-21, so November is 21 days elapsed; the previous month
    // is compared as its first 21 days, not the whole of October — otherwise
    // an unfinished month always looks like a collapse.
    const r = financialRanges({ mode: "PRESET", kind: "MONTH", offset: 0 }, TODAY);
    expect(r.current.from).toBe("2026-11-01");
    expect(r.previous.from).toBe("2026-10-01");
    expect(r.previous.to).toBe("2026-10-20");
    expect(r.previous.days).toBe(20);
  });

  it("previous of a complete month is the whole month before", () => {
    const r = financialRanges({ mode: "PRESET", kind: "MONTH", offset: -1 }, TODAY);
    expect(r.current.from).toBe("2026-10-01");
    expect(r.current.to).toBe("2026-10-31");
    expect(r.previous.from).toBe("2026-09-01");
    expect(r.previous.to).toBe("2026-09-30");
  });

  it("year-ago of a month is the same calendar month a year back", () => {
    const r = financialRanges({ mode: "PRESET", kind: "MONTH", offset: 0 }, TODAY);
    expect(r.yearAgo.from).toBe("2025-11-01");
  });

  it("year-to-date compares against the same stretch last year", () => {
    const r = financialRanges({ mode: "PRESET", kind: "YTD", offset: 0 }, TODAY);
    expect(r.current.from).toBe("2026-01-01");
    expect(r.current.to).toBe(TODAY);
    // The year-ago range ends on the same day-of-year, a year earlier.
    expect(r.yearAgo.from).toBe("2025-01-01");
  });

  it("previous of a custom range is the same length, ending the day before", () => {
    const r = financialRanges(
      { mode: "CUSTOM", from: "2026-11-10", to: "2026-11-16" },
      TODAY,
    );
    expect(r.previous.to).toBe("2026-11-09");
    expect(r.previous.from).toBe("2026-11-03"); // 7 days
  });
});
