import { describe, it, expect } from "vitest";
import {
  calculateGrossQty,
  calculateLineCost,
  calculateRecipeTotalCost,
  calculatePercentAmount,
  calculateTotalCog,
  calculatePriceInclTax,
  calculateMenuPriceFromInclTax,
  calculateFoodCostPercent,
  calculateGrossProfitPercent,
  calculateContributionMargin,
  calculateSubRecipeCostPerUnit,
  calculateRecommendedPrice,
  roundToNearest,
  toDecimal,
} from "./cost-engine";

/**
 * Unit tests for the cost engine.
 *
 * Every case here encodes a bug that actually shipped or a figure taken from
 * the venue's own COGS V5 workbook. The Playwright suites cover pixels and
 * roles; arithmetic needs tests that run in milliseconds, because that is the
 * class of defect that has cost the most time on this project.
 */

describe("waste-adjusted gross quantity", () => {
  it("expands nett by the trim percentage", () => {
    // 220 g of usable beef at 20% trim means buying 275 g.
    expect(calculateGrossQty(220, 20).toNumber()).toBe(275);
  });

  it("is a no-op at zero trim", () => {
    expect(calculateGrossQty(150, 0).toNumber()).toBe(150);
  });

  it("returns zero rather than dividing by zero at 100% trim", () => {
    expect(calculateGrossQty(100, 100).toNumber()).toBe(0);
    expect(calculateGrossQty(100, 150).toNumber()).toBe(0);
  });
});

describe("line cost", () => {
  it("multiplies GROSS quantity by the as-purchased rate", () => {
    // Regression: the engine once resolved nettPricePerUnit here. Since
    // grossQty already carries the trim, pairing the two charged for waste
    // twice — beef at 20% trim came out 25% high.
    const { grossQty, lineCost } = calculateLineCost(220, 20, 645);
    expect(grossQty.toNumber()).toBe(275);
    expect(lineCost.toNumber()).toBe(177375);
  });

  it("never returns a negative cost", () => {
    expect(calculateLineCost(10, 0, -5).lineCost.toNumber()).toBe(0);
  });
});

