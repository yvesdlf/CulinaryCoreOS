import { describe, it, expect } from "vitest";
import type { Product, SubRecipe, IngredientLine } from "@ccos/shared";
import { EMPTY_PREPARATION } from "@ccos/shared";
import {
  proposeCompletion,
  completionCost,
  unrecordableReason,
  recordableTasks,
  varianceVerdict,
  compareVarianceRows,
  summariseVariance,
  stockUnitOf,
  suggestLot,
  type LotChoice,
  type VarianceRow,
} from "./production-records";
import type { PrepTask } from "./production";

/**
 * Recording production, and reading the variance.
 *
 * Every case here is a position somebody could take differently, and the ones
 * that matter are where the convenient answer is wrong: converting between two
 * units because the names look related, treating an absent record as a zero,
 * and reading under-usage as good news.
 */

let seq = 0;
const line = (over: Partial<IngredientLine> = {}): IngredientLine => ({
  id: `l${seq++}`, lineNumber: 1, productId: null, subRecipeId: null,
  nettQty: 100, nettUnit: "g", refPercent: 0, grossQty: 100, grossUnit: "g",
  costPerUnit: "1", lineCost: "100", ...over,
});

const product = (
  id: string,
  over: { price?: string; totalUnit?: string; stockUnit?: string | null } = {},
): Product =>
  ({
    id, name: id, category: "T", supplier: null, supplierId: null, brand: null,
    packing: {
      packQty: 1, packUnit: "g", unitsPerPack: 1, unitsPerPackUnit: "g",
      totalQty: 1, totalUnit: over.totalUnit ?? "g",
    },
    cost: {
      buyingPricePerPack: over.price ?? "10", buyingPricePerUnit: over.price ?? "10",
      grossPricePerUnit: over.price ?? "10", nettPricePerUnit: over.price ?? "10",
    },
    yield_: { grossQty: 1, grossUnit: "g", wasteQty: 0, wasteUnit: "g", nettQty: 1, nettUnit: "g", refPercent: 0, yieldPercent: 100 },
    status: "ACTIVE",
    nutrition: { fatG: 0, carbsG: 0, proteinG: 0, vitAMg: 0, vitCMg: 0, calciumMg: 0, ironMg: 0, sodiumMg: 0, kcal: 0 },
    allergens: [], allergensNeedReview: false, allergenReviewNote: null,
    parLevel: null, reorderPoint: null, stockUnit: over.stockUnit ?? null,
    version: 1, createdAt: "", updatedAt: "",
  }) as Product;

const sub = (
  id: string,
  lines: IngredientLine[],
  batchYield: { qty: number; unit: string } = { qty: 1000, unit: "g" },
): SubRecipe =>
  ({
    id, name: id, category: "T", status: "ACTUAL", ingredientLines: lines,
    batchYield,
    totalCost: "0", costPerUnit: "0", wastePercent: 0, inflationPercent: 0, taxPercent: 21,
    nutritionPer100g: { fatG: 0, carbsG: 0, proteinG: 0, vitAMg: 0, vitCMg: 0, calciumMg: 0, ironMg: 0, sodiumMg: 0, kcal: 0 },
    allergens: [], preparation: EMPTY_PREPARATION, version: 1, createdAt: "", updatedAt: "",
  }) as SubRecipe;

const row = (over: Partial<VarianceRow> = {}): VarianceRow => ({
  productId: "p", productName: "p", category: "T", unit: "g",
  theoreticalQty: 100, actualQty: 100, actualQtyUnlinked: 0,
  varianceQty: 0, variancePercent: 0, unitCost: "10",
  theoreticalCost: "1000.00", actualCost: "1000.00", varianceCost: "0.00",
  batchesRecorded: 1, movements: 1, recipeChanged: false,
  comparable: true, note: null, ...over,
});

