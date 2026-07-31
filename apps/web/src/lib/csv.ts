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
