import { describe, expect, it } from "vitest";
import { avatarTint } from "./person-avatar";

describe("avatarTint", () => {
  it("is one of the six tokens that exist", () => {
    for (const name of ["Wayan Sutrisna", "A", "", "Jamie Stewart", "李 明"]) {
      const t = avatarTint(name);
      expect(t).toBeGreaterThanOrEqual(1);
      expect(t).toBeLessThanOrEqual(6);
    }
  });

  it("gives the same person the same tint every time", () => {
    expect(avatarTint("Jamie Stewart")).toBe(avatarTint("Jamie Stewart"));
  });

  it("ignores case and surrounding space, so one person is one colour", () => {
    expect(avatarTint("  jamie stewart ")).toBe(avatarTint("Jamie Stewart"));
  });

  it("separates people whose initials collide, which is the case it exists for", () => {
    // Both render "JS". A tint keyed on the initials would make them identical.
    expect(avatarTint("Jamie Stewart")).not.toBe(avatarTint("Jo Sumarno"));
  });

  it("spreads a realistic rota across more than one tint", () => {
    const rota = [
      "Wayan Sutrisna", "Kadek Ayu", "Made Partha", "Nyoman Rai",
      "Ketut Sari", "Gede Arya", "Putu Desi", "Komang Bagus",
    ];
    expect(new Set(rota.map(avatarTint)).size).toBeGreaterThan(2);
  });
});
