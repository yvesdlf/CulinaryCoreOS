import { describe, expect, it } from "vitest";
import { unitOptions, type PickableUnit } from "./units";

const KIT: PickableUnit = { id: "u-kit", name: "Kitchen", active: true };
const BAR: PickableUnit = { id: "u-bar", name: "Bar", active: true };
const CAFE: PickableUnit = { id: "u-cafe", name: "Café", active: false };

describe("unitOptions", () => {
  it("offers the live units for a new record", () => {
    expect(unitOptions([KIT, BAR, CAFE]).map((o) => o.id)).toEqual(["u-kit", "u-bar"]);
  });

  it("leaves a closed unit out when nothing is on it", () => {
    expect(unitOptions([KIT, CAFE], null).some((o) => o.closed)).toBe(false);
  });

  it("keeps the closed unit a record is already on, so the picker is not blank", () => {
    const options = unitOptions([KIT, BAR, CAFE], "u-cafe");
    expect(options.map((o) => o.id)).toEqual(["u-kit", "u-bar", "u-cafe"]);
    expect(options.at(-1)).toEqual({ id: "u-cafe", label: "Café (closed)", closed: true });
  });

  it("says so, rather than passing a closed unit off as live", () => {
    expect(unitOptions([CAFE], "u-cafe").at(-1)?.label).toBe("Café (closed)");
  });

  it("does not list a live unit twice when it is also the current one", () => {
    const options = unitOptions([KIT, BAR], "u-kit");
    expect(options.filter((o) => o.id === "u-kit")).toHaveLength(1);
    expect(options.every((o) => !o.closed)).toBe(true);
  });

  it("invents nothing for a unit that is not in the list at all", () => {
    // A deleted unit, or another venue's. There is no name to label it with.
    expect(unitOptions([KIT], "u-gone").map((o) => o.id)).toEqual(["u-kit"]);
  });

  it("treats an empty string the same as no current unit", () => {
    expect(unitOptions([KIT, CAFE], "").map((o) => o.id)).toEqual(["u-kit"]);
  });

  it("holds the live order it was given", () => {
    expect(unitOptions([BAR, KIT]).map((o) => o.label)).toEqual(["Bar", "Kitchen"]);
  });
});
