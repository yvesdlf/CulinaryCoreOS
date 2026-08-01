import { describe, it, expect } from "vitest";
import { toCsv, parseCsv, parseNumber } from "./csv";

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

describe("parseCsv", () => {
  /**
   * These files come back from Excel, so the cases that matter are the ones
   * Excel produces: BOMs, CRLF endings, quoted fields containing the delimiter.
   * Getting any of them wrong shifts a row one column and lands prices on the
   * wrong products, which parses cleanly and is wrong.
   */
  it("round-trips what toCsv writes", () => {
    const headers = ["Dish", "Cost"];
    const rows = [["Bisque de Marisco (serves 2)", "964370"], ['A "quoted" name', "1"]];
    expect(parseCsv(toCsv(headers, rows))).toEqual([headers, ...rows]);
  });

  it("keeps a comma inside a quoted field", () => {
    expect(parseCsv('"one,two","three"')).toEqual([["one,two", "three"]]);
  });

  it("unescapes a doubled quote", () => {
    expect(parseCsv('"A5 ""Kagoshima"" Wagyu"')).toEqual([['A5 "Kagoshima" Wagyu']]);
  });

  it("strips the BOM Excel writes back", () => {
    expect(parseCsv("﻿\"Name\"\r\n\"Salt\"")).toEqual([["Name"], ["Salt"]]);
  });

  it("accepts LF as well as CRLF", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("keeps a newline inside a quoted field", () => {
    expect(parseCsv('"line one\nline two",x')).toEqual([["line one\nline two", "x"]]);
  });

  it("reads a final row with no trailing newline", () => {
    expect(parseCsv("a,b\r\nc,d")).toHaveLength(2);
  });

  it("preserves empty cells rather than dropping them", () => {
    expect(parseCsv('"a","","c"')).toEqual([["a", "", "c"]]);
  });
});

describe("parseNumber", () => {
  it("reads an en-US spreadsheet number", () => {
    expect(parseNumber("1,053,910.50")).toBe(1053910.5);
  });

  it("reads an id-ID spreadsheet number", () => {
    // The venue's own locale. Number() gives NaN for this, which would have
    // cleared every price the import touched.
    expect(parseNumber("1.053.910,50")).toBe(1053910.5);
  });

  it("reads a plain number either way", () => {
    expect(parseNumber("590000")).toBe(590000);
    expect(parseNumber("590000.52")).toBe(590000.52);
  });

  it("treats a lone separator as a decimal point when it is not a group", () => {
    expect(parseNumber("12,5")).toBe(12.5);
    expect(parseNumber("590000.52")).toBe(590000.52);
  });

  it("reads three digits after a short integer part as grouping", () => {
    // A thousands separator can only ever follow one to three digits.
    expect(parseNumber("590.000")).toBe(590000);
    expect(parseNumber("12,500")).toBe(12500);
  });

  it("reads three digits after a long integer part as a decimal", () => {
    // Regression, caught by the import preview: costs are held to five decimal
    // places, so the app's own export contains 36441.025. Read as grouping it
    // came back as 36.441.025 — exporting a price list and importing it
    // unchanged would have multiplied prices by a thousand.
    expect(parseNumber("36441.025")).toBe(36441.025);
    expect(parseNumber("143842.125")).toBe(143842.125);
    expect(parseNumber("1234,500")).toBe(1234.5);
  });

  it("reads repeated separators as grouping", () => {
    expect(parseNumber("1.053.910")).toBe(1053910);
    expect(parseNumber("1,053,910")).toBe(1053910);
  });

  it("treats a lone dot as a decimal point", () => {
    expect(parseNumber("12.5")).toBe(12.5);
  });

  it("strips currency decoration", () => {
    expect(parseNumber("Rp 590.000")).toBe(590000);
  });

  it("keeps a negative sign", () => {
    expect(parseNumber("-5.5")).toBe(-5.5);
  });

  it("returns null for empty or unparseable input, not zero", () => {
    // Zero is a price. "I could not read this" is not, and conflating them
    // would let a blank cell wipe a product's cost.
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("   ")).toBeNull();
    expect(parseNumber("n/a")).toBeNull();
  });
});