describe("what a batch consumed", () => {
  it("scales the ingredient list by whole and part batches alike", () => {
    // The planner rounds up to whole batches because a 1 kg preparation cannot
    // be made 0,9 times. Recording is the other way round: a cook who made
    // three quarters of a batch has to be able to say so, because the
    // alternative is a record that is wrong on purpose.
    const p = proposeCompletion(sub("mash", [line({ productId: "butter" })]), 0.75, [
      product("butter"),
    ]);
    expect(p.consumption[0].quantity).toBe(75);
    expect(p.quantityMade).toBe(750);
  });

  it("uses the gross quantity, so trim is counted", () => {
    // The ledger records what left the shelf and peelings leave the shelf.
    // Pre-filling the nett figure would make every vegetable read as
    // over-portioned the moment the cook accepted the default.
    const p = proposeCompletion(
      sub("mash", [line({ productId: "onion", nettQty: 100, grossQty: 125, refPercent: 20 })]),
      1,
      [product("onion")],
    );
    expect(p.consumption[0].quantity).toBe(125);
  });

  it("refuses to convert between the recipe's unit and the shelf's", () => {
    // A conversion factor guessed from two unit names is exactly how grams
    // become kilograms. The line is left out and named, so the cook types the
    // real figure rather than accepting one that is wrong by a thousand.
    const p = proposeCompletion(
      sub("mash", [line({ productId: "butter", grossUnit: "g" })]),
      2,
      [product("butter", { totalUnit: "kg" })],
    );
    expect(p.consumption).toHaveLength(0);
    expect(p.problems.join(" ")).toContain("cannot be filled in");
  });

  it("does not explode a preparation inside a preparation", () => {
    // The stock ledger knows nothing about preparations, and the inner one
    // carries its own completion record with its own ingredients. Exploding
    // here would count those ingredients twice.
    const p = proposeCompletion(
      sub("sauce", [line({ subRecipeId: "stock" }), line({ productId: "butter" })]),
      1,
      [product("butter")],
    );
    expect(p.consumption.map((c) => c.productId)).toEqual(["butter"]);
    expect(p.problems).toEqual([]);
  });

  it("names an ingredient that has been deleted rather than dropping it", () => {
    const p = proposeCompletion(sub("mash", [line({ productId: "gone" })]), 1, []);
    expect(p.consumption).toHaveLength(0);
    expect(p.problems.join(" ")).toContain("no longer exists");
  });

  it("costs the batch in decimal", () => {
    // 0,1 three times is 0,30000000000000004 in binary floating point, and a
    // sheet showing that reads as broken.
    const p = proposeCompletion(
      sub("mash", [
        line({ productId: "a", grossQty: 1 }),
        line({ productId: "b", grossQty: 1 }),
        line({ productId: "c", grossQty: 1 }),
      ]),
      1,
      [
        product("a", { price: "0.1" }),
        product("b", { price: "0.1" }),
        product("c", { price: "0.1" }),
      ],
    );
    expect(completionCost(p)).toBe("0.30");
  });

  it("takes the shelf's unit from the stock unit where one is set", () => {
    expect(stockUnitOf(product("x", { totalUnit: "g", stockUnit: "kg" }))).toBe("kg");
    expect(stockUnitOf(product("x", { totalUnit: "g" }))).toBe("g");
  });
});

