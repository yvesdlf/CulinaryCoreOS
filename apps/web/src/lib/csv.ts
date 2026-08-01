// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------
// The venue has run on Excel for years and will keep sharing figures that way
// — with an accountant, a landlord, a supplier. An app that can only be read
// on screen asks them to give that up for nothing, so getting data out has to
// be a first-class action rather than a copy-paste job.
//
// Two decisions that look fussy and are not:
//
//   * Values are quoted and internal quotes doubled, per RFC 4180. Dish names
//     here contain commas ("Bisque de Marisco (serves 2)") and Excel would
//     otherwise split one dish across two columns and silently shift every
//     figure on the row.
//   * Numbers are written unformatted, with a dot decimal separator and no
//     thousands grouping. The UI formats for id-ID, and "Rp 1.053.910" pasted
//     into a spreadsheet is text, not money. Formatting is for reading;
//     exports are for calculating.
// ---------------------------------------------------------------------------

/** One cell. Anything not a string or number becomes empty rather than "undefined". */
export type Cell = string | number | null | undefined;

function escape(value: Cell): string {
  // Always quoting is simpler than deciding when to, and is valid either way.
  // Null included: returning a bare empty for null while quoting an empty
  // string made a row read `,,""`, three cells that are all empty rendered
  // three different ways.
  const s = value === null || value === undefined ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  return [headers, ...rows].map((r) => r.map(escape).join(",")).join("\r\n");
}

/**
 * Offer a file to the browser.
 *
 * The BOM is what makes Excel read the file as UTF-8. Without it, "Crudités"
 * and "Sourdough — base" arrive mojibaked on a default Windows install, which
 * looks like the app corrupted the data.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoked on the next tick: revoking synchronously races the download in
  // Safari and produces an empty file.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** `costings-2026-07-31.csv` — sortable, and says when it was true. */
export function datedFilename(stem: string): string {
  return `${stem}-${new Date().toISOString().slice(0, 10)}.csv`;
}

/**
 * Parse CSV into rows of cells.
 *
 * Hand-written rather than pulled in, because the requirement is small and
 * exact: this reads files the app itself wrote, round-tripped through Excel.
 * A `split(",")` would be shorter and would corrupt every dish whose name
 * contains a comma — silently, by shifting the rest of the row one column
 * left, so the file still parses and the prices land on the wrong products.
 *
 * Handles quoted fields, escaped quotes, embedded commas and newlines, CRLF or
 * LF endings, and the UTF-8 BOM Excel writes back out.
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (quoted) {
      if (c !== '"') {
        field += c;
      } else if (src[i + 1] === '"') {
        field += '"'; // an escaped quote, not the end of the field
        i++;
      } else {
        quoted = false;
      }
      continue;
    }

    if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }

  // A file not ending in a newline still has a last row.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Read a number written by a spreadsheet.
 *
 * Excel in an id-ID locale writes "1.053.910,50" and in an en-US one
 * "1,053,910.50". Both mean the same price, and `Number()` gives NaN for the
 * first — so a file round-tripped through a European Excel would clear every
 * price it touched.
 *
 * Decided by structure rather than by locale, because the file carries no
 * locale and the app itself exports "590000.52" with a dot decimal:
 *
 *   * Both separators present — the last one is the decimal point. Correct for
 *     either locale, no guessing.
 *   * One separator, appearing more than once — grouping. "1.053.910".
 *   * One separator, once, followed by other than three digits — decimal.
 *     "590000.52", "12,5".
 *   * One separator, once, followed by exactly three digits — decided by what
 *     is in front of it. A thousands separator can only follow one to three
 *     digits, so "590.000" is grouping and "36441.025" cannot be: grouped, it
 *     would have been written "36.441.025".
 *
 * That last rule matters more than it looks. Costs are held to five decimal
 * places, so the app's own export contains figures like 36441.025 — read as
 * grouping they come back a thousand times larger, and exporting a price list
 * and importing it unchanged would have quietly multiplied prices. The import
 * preview is what caught it, which is the reason the preview exists.
 */
export function parseNumber(raw: string): number | null {
  const s = raw.trim().replace(/[^0-9.,-]/g, "");
  if (!s) return null;

  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  let normalised = s;

  if (dots > 0 && commas > 0) {
    normalised =
      s.lastIndexOf(",") > s.lastIndexOf(".")
        ? s.replace(/\./g, "").replace(",", ".")
        : s.replace(/,/g, "");
  } else if (dots > 1) {
    normalised = s.replace(/\./g, "");
  } else if (commas > 1) {
    normalised = s.replace(/,/g, "");
  } else if (dots === 1 || commas === 1) {
    const sep = dots === 1 ? "." : ",";
    const at = s.lastIndexOf(sep);
    const after = s.length - at - 1;
    // Digits before the separator, ignoring a sign.
    const before = s.slice(0, at).replace(/^-/, "").length;
    const isGrouping = after === 3 && before >= 1 && before <= 3;
    normalised = isGrouping ? s.replace(sep, "") : s.replace(sep, ".");
  }

  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}
