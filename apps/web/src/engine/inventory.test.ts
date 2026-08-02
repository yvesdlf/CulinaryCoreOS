import { describe, it, expect } from "vitest";
import type { Product } from "@ccos/shared";
import {
  parStatus,
  buildStockLines,
  countVariances,
  stockValue,
  wasteValue,
  type StockMovement,
} from "./inventory";

/**
 * Inventory.
 *
 * The failures worth guarding are the ones that make a stock page useless
 * rather than wrong: a thousand unmanaged spices drowning the twelve things
 * actually low, a count sheet showing two hundred agreeing lines to hide six
 * that do not, and last month's waste revalued at today's price.
 */

const product = (
  name: string,
  over: Partial<{ price: string; par: number | null; reorder: number | null }> = {},
): Product =>
  ({
    id: `id-${name}`, name, category: "T", supplier: null, supplierId: null, brand: null,
    packing: { packQty: 1, packUnit: "KG", unitsPerPack: 1, unitsPerPackUnit: "KG", totalQty: 1, totalUnit: "KG" },
    cost: {
      buyingPricePerPack: over.price ?? "1000", buyingPricePerUnit: over.price ?? "1000",
      grossPricePerUnit: over.price ?? "1000", nettPricePerUnit: over.price ?? "1000",
    },
    yield_: { grossQty: 1, grossUnit: "KG", wasteQty: 0, wasteUnit: "KG", nettQty: 1, nettUnit: "KG", refPercent: 0, yieldPercent: 100 },
    status: "ACTIVE",
    nutrition: { fatG: 0, carbsG: 0, proteinG: 0, vitAMg: 0, vitCMg: 0, calciumMg: 0, ironMg: 0, sodiumMg: 0, kcal: 0 },
    allergens: [], allergensNeedReview: false, allergenReviewNote: null,
    parLevel: over.par ?? null, reorderPoint: over.reorder ?? null, stockUnit: null,
    version: 1, createdAt: "", updatedAt: "",
  }) as Product;

const levels = (m: Record<string, number>) =>
  new Map(Object.entries(m).map(([k, v]) => [k, { onHand: v, lastMovementAt: null }]));

describe("par status", () => {
  it("calls a product with no par unmanaged, not out of stock", () => {
    // Most of a 1.100-line catalogue is bought to order. Flagging all of it as
    // critical would bury the dozen things that are.
    expect(parStatus(0, null, null)).toBe("unmanaged");
  });

  it("calls nothing on the shelf out", () => {
    expect(parStatus(0, 10, 5)).toBe("out");
  });

  it("suggests reordering at or below the reorder point", () => {
    expect(parStatus(5, 10, 5)).toBe("reorder");
    expect(parStatus(4, 10, 5)).toBe("reorder");
  });

  it("falls back to half of par when no point is set", () => {
    expect(parStatus(5, 10, null)).toBe("reorder");
    expect(parStatus(6, 10, null)).toBe("low");
  });

  it("calls at or above par ok", () => {
    expect(parStatus(10, 10, 5)).toBe("ok");
    expect(parStatus(12, 10, 5)).toBe("ok");
  });
});

describe("the stock page", () => {
  const products = [
    product("Salt", { par: 10, reorder: 4, price: "5000" }),
    product("Beef", { par: 20, price: "200000" }),
    product("Saffron"),
  ];

  it("puts what needs attention first and the unmanaged last", () => {
    // Out of stock, then at par, then the ones nobody is managing.
    const lines = buildStockLines(products, levels({ "id-Salt": 30, "id-Beef": 0 }));
    expect(lines.map((l) => l.product.name)).toEqual(["Beef", "Salt", "Saffron"]);
    expect(lines.map((l) => l.status)).toEqual(["out", "ok", "unmanaged"]);
  });

  it("suggests the shortfall to par, never a negative", () => {
    const lines = buildStockLines(products, levels({ "id-Beef": 5 }));
    const beef = lines.find((l) => l.product.name === "Beef")!;
    expect(beef.suggestedOrder).toBe(15);
    const salt = lines.find((l) => l.product.name === "Salt")!;
    // Nothing on hand and no movements: still only par, not more.
    expect(salt.suggestedOrder).toBe(10);
  });

  it("suggests nothing for a product at par or unmanaged", () => {
    const lines = buildStockLines(products, levels({ "id-Salt": 10, "id-Saffron": 3 }));
    expect(lines.find((l) => l.product.name === "Salt")!.suggestedOrder).toBe(0);
    expect(lines.find((l) => l.product.name === "Saffron")!.suggestedOrder).toBe(0);
  });

  it("values stock at the current price", () => {
    const lines = buildStockLines([products[0]], levels({ "id-Salt": 3 }));
    expect(lines[0].value).toBe("15000.00");
    expect(stockValue(lines)).toBe("15000.00");
  });

  it("never values a negative balance as negative money", () => {
    // A negative balance means the books are wrong, not that stock is worth
    // less than nothing.
    const lines = buildStockLines([products[0]], levels({ "id-Salt": -2 }));
    expect(lines[0].value).toBe("0.00");
  });
});

describe("count variance", () => {
  const products = [product("Salt", { price: "5000" }), product("Beef", { price: "200000" })];

  it("reports what disagrees and drops what does not", () => {
    const v = countVariances(
      [{ productId: "id-Salt", counted: 8 }, { productId: "id-Beef", counted: 5 }],
      products,
      levels({ "id-Salt": 8, "id-Beef": 7 }),
    );
    expect(v).toHaveLength(1);
    expect(v[0].product.name).toBe("Beef");
    expect(v[0].variance).toBe(-2);
  });

  it("values the difference, signed the same way", () => {
    const v = countVariances([{ productId: "id-Beef", counted: 5 }], products, levels({ "id-Beef": 7 }));
    expect(v[0].valueDelta).toBe("-400000.00");
  });

  it("puts the biggest money difference first", () => {
    const v = countVariances(
      [{ productId: "id-Salt", counted: 0 }, { productId: "id-Beef", counted: 6 }],
      products,
      levels({ "id-Salt": 10, "id-Beef": 7 }),
    );
    expect(v[0].product.name).toBe("Beef");
  });

  it("reports a shelf that should hold something and holds nothing as -100%", () => {
    const v = countVariances([{ productId: "id-Salt", counted: 0 }], products, levels({ "id-Salt": 2 }));
    expect(v[0].percent).toBe(-100);
  });

  it("ignores a count for a product that no longer exists", () => {
    expect(countVariances([{ productId: "gone", counted: 5 }], products, levels({}))).toEqual([]);
  });
});

describe("waste value", () => {
  const move = (over: Partial<StockMovement>): StockMovement => ({
    id: "m", productId: "p", kind: "WASTE", quantity: -2, unit: "KG",
    unitCost: "1000", reason: null, note: null, occurredAt: "", actorEmail: null,
    ...over,
  });

  it("values waste at what it cost when it happened", () => {
    // Revaluing last month's waste at today's price is a different number and
    // a wrong one, which is why unitCost is captured on the movement.
    expect(wasteValue([move({ unitCost: "1000" }), move({ unitCost: "3000" })])).toBe("8000.00");
  });

  it("counts only waste, not receipts or counts", () => {
    expect(
      wasteValue([move({}), move({ kind: "RECEIPT", quantity: 10 }), move({ kind: "COUNT" })]),
    ).toBe("2000.00");
  });

  it("is zero when nothing was wasted", () => {
    expect(wasteValue([])).toBe("0.00");
  });
});
