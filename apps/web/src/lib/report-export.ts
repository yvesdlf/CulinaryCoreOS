// ---------------------------------------------------------------------------
// One report, four files
// ---------------------------------------------------------------------------
// A report is defined once, as data, and written out as CSV, Excel, Word or
// PDF. The alternative — four writers each knowing how a report is shaped —
// is four places for the caveats to be dropped from, and the caveats are the
// part that must not be dropped.
//
// ── Why the caveats travel inside the file ────────────────────────────────
//
// `METRICS.md` exists because a figure in this system carries what it could
// not count: stock that moved with no unit on it, movements with no cost,
// sales that could not be mapped. On screen those sit beside the table. In a
// file they have to be *in* the file, because the file is what goes to the
// accountant, and a cost of goods that is quietly low by whatever twenty-three
// uncosted movements were worth is worse than no figure at all.
//
// So every format writes a block before the table: what the report is, which
// venue, which period, when it was produced, and every caveat in words. The
// CSV is the awkward one — a spreadsheet wants a header row first — and it
// still carries them, separated by a blank line so a parser that wants only
// the grid can find it. Losing them to tidiness was not an option worth
// taking.
//
// ── Why Excel and Word load on demand ─────────────────────────────────────
//
// `exceljs` and `docx` are about half a megabyte each. This project turned
// down a charting library at 180 kB because the people using it are on a
// tablet in a kitchen over hotel wifi, and that reasoning did not stop being
// true. Both are behind `await import(...)`, so they are fetched the first
// time somebody asks for that format and never otherwise. A venue that only
// ever prints PDFs pays nothing for the other two.
// ---------------------------------------------------------------------------

import { toCsv, type Cell } from "@/lib/csv";

export type ReportFormat = "csv" | "xlsx" | "docx" | "pdf";

export interface ReportColumn {
  label: string;
  /** Right-aligned, and written as a number rather than text in Excel. */
  numeric?: boolean;
}

export interface ReportSheet {
  /** What the report is called on the page: "Lot traceability". */
  title: string;
  venue: string;
  /** The period in words, as `periods.ts` labels it. */
  period: string;
  /** ISO, so one sheet never carries two date formats. */
  printedOn: string;
  /**
   * What the figures could not count, what is still running, what is being
   * compared against what. Written into every format.
   */
  caveats: string[];
  columns: ReportColumn[];
  rows: Cell[][];
}

/** A filename that sorts and does not need quoting. */
export function reportFilename(sheet: ReportSheet, extension: string): string {
  const slug = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug(sheet.title)}-${slug(sheet.period)}-${sheet.printedOn}.${extension}`;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next turn of the loop: revoking synchronously races the
  // click in Safari and downloads an empty file.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The lines that precede the grid, in every format. */
function preamble(sheet: ReportSheet): string[][] {
  const lines: string[][] = [
    [sheet.title],
    ["Venue", sheet.venue],
    ["Period", sheet.period],
    ["Produced", sheet.printedOn],
  ];
  for (const caveat of sheet.caveats) lines.push(["Note", caveat]);
  return lines;
}

// ── CSV ────────────────────────────────────────────────────────────────────

export function writeCsv(sheet: ReportSheet): void {
  /*
   * Metadata, a blank line, then the grid. A spreadsheet reads the whole
   * thing and a person sees the notes first; a script that wants only the
   * table splits on the blank line. The existing per-screen exports in
   * `csv.ts` stay as they are — those are extracts of a table somebody is
   * looking at, not a report that leaves the building.
   */
  const body = [
    ...preamble(sheet),
    [],
    sheet.columns.map((c) => c.label),
    ...sheet.rows.map((r) => r.map((v) => (v == null ? "" : String(v)))),
  ];
  const csv = toCsv(body[0] as string[], body.slice(1) as Cell[][]);
  download(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }),
    reportFilename(sheet, "csv"));
}

// ── Excel ──────────────────────────────────────────────────────────────────

export async function writeExcel(sheet: ReportSheet): Promise<void> {
  const ExcelJS = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.created = new Date(sheet.printedOn + "T00:00:00Z");
  const ws = book.addWorksheet(sheet.title.slice(0, 31) || "Report");

  const titleRow = ws.addRow([sheet.title]);
  titleRow.font = { bold: true, size: 14 };
  ws.addRow(["Venue", sheet.venue]);
  ws.addRow(["Period", sheet.period]);
  ws.addRow(["Produced", sheet.printedOn]);
  for (const caveat of sheet.caveats) {
    const row = ws.addRow(["Note", caveat]);
    // Italic rather than coloured: a note that only reads as a note in
    // colour is a note that disappears when the sheet is printed.
    row.getCell(2).font = { italic: true };
  }
  ws.addRow([]);

  const header = ws.addRow(sheet.columns.map((c) => c.label));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.border = { bottom: { style: "thin" } };
  });

  for (const row of sheet.rows) {
    /*
     * Numbers as numbers. A column of prices written as text is a column
     * nobody can sum, which defeats the reason somebody asked for Excel
     * rather than PDF.
     */
    ws.addRow(row.map((value, i) => {
      if (!sheet.columns[i]?.numeric) return value ?? "";
      if (value == null || value === "") return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : value;
    }));
  }

  sheet.columns.forEach((c, i) => {
    const longest = Math.max(
      c.label.length,
      ...sheet.rows.map((r) => String(r[i] ?? "").length),
    );
    ws.getColumn(i + 1).width = Math.min(Math.max(longest + 2, 10), 48);
    if (c.numeric) ws.getColumn(i + 1).alignment = { horizontal: "right" };
  });
  ws.views = [{ state: "frozen", ySplit: header.number }];

  const data = await book.xlsx.writeBuffer();
  download(
    new Blob([data], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    reportFilename(sheet, "xlsx"),
  );
}

// ── Word ───────────────────────────────────────────────────────────────────

export async function writeWord(sheet: ReportSheet): Promise<void> {
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun,
    HeadingLevel, WidthType, AlignmentType } = await import("docx");

  const cell = (text: string, opts: { bold?: boolean; right?: boolean } = {}) =>
    new TableCell({
      children: [new Paragraph({
        alignment: opts.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [new TextRun({ text, bold: opts.bold })],
      })],
    });

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: sheet.title, heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ children: [new TextRun({ text: sheet.venue, bold: true })] }),
        new Paragraph(`${sheet.period} · produced ${sheet.printedOn}`),
        ...sheet.caveats.map((c) =>
          new Paragraph({ children: [new TextRun({ text: c, italics: true })] })),
        new Paragraph(""),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              tableHeader: true,
              children: sheet.columns.map((c) =>
                cell(c.label, { bold: true, right: c.numeric })),
            }),
            ...sheet.rows.map((r) => new TableRow({
              children: sheet.columns.map((c, i) =>
                cell(r[i] == null ? "" : String(r[i]), { right: c.numeric })),
            })),
          ],
        }),
      ],
    }],
  });

  download(await Packer.toBlob(doc), reportFilename(sheet, "docx"));
}

// ── PDF ────────────────────────────────────────────────────────────────────

/**
 * The browser's own print dialog, which every desktop browser can save to a
 * file. No renderer of our own, so the PDF is exactly the sheet on screen —
 * including the venue's logo and the caveats, rather than a second rendering
 * that has to be told about them separately.
 */
export function writePdf(): void {
  window.print();
}

export async function writeReport(sheet: ReportSheet, format: ReportFormat): Promise<void> {
  if (format === "csv") return writeCsv(sheet);
  if (format === "xlsx") return writeExcel(sheet);
  if (format === "docx") return writeWord(sheet);
  return writePdf();
}
