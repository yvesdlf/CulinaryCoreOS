import { describe, it, expect } from "vitest";
import { resolveAllergens } from "./allergens";

describe("the ids the database stores", () => {
  /**
   * Every substance in `allergen_substances` (0119), by hand.
   *
   * Written out rather than read from the database, because the point is to
   * fail *here* when the two drift — a test that queried the database would
   * agree with whatever the database said, which is the one thing it must
   * not do. Two of these did not resolve when the ids were normalised, and
   * nothing would have caught it until a screen showed "GLUTEN_CEREALS" as
   * an unrecognised allergen.
   */
  const STORED_IDS = [
    "CELERY", "GLUTEN_CEREALS", "WHEAT", "CRUSTACEANS", "MOLLUSCS",
    "EGGS", "FISH", "LUPIN", "MILK", "MUSTARD", "PEANUTS", "SESAME",
    "SOYBEANS", "SULPHITES", "TREE_NUTS",
  ];

  it.each(STORED_IDS)("resolves %s to a named substance", (id) => {
    const [resolved] = resolveAllergens([id]);
    expect(resolved.known).toBe(true);
    if (resolved.known) expect(resolved.definition.name).toBeTruthy();
  });

  it("still keeps an id it does not know, rather than dropping it", () => {
    const resolved = resolveAllergens(["MILK", "BUCKWHEAT"]);
    expect(resolved).toHaveLength(2);
    expect(resolved.some((r) => !r.known)).toBe(true);
  });
});