describe("which lot a batch came off", () => {
  const lot = (over: Partial<LotChoice>): LotChoice => ({
    id: "l", productId: "p", lotCode: "L", receivedOn: "2026-09-01",
    expiresOn: null, status: "OK", ...over,
  });

  it("suggests the one expiring first", () => {
    // First expired, first out — the rule a kitchen is meant to follow anyway,
    // so the default is the one a cook would have to override least often.
    const picked = suggestLot([
      lot({ id: "late", expiresOn: "2026-12-01" }),
      lot({ id: "soon", expiresOn: "2026-10-05" }),
    ]);
    expect(picked?.id).toBe("soon");
  });

  it("puts a dated lot ahead of an undated one", () => {
    // A lot with no date is not a lot that never expires. Sorting it first on
    // the grounds that null looks small would send the kitchen to the one
    // nobody can say anything about.
    const picked = suggestLot([lot({ id: "none" }), lot({ id: "dated", expiresOn: "2027-01-01" })]);
    expect(picked?.id).toBe("dated");
  });

  it("falls back to the oldest delivery when nothing carries a date", () => {
    const picked = suggestLot([
      lot({ id: "new", receivedOn: "2026-09-20" }),
      lot({ id: "old", receivedOn: "2026-08-02" }),
    ]);
    expect(picked?.id).toBe("old");
  });

  it("never suggests a lot that is not OK", () => {
    // Article 19: the database refuses to consume a blocked or recalled lot.
    // Proposing a write that will be refused is worse than proposing nothing,
    // because the refusal arrives after the cook has already filled the form.
    expect(
      suggestLot([lot({ id: "recalled", status: "RECALLED", expiresOn: "2026-10-01" })]),
    ).toBeNull();
    expect(
      suggestLot([
        lot({ id: "recalled", status: "RECALLED", expiresOn: "2026-10-01" }),
        lot({ id: "fine", status: "OK", expiresOn: "2026-11-01" }),
      ])?.id,
    ).toBe("fine");
  });
});

describe("what cannot be recorded", () => {
  it("refuses a preparation with no batch yield, and says why", () => {
    // Not a zero. "Nobody set a yield" and "it yields nothing" are different
    // statements, and offering the row with a zero makes the first read as the
    // second — which the variance report would then show as a kitchen that
    // used ingredients to make nothing.
    const reason = unrecordableReason(sub("mystery", [], { qty: 0, unit: "g" }));
    expect(reason).toContain("no batch yield");
  });

  it("refuses a yield with no unit", () => {
    expect(unrecordableReason(sub("mystery", [], { qty: 1000, unit: " " }))).toContain(
      "no unit",
    );
  });

  it("puts the reason on the row rather than leaving it to a failed click", () => {
    // An action that fails on click with the reason arriving as a toast teaches
    // people the screen is unreliable. The sheet says it up front.
    const task = (s: SubRecipe): PrepTask => ({
      subRecipe: s, quantityNeeded: 1, quantityMade: 1, unit: "g",
      batches: 1, batchYield: s.batchYield.qty, drivenBy: [], depth: 0,
    });
    const rows = recordableTasks(
      [task(sub("good", [])), task(sub("bad", [], { qty: 0, unit: "g" }))],
      new Map([["good", 2]]),
    );
    expect(rows[0]).toMatchObject({ recordable: true, reason: null, batchesRecorded: 2 });
    expect(rows[1].recordable).toBe(false);
    expect(rows[1].reason).toContain("no batch yield");
  });
});

