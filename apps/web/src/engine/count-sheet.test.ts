import { describe, it, expect } from "vitest";
import type { Product } from "@ccos/shared";
import { buildCountSheet, parseCountSheet, COUNT_SHEET_HEADERS } from "./count-sheet";
import { parseCsv, toCsv } from "@/lib/csv";

/**
 * Count sheets.
 *
 * The failures worth guarding are the ones that quietly write a wrong
 * correction: a blank treated as a zero, a name matched to the wrong one of two
 * products that share it, and the expected quantity leaking onto the sheet —
 * which turns a count into a transcription exercise.
 */

const product = (id: string, name: string, category = "Dairy"): Product =>
  ({
    id, name, category, supplier: null, supplierId: null, brand: null,
    packing: { packQty: 1, packUnit: "KG", unitsPerPack: 1, unitsPerPackUnit: "KG", totalQty: 1, totalUnit: "KG" },
    cost: {
      buyingPricePerPack: "1000", buyingPricePerUnit: "1000",
      grossPricePerUnit: "1000", nettPricePerUnit: "1000",
    },
    yield_: { grossQty: 1, grossUnit: "KG", wasteQty: 0, wasteUnit: "KG", nettQty: 1, nettUnit: "KG", refPercent: 0, yieldPercent: 100 },
    status: "ACTIVE",
    nutrition: { fatG: 0, carbsG: 0, proteinG: 0, vitAMg: 0, vitCMg: 0, calciumMg: 0, ironMg: 0, sodiumMg: 0, kcal: 0 },
    allergens: [], allergensNeedReview: false, allergenReviewNote: null,
    parLevel: null, reorderPoint: null, stockUnit: null,
    version: 1, createdAt: "", updatedAt: "",
  }) as Product;

const butter = product("p1", "Butter, unsalted");
const cream = product("p2", "Cream, 35%");
const basil = product("p3", "Basil", "Herbs");
const all = [butter, cream, basil];

const sheet = (lines: string[][]) =>
  parseCsv(toCsv([...COUNT_SHEET_HEADERS], lines));

describe("buildCountSheet", () => {
  it("leaves the counted column empty and never prints the expected quantity", () => {
    const rows = buildCountSheet(all.map((p) => ({ product: p, unit: "KG" })));
    for (const row of rows) {
      expect(row).toHaveLength(COUNT_SHEET_HEADERS.length);
      expect(row[4]).toBe("");
    }
    // Nothing on the sheet may carry a stock figure: seeing it is what turns
    // a count into a transcription.
    expect(rows.flat().join(" ")).not.toMatch(/\bexpected\b|\bon hand\b|\bbooks\b/i);
  });

  it("orders by category then name, so the sheet walks the store", () => {
    const rows = buildCountSheet([
      { product: basil, unit: "KG" },
      { product: cream, unit: "L" },
      { product: butter, unit: "KG" },
    ]);
    expect(rows.map((r) => r[1])).toEqual([
      "Butter, unsalted", "Cream, 35%", "Basil",
    ]);
  });

  it("carries the ref, which is what the upload matches on", () => {
    const rows = buildCountSheet([{ product: butter, unit: "KG" }]);
    expect(rows[0][0]).toBe("p1");
  });
});

