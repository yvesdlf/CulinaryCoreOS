import { describe, it, expect } from "vitest";
import { toCsv } from "./csv";

/**
 * CSV escaping.
 *
 * The failure mode here is silent and expensive: a dish name containing a
 * comma splits across two columns and shifts every figure on the row, so the
 * spreadsheet looks fine and the numbers are attached to the wrong dish.
 */
describe("toCsv", () => {
  it("quotes a value containing a comma", () => {
    // A real dish name from the catalogue.
    const csv = toCsv(["name", "cost"], [["Bisque de Marisco (serves 2)", 964370]]);
    expect(csv).toBe('"name","cost"\r\n"Bisque de Marisco (serves 2)","964370"');
  });

  it("keeps a comma inside one field rather than splitting it", () => {
    const csv = toCsv(["a", "b"], [["one,two", "three"]]);
    const dataLine = csv.split("\r\n")[1];
    expect(dataLine).toBe('"one,two","three"');
  });

  it("doubles an embedded quote, per RFC 4180", () => {
    const csv = toCsv(["name"], [['A5 "Kagoshima" Wagyu']]);
    expect(csv.split("\r\n")[1]).toBe('"A5 ""Kagoshima"" Wagyu"');
  });

  it("writes an empty cell for null and undefined, not the words", () => {
    const csv = toCsv(["a", "b", "c"], [[null, undefined, ""]]);
    expect(csv.split("\r\n")[1]).toBe('"","",""');
  });

  it("writes numbers without locale grouping", () => {
    // The UI shows "Rp 1.053.910"; pasted into a spreadsheet that is text.
    const csv = toCsv(["price"], [[1053910.5]]);
    expect(csv.split("\r\n")[1]).toBe('"1053910.5"');
  });

  it("survives a newline inside a field", () => {
    const csv = toCsv(["note"], [["line one\nline two"]]);
    expect(csv).toContain('"line one\nline two"');
  });

  it("emits headers alone when there are no rows", () => {
    expect(toCsv(["a", "b"], [])).toBe('"a","b"');
  });
});
