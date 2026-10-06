import { afterEach, describe, expect, it } from "vitest";
import { addDays, venueDate } from "./today";
import { DEFAULT_VENUE, setVenue } from "./venue";

// The instant every case below is about: 20:30 UTC on 6 October 2026.
const EVENING_UTC = "2026-10-06T20:30:00Z";

describe("venueDate", () => {
  afterEach(() => setVenue(DEFAULT_VENUE));

  it("is the venue's calendar date, not UTC's", () => {
    // Bali is UTC+8: half past four the next morning.
    setVenue({ ...DEFAULT_VENUE, timezone: "Asia/Makassar" });
    expect(venueDate(EVENING_UTC)).toBe("2026-10-07");
  });

  it("is UTC's date where the venue is on UTC", () => {
    setVenue({ ...DEFAULT_VENUE, timezone: "UTC" });
    expect(venueDate(EVENING_UTC)).toBe("2026-10-06");
  });

  it("moves backwards west of Greenwich", () => {
    // Honolulu is UTC-10: three in the morning UTC on the 7th is five in the
    // evening of the 6th there.
    setVenue({ ...DEFAULT_VENUE, timezone: "Pacific/Honolulu" });
    expect(venueDate("2026-10-07T03:00:00Z")).toBe("2026-10-06");
  });
});

describe("addDays", () => {
  it("crosses a month end", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
  });

  it("goes backwards across a year", () => {
    expect(addDays("2026-01-02", -13)).toBe("2025-12-20");
  });

  it("is not moved by a daylight-saving change", () => {
    // Europe moves its clocks on 25 October 2026; a date is not an instant.
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
  });
});