describe("parseCountSheet", () => {
  it("reads a sheet it wrote itself", () => {
    const rows = buildCountSheet(all.map((p) => ({ product: p, unit: "KG" })));
    rows[0][4] = "4";
    rows[1][4] = "2,5";
    const result = parseCountSheet(parseCsv(toCsv([...COUNT_SHEET_HEADERS], rows)), all);

    expect(result.problems).toEqual([]);
    expect(result.counts).toEqual([
      { productId: "p1", counted: 4 },
      { productId: "p2", counted: 2.5 },
    ]);
    expect(result.skipped).toBe(1);
  });

  it("skips a blank rather than counting it as zero", () => {
    const result = parseCountSheet(
      sheet([["p1", "Butter, unsalted", "Dairy", "KG", ""]]),
      all,
    );
    expect(result.counts).toEqual([]);
    expect(result.skipped).toBe(1);
    expect(result.problems).toEqual([]);
  });

  it("counts a genuine zero", () => {
    const result = parseCountSheet(
      sheet([["p1", "Butter, unsalted", "Dairy", "KG", "0"]]),
      all,
    );
    expect(result.counts).toEqual([{ productId: "p1", counted: 0 }]);
  });

  it("matches by name when the ref column is gone", () => {
    const result = parseCountSheet(
      parseCsv("ingredient,counted\nCream. 35%,3\nBasil,1"),
      all,
    );
    // "Cream. 35%" is not "Cream, 35%" — a mistyped name is reported.
    expect(result.counts).toEqual([{ productId: "p3", counted: 1 }]);
    expect(result.problems[0].reason).toBe("Not in the catalogue.");
  });

  it("prefers the ref over the name when they disagree", () => {
    const result = parseCountSheet(
      sheet([["p1", "Cream, 35%", "Dairy", "KG", "7"]]),
      all,
    );
    expect(result.counts).toEqual([{ productId: "p1", counted: 7 }]);
  });

  it("refuses to guess between two products of the same name", () => {
    const twin = product("p9", "Butter, unsalted");
    const result = parseCountSheet(
      // Built rather than hand-written: the name contains a comma, and an
      // unquoted one splits into three columns and tests nothing.
      parseCsv(toCsv(["ingredient", "counted"], [["Butter, unsalted", "5"]])),
      [...all, twin],
    );
    expect(result.counts).toEqual([]);
    expect(result.problems[0].reason).toContain("More than one ingredient");
  });

  it("reports a line counted twice instead of taking one of them", () => {
    const result = parseCountSheet(
      sheet([
        ["p1", "Butter, unsalted", "Dairy", "KG", "4"],
        ["p1", "Butter, unsalted", "Dairy", "KG", "6"],
      ]),
      all,
    );
    expect(result.counts).toEqual([{ productId: "p1", counted: 4 }]);
    expect(result.problems[0].reason).toContain("also on line 2");
  });

  it("reports a count that is not a number, and one below zero", () => {
    const result = parseCountSheet(
      sheet([
        ["p1", "Butter, unsalted", "Dairy", "KG", "about four"],
        ["p2", "Cream, 35%", "Dairy", "L", "-2"],
      ]),
      all,
    );
    expect(result.counts).toEqual([]);
    expect(result.problems.map((p) => p.reason)).toEqual([
      '"about four" is not a number.',
      "A count cannot be negative.",
    ]);
  });

  it("reports a ref that is not in the catalogue", () => {
    const result = parseCountSheet(
      parseCsv("ref,counted\ndeleted-product,3"),
      all,
    );
    expect(result.problems[0].reason).toBe("No ingredient with this ref.");
  });

  it("finds the header under a title row and accepts other wordings", () => {
    const result = parseCountSheet(
      parseCsv(
        [
          "Manuza — month end count, 31 July",
          "",
          "id,item,quantity",
          "p1,Butter,4",
        ].join("\n"),
      ),
      all,
    );
    expect(result.counts).toEqual([{ productId: "p1", counted: 4 }]);
  });

  it("says so when there is no counted column at all", () => {
    const result = parseCountSheet(parseCsv("ref,ingredient\np1,Butter"), all);
    expect(result.counts).toEqual([]);
    expect(result.problems[0].reason).toContain("No header row");
  });

  it("ignores blank rows between sections of the sheet", () => {
    const result = parseCountSheet(
      sheet([
        ["p1", "Butter, unsalted", "Dairy", "KG", "4"],
        ["", "", "", "", ""],
        ["p3", "Basil", "Herbs", "KG", "1"],
      ]),
      all,
    );
    expect(result.problems).toEqual([]);
    expect(result.counts).toHaveLength(2);
  });
});