describe("decimal money", () => {
  it("computes 30 x 0.0055 exactly, where float gives 0.16499999999999998", () => {
    // This rendered as "0.16" instead of "0.17" before decimal.js.
    const { lineCost } = calculateLineCost(30, 0, "0.0055");
    expect(lineCost.toString()).toBe("0.165");
    expect(lineCost.toFixed(2)).toBe("0.17");
    expect(0.165).not.toBe(30 * 0.0055); // the float path this replaced
  });

  it("sums without float drift", () => {
    const total = calculateRecipeTotalCost([
      { lineCost: "0.1" },
      { lineCost: "0.2" },
    ]);
    expect(total.toString()).toBe("0.3");
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it("sums at full precision rather than from rounded lines", () => {
    // Rounding each line first let a half-unit error per line accumulate.
    const total = calculateRecipeTotalCost([
      { lineCost: "25.2" },
      { lineCost: "0.165" },
      { lineCost: "1.068" },
    ]);
    expect(total.toFixed(2)).toBe("26.43");
  });

  it("treats junk input as zero instead of NaN", () => {
    expect(toDecimal("not a number").toNumber()).toBe(0);
    expect(toDecimal(null).toNumber()).toBe(0);
    expect(toDecimal("").toNumber()).toBe(0);
    expect(toDecimal(Infinity).toNumber()).toBe(0);
  });
});

describe("COG chain", () => {
  it("takes both buffers on raw cost, not compounded", () => {
    // 4% inflation in the workbook is 4% of cost of sales, not of cost+waste.
    const cog = calculateTotalCog(1000, 10, 8);
    expect(cog.toNumber()).toBe(1180); // 1000 + 100 + 80
    expect(cog.toNumber()).not.toBe(1188); // what compounding would give
  });

  it("isolates each buffer amount", () => {
    expect(calculatePercentAmount(32192, 4).toFixed(2)).toBe("1287.68");
  });
});

describe("tax and service", () => {
  it("derives the guest price from the menu price", () => {
    // Menu price is held EXCLUDING tax; 21% is the EU standard rate.
    expect(calculatePriceInclTax(251802, 21).toFixed(2)).toBe("304680.42");
  });

  it("round-trips back to the menu price", () => {
    const guest = calculatePriceInclTax(871000, 21);
    expect(calculateMenuPriceFromInclTax(guest, 21).toFixed(2)).toBe("871000.00");
  });
});

describe("margins", () => {
  it("food cost % is COG over menu price", () => {
    expect(calculateFoodCostPercent(201016, 716667).toFixed(2)).toBe("28.05");
  });

  it("food cost % and gross profit % sum to 100", () => {
    const fc = calculateFoodCostPercent(201016, 716667);
    const gp = calculateGrossProfitPercent(716667, 201016);
    expect(fc.plus(gp).toFixed(6)).toBe("100.000000");
  });

  it("returns zero rather than dividing by a zero price", () => {
    expect(calculateFoodCostPercent(500, 0).toNumber()).toBe(0);
    expect(calculateGrossProfitPercent(0, 500).toNumber()).toBe(0);
  });

  it("clamps contribution margin at zero when cost exceeds price", () => {
    expect(calculateContributionMargin(100, 250).toNumber()).toBe(0);
  });
});

describe("sub-recipe cost per unit", () => {
  it("divides batch cost by yield", () => {
    expect(calculateSubRecipeCostPerUnit(26430, 3000).toFixed(5)).toBe("8.81000");
  });

  it("returns zero for a zero yield instead of Infinity", () => {
    expect(calculateSubRecipeCostPerUnit(1000, 0).toNumber()).toBe(0);
  });
});

describe("suggested pricing", () => {
  it("prices to a target food cost", () => {
    expect(calculateRecommendedPrice(33480, 25).toFixed(2)).toBe("133920.00");
  });

  it("rounds a suggestion to the nearest 1.000", () => {
    expect(roundToNearest(133919, 1000).toNumber()).toBe(134000);
    expect(roundToNearest(111599, 1000).toNumber()).toBe(112000);
  });

  it("leaves the value alone for a non-positive step", () => {
    expect(roundToNearest(133919, 0).toNumber()).toBe(133919);
  });
});

describe("COGS V5 reference dishes", () => {
  /**
   * Figures lifted from the venue's own Food Cost Summary. These are the
   * golden master: they were produced by a spreadsheet this code has never
   * seen, so they are the only non-circular check available.
   */
  const dishes = [
    { name: "A5 Wagyu Maki", cost: "217903.19999999998", menu: 871000, cog: 226619.328, pct: 26.018293 },
    { name: "Crab & Avocado Maki", cost: "544139.39", menu: 2264000, cog: 565904.9656, pct: 24.995802 },
    { name: "Seared Tuna Maki", cost: "39901.35", menu: 168000, cog: 41497.404, pct: 24.700836 },
  ];

  for (const d of dishes) {
    it(`reproduces ${d.name}`, () => {
      const cog = calculateTotalCog(d.cost, 0, 4); // 4% inflation at dish level
      expect(cog.toNumber()).toBeCloseTo(d.cog, 2);
      const pct = calculateFoodCostPercent(cog, d.menu);
      expect(pct.toNumber()).toBeCloseTo(d.pct, 5);
    });
  }

  it("reproduces Grilled Octopus from its own lines", () => {
    // Food Cost Per Plate applies no trim per line; waste is 4% on the total.
    const lines = [
      { qty: 0.36, rate: 125000 },
      { qty: 0.02, rate: 58537.50000000001 },
      { qty: 0.01, rate: 99463.63636363635 },
      { qty: 0.02, rate: 15000 },
      { qty: 0.03, rate: 200000 },
      { qty: 0.1, rate: 45000 },
    ].map((l) => calculateLineCost(l.qty, 0, l.rate));

    const total = calculateRecipeTotalCost(lines);
    expect(total.toNumber()).toBeCloseTo(57965.386363, 4);

    const cog = calculateTotalCog(total, 4, 0);
    expect(cog.toNumber()).toBeCloseTo(60284.001818, 4);
    expect(calculateFoodCostPercent(cog, 240000).toNumber()).toBeCloseTo(25.118334, 5);
  });
});
