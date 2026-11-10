import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { coalesce } from "./coalesce";

describe("coalesce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs once for a burst, after the burst has stopped", () => {
    const run = vi.fn();
    const c = coalesce(run, 1000);
    // One save in this app is one transaction and many row events.
    c.nudge(); c.nudge(); c.nudge();
    vi.advanceTimersByTime(999);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs again for a later burst", () => {
    const run = vi.fn();
    const c = coalesce(run, 1000);
    c.nudge();
    vi.advanceTimersByTime(1000);
    c.nudge();
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not run at all once cancelled", () => {
    const run = vi.fn();
    const c = coalesce(run, 1000);
    c.nudge();
    c.cancel();
    vi.advanceTimersByTime(5000);
    expect(run).not.toHaveBeenCalled();
  });

  /*
   * The trailing edge is the point, not an implementation detail: a leading
   * one would read the catalogue in the middle of the transaction that
   * triggered it and then stay quiet for the rows that mattered.
   */
  it("does not run on the leading edge", () => {
    const run = vi.fn();
    const c = coalesce(run, 1000);
    c.nudge();
    expect(run).not.toHaveBeenCalled();
  });
});