describe("reading a variance", () => {
  it("calls a difference inside the venue's tolerance acceptable", () => {
    // Without a tolerance every rounding difference is a finding, and a report
    // that paints a kitchen weighing to the gram red is one nobody opens twice.
    expect(varianceVerdict(row({ variancePercent: 4 }), 5)).toBe("within");
    expect(varianceVerdict(row({ variancePercent: -5 }), 5)).toBe("within");
    expect(varianceVerdict(row({ variancePercent: 5.1 }), 5)).toBe("over");
  });

  it("flags using less than expected as loudly as using more", () => {
    // The comfortable reading is a careful kitchen. The likelier ones are a
    // batch nobody recorded, a short-measured recipe, or stock leaving by a
    // route the ledger has not been told about.
    expect(varianceVerdict(row({ variancePercent: -30 }), 5)).toBe("under");
  });

  it("never turns an unanswerable comparison into a number", () => {
    // Nothing recorded on one side is not a 100% variance. Saying so would
    // make a missing record indistinguishable from total loss.
    expect(
      varianceVerdict(
        row({ comparable: false, theoreticalQty: null, variancePercent: null }),
        5,
      ),
    ).toBe("incomparable");
  });

  it("orders by money, not by percentage", () => {
    // 2% of a tenderloin outranks 60% of the salt. Somebody acts in the order
    // of what it costs.
    const salt = row({ productName: "salt", variancePercent: 60, varianceCost: "2.00" });
    const beef = row({ productName: "beef", variancePercent: 8, varianceCost: "400.00" });
    expect([salt, beef].sort((a, b) => compareVarianceRows(a, b, 5))[0].productName).toBe(
      "beef",
    );
  });

  it("puts what cannot be compared under the real findings and above the quiet rows", () => {
    // A missing record is a real problem and must not be buried at the bottom.
    // It is still not more urgent than a loss somebody can put a figure on.
    const material = row({ productName: "beef", variancePercent: 20, varianceCost: "400.00" });
    const unknown = row({
      productName: "cream", comparable: false, variancePercent: null, varianceCost: null,
    });
    const quiet = row({ productName: "salt", variancePercent: 0, varianceCost: "0.00" });
    expect(
      [quiet, unknown, material]
        .sort((a, b) => compareVarianceRows(a, b, 5))
        .map((r) => r.productName),
    ).toEqual(["beef", "cream", "salt"]);
  });

  it("sorts an unsigned loss the same whichever way it went", () => {
    // 400 unaccounted for is 400 whether it was over-portioned or never
    // recorded as produced. Sorting on the signed figure would push every
    // under-usage to the bottom of the page.
    const over = row({ productName: "over", variancePercent: 20, varianceCost: "100.00" });
    const under = row({ productName: "under", variancePercent: -20, varianceCost: "-400.00" });
    expect([over, under].sort((a, b) => compareVarianceRows(a, b, 5))[0].productName).toBe(
      "under",
    );
  });
});

describe("the figures above the table", () => {
  it("gives the overrun separately from the net, so one does not hide the other", () => {
    // A net near zero can be a 400 overrun on butter cancelled by an
    // unrecorded batch somewhere else, and netting them off is how a usage
    // report ends up reassuring.
    const s = summariseVariance(
      [
        row({ variancePercent: 20, varianceCost: "400.00" }),
        row({ variancePercent: -20, varianceCost: "-395.00" }),
      ],
      5,
    );
    expect(s.netCost).toBe("5.00");
    expect(s.overCost).toBe("400.00");
    expect(s.over).toBe(1);
    expect(s.under).toBe(1);
  });

  it("counts what could not be compared rather than leaving it out of the total", () => {
    // The count of incomparable rows is the data-quality finding, and a
    // summary that only reported the comparable ones would read as complete.
    const s = summariseVariance(
      [
        row({ variancePercent: 0, varianceCost: "0.00" }),
        row({ comparable: false, variancePercent: null, varianceCost: null }),
        row({ comparable: false, variancePercent: null, varianceCost: null }),
      ],
      5,
    );
    expect(s.comparable).toBe(1);
    expect(s.incomparable).toBe(2);
    expect(s.netCost).toBe("0.00");
  });

  it("counts preparations edited since a batch of them was recorded", () => {
    // The theoretical figure is derived from the recipe as it is now. Where
    // that is not the recipe the cook worked from, the number is still the
    // best available and the reader has to be told.
    const s = summariseVariance([row({ recipeChanged: true }), row()], 5);
    expect(s.recipeChanged).toBe(1);
  });

  it("adds money in decimal", () => {
    // 0,1 + 0,2 is 0,30000000000000004 as a float.
    const s = summariseVariance(
      [
        row({ variancePercent: 10, varianceCost: "0.10" }),
        row({ variancePercent: 10, varianceCost: "0.20" }),
      ],
      5,
    );
    expect(s.netCost).toBe("0.30");
  });
});
