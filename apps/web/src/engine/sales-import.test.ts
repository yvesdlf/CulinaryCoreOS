import { describe, expect, it } from "vitest";
import { planSalesImport, type CodeMapping } from "./sales-import";

const MAPPINGS: CodeMapping[] = [
  { posItemCode: "TILL-BUR", recipeId: "r-burger", itemName: "Burger" },
  { posItemCode: "TILL-SAL", recipeId: "r-salad", itemName: "Caesar Salad" },
];

const HEADER = ["Item Code", "Description", "Qty", "Net Sales"];
const plan = (rows: string[][], m = MAPPINGS) => planSalesImport(rows, m);

describe("planSalesImport — reading the file", () => {
  it("finds columns by header, not by position", () => {
    const p = plan([
      ["Net Sales", "Qty", "Item Code"],
      ["190000", "2", "TILL-BUR"],
    ]);
    expect(p.problems).toEqual([]);
    expect(p.lines[0]).toMatchObject({ posItemCode: "TILL-BUR", unitsSold: 2, netSales: 190000 });
  });

  it("says what it read when it cannot find the columns it needs", () => {
    const p = plan([["Thing", "Money"], ["x", "1"]]);
    expect(p.lines).toEqual([]);
    expect(p.problems[0]!.reason).toContain("Thing, Money");
  });

  it("ignores the trailing blank row every spreadsheet writes", () => {
    const p = plan([HEADER, ["TILL-BUR", "Burger", "2", "190000"], ["", "", "", ""]]);
    expect(p.problems).toEqual([]);
    expect(p.lines).toHaveLength(1);
  });

  it("reports an empty file rather than importing nothing quietly", () => {
    expect(plan([HEADER]).problems[0]!.reason).toContain("no rows");
  });
});

describe("planSalesImport — rows it refuses", () => {
  it("numbers problems the way the spreadsheet does", () => {
    const p = plan([HEADER, ["TILL-BUR", "Burger", "2", "1"], ["", "Mystery", "3", "1"]]);
    // Header is line 1, so the bad row is line 3.
    expect(p.problems).toEqual([{ line: 3, code: "", reason: "No till code on this row." }]);
  });

  /*
   * The distinction the count sheet makes, in a different file. A missing
   * quantity is a row the till did not fill in; reading it as zero posts a
   * figure nobody supplied.
   */
  it("does not read a blank quantity as none sold", () => {
    const p = plan([HEADER, ["TILL-BUR", "Burger", "", "0"]]);
    expect(p.lines).toEqual([]);
    expect(p.problems[0]!.reason).toBe("No quantity on this row.");
  });

  it("refuses a quantity that is not a number, and quotes it", () => {
    const p = plan([HEADER, ["TILL-BUR", "Burger", "two", "1"]]);
    expect(p.problems[0]!.reason).toContain('"two"');
  });

  it("holds back a negative line rather than putting stock back on the shelf", () => {
    const p = plan([HEADER, ["TILL-BUR", "Burger", "-3", "-1"]]);
    expect(p.lines).toEqual([]);
    expect(p.problems[0]!.reason).toContain("Voids and refunds");
  });

  it("keeps importing after a bad row", () => {
    const p = plan([
      HEADER,
      ["TILL-BUR", "Burger", "two", "1"],
      ["TILL-SAL", "Salad", "4", "200000"],
    ]);
    expect(p.problems).toHaveLength(1);
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0]!.recipeId).toBe("r-salad");
  });
});

describe("planSalesImport — an unmapped code is not a problem", () => {
  /*
   * The sharp rule in this file. Refusing the file would stop the day's
   * takings being recorded over a button nobody has mapped; dropping the row
   * would lose the sale. It imports, and says so.
   */
  it("imports a code nothing maps, with no recipe", () => {
    const p = plan([HEADER, ["TILL-COFFEE", "Flat white", "9", "45000"]]);
    expect(p.problems).toEqual([]);
    expect(p.lines[0]).toMatchObject({ posItemCode: "TILL-COFFEE", recipeId: null, unitsSold: 9 });
  });

  it("counts them and their value, so the screen can say what is not costed", () => {
    const p = plan([
      HEADER,
      ["TILL-BUR", "Burger", "2", "190000"],
      ["TILL-COFFEE", "Flat white", "9", "45000"],
      ["TILL-TEA", "Tea", "3", "15000"],
    ]);
    expect(p.unmappedCount).toBe(2);
    expect(p.unmappedNetSales).toBe(60000);
    expect(p.lines).toHaveLength(3);
  });

  it("matches a code whatever case the till exported it in", () => {
    const p = plan([HEADER, ["till-bur", "Burger", "1", "95000"]]);
    expect(p.lines[0]!.recipeId).toBe("r-burger");
    expect(p.unmappedCount).toBe(0);
  });

  it("keeps the code exactly as the till wrote it", () => {
    // Matching folds case; storing must not, or the worklist shows a code
    // that is not the one on the till.
    expect(plan([HEADER, ["till-bur", "x", "1", "1"]]).lines[0]!.posItemCode).toBe("till-bur");
  });
});

describe("planSalesImport — the optional columns", () => {
  it("takes covers and gross when the file has them", () => {
    const p = plan([
      ["Code", "Qty", "Gross", "Covers"],
      ["TILL-BUR", "2", "209000", "2"],
    ]);
    expect(p.lines[0]).toMatchObject({ grossAmount: 209000, covers: 2 });
  });

  it("leaves them null when it does not, rather than guessing zero", () => {
    const p = plan([["Code", "Qty"], ["TILL-BUR", "2"]]);
    expect(p.lines[0]).toMatchObject({ netSales: null, grossAmount: null, covers: null });
  });
});
