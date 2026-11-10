import { describe, it, expect } from "vitest";
import {
  periodContaining, sameTimeLastYear, isoWeek, countWeekendDays,
  clipToElapsed, daysInclusive, shiftDays, weekday,
} from "./periods";

/*
 * Dates are chosen, not generated. Each one is here because it is a case the
 * naive version gets wrong, and the comment says which.
 */
describe("periods", () => {
  describe("the shapes", () => {
    it("a week starts on Monday and ends on Sunday", () => {
      // 2026-11-10 is a Tuesday.
      const p = periodContaining("WEEK", "2026-11-10", "2026-11-20");
      expect(p.from).toBe("2026-11-09");
      expect(p.to).toBe("2026-11-15");
      expect(weekday(p.from)).toBe(1);
      expect(weekday(p.to)).toBe(7);
      expect(p.days).toBe(7);
    });

    it("a month knows its own length, including February in a leap year", () => {
      expect(periodContaining("MONTH", "2024-02-10", "2025-01-01").days).toBe(29);
      expect(periodContaining("MONTH", "2026-02-10", "2027-01-01").days).toBe(28);
      // 1900 was not a leap year; 2000 was. The rule nobody implements twice.
      expect(periodContaining("MONTH", "2000-02-10", "2001-01-01").days).toBe(29);
    });

    it("a quarter runs to the end of its third month", () => {
      const q = periodContaining("QUARTER", "2026-11-10", "2027-01-01");
      expect([q.from, q.to]).toEqual(["2026-10-01", "2026-12-31"]);
      expect(q.label).toBe("Q4 2026");
    });

    it("year to date runs to the day asked about, not to December", () => {
      const p = periodContaining("YTD", "2026-11-10", "2026-11-11");
      expect([p.from, p.to]).toEqual(["2026-01-01", "2026-11-10"]);
    });
  });

  describe("completeness", () => {
    it("a period containing today is not finished", () => {
      expect(periodContaining("MONTH", "2026-11-10", "2026-11-10").complete).toBe(false);
      expect(periodContaining("MONTH", "2026-10-10", "2026-11-10").complete).toBe(true);
    });

    it("and neither is one in the future", () => {
      expect(periodContaining("MONTH", "2027-03-01", "2026-11-10").complete).toBe(false);
    });
  });

  describe("ISO week numbers", () => {
    /*
     * The case that makes "the nth Monday" wrong: 1 January 2027 is a Friday,
     * so that week belongs to 2026 and is week 53. A sheet headed "Week 1,
     * 2027" covering December would be wrong in a way nobody would question.
     */
    it("puts early January in the year that holds the week's Thursday", () => {
      expect(isoWeek("2027-01-01")).toEqual({ week: 53, year: 2026 });
      expect(isoWeek("2026-01-01")).toEqual({ week: 1, year: 2026 });
    });
  });

  describe("this time last year", () => {
    /*
     * The decision this whole file exists for. A Saturday must be compared
     * with a Saturday, or a venue that takes most of its money at the weekend
     * looks like it has collapsed.
     */
    it("holds the weekday for a day, by going back 52 weeks", () => {
      const current = periodContaining("DAY", "2026-11-07", "2026-11-10"); // Saturday
      const c = sameTimeLastYear(current, "2026-11-10");
      expect(c.basis).toBe("WEEKDAY");
      expect(c.previous.from).toBe("2025-11-08");
      expect(weekday(c.previous.from)).toBe(weekday(current.from));
      // And the naive answer, which is a Friday:
      expect(weekday("2025-11-07")).not.toBe(weekday("2026-11-07"));
    });

    it("holds the weekday for a week too", () => {
      const current = periodContaining("WEEK", "2026-11-10", "2026-11-20");
      const c = sameTimeLastYear(current, "2026-11-20");
      expect(c.basis).toBe("WEEKDAY");
      expect(weekday(c.previous.from)).toBe(1);
      expect(c.previous.days).toBe(7);
    });

    /*
     * And the opposite rule for a month: 364 days back from November starts
     * in early November and ends in early December, comparing a month's
     * trading against a third of a different month.
     */
    it("holds the season for a month, by using the calendar", () => {
      const current = periodContaining("MONTH", "2026-11-10", "2026-12-31");
      const c = sameTimeLastYear(current, "2026-12-31");
      expect(c.basis).toBe("CALENDAR");
      expect([c.previous.from, c.previous.to]).toEqual(["2025-11-01", "2025-11-30"]);
    });

    it("says when the two periods hold different numbers of weekend days", () => {
      const current = periodContaining("MONTH", "2026-11-10", "2026-12-31");
      const c = sameTimeLastYear(current, "2026-12-31");
      const now = countWeekendDays(current.from, current.to);
      const then = countWeekendDays(c.previous.from, c.previous.to);
      if (now !== then) {
        expect(c.likeForLike).toBe(false);
        expect(c.caveats.join(" ")).toContain("weekend days");
      } else {
        expect(c.caveats.join(" ")).not.toContain("weekend days");
      }
    });

    it("says when February is a day shorter", () => {
      const current = periodContaining("MONTH", "2024-02-10", "2024-12-31");
      const c = sameTimeLastYear(current, "2024-12-31");
      expect(c.previous.days).toBe(28);
      expect(c.caveats.join(" ")).toContain("28 days against 29");
    });

    it("refuses to pretend an unfinished period is comparable", () => {
      const current = periodContaining("MONTH", "2026-11-10", "2026-11-10");
      const c = sameTimeLastYear(current, "2026-11-10");
      expect(c.likeForLike).toBe(false);
      expect(c.caveats.join(" ")).toContain("not finished");
    });

    it("and a finished one against a finished one needs no caveat at all", () => {
      // Two weeks: same length, same weekdays, both over.
      const current = periodContaining("WEEK", "2026-10-05", "2026-11-10");
      const c = sameTimeLastYear(current, "2026-11-10");
      expect(c.likeForLike).toBe(true);
      expect(c.caveats).toEqual([]);
    });

    /* 29 February has no counterpart, and the sheet says so rather than
       silently sliding to 1 March or to the 28th. */
    it("names the leap day it cannot match", () => {
      const current = periodContaining("YTD", "2024-02-29", "2024-03-01");
      const c = sameTimeLastYear(current, "2024-03-01");
      expect(c.previous.to).toBe("2023-02-28");
      expect(c.caveats.join(" ")).toContain("29 February");
    });
  });

  describe("clipping last year to what has elapsed", () => {
    it("compares nine days with nine days, not with thirty", () => {
      const current = periodContaining("MONTH", "2026-11-10", "2026-11-10");
      const c = sameTimeLastYear(current, "2026-11-10");
      const clipped = clipToElapsed(c.previous, current, "2026-11-10");
      expect(clipped.days).toBe(9);              // the 1st to the 9th
      expect(clipped.to).toBe("2025-11-09");
      expect(clipped.label).toContain("first 9 days");
    });

    it("leaves a finished period alone", () => {
      const current = periodContaining("MONTH", "2026-10-10", "2026-11-10");
      const c = sameTimeLastYear(current, "2026-11-10");
      expect(clipToElapsed(c.previous, current, "2026-11-10")).toEqual(c.previous);
    });
  });

  describe("the arithmetic underneath", () => {
    it("counts both ends of a range", () => {
      expect(daysInclusive("2026-11-10", "2026-11-10")).toBe(1);
      expect(daysInclusive("2026-11-01", "2026-11-30")).toBe(30);
    });

    /* Crosses the DST boundary in most of the world. These are ISO dates and
       must not care — the bug this guards is doing date maths with local
       `Date`, where 25 October is 25 hours long. */
    it("adds days across a daylight-saving boundary", () => {
      expect(shiftDays("2026-10-24", 1)).toBe("2026-10-25");
      expect(shiftDays("2026-10-25", 1)).toBe("2026-10-26");
      expect(daysInclusive("2026-10-24", "2026-10-26")).toBe(3);
    });
  });
});
