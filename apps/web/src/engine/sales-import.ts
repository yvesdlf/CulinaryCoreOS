// ---------------------------------------------------------------------------
// Daily sales import
// ---------------------------------------------------------------------------
// A till produces one file a day listing what it rang up. This turns that
// file into sales lines, which 0092 then explodes through the recipes to post
// theoretical consumption — the other half of food cost.
//
// Pure, so the preview and the commit cannot disagree about what is about to
// happen. Nothing here writes.
//
// The rule that shapes everything: a row that cannot be understood is
// reported, not skipped. And there is a second, sharper rule specific to this
// import — a row whose till code matches no menu item is **not** a problem.
// It imports, with no recipe attached, and 0092 was written to allow exactly
// that. Refusing the file would stop the day's takings being recorded over a
// button nobody has mapped; dropping the row would lose the sale entirely.
// Both are worse than importing it and saying so.
//
// That distinction is the whole design:
//
//   problem   — the row is not usable at all. No code, no quantity, a
//               quantity that is not a number. Reported by line, never
//               imported.
//   unmapped  — the row is fine and will import; nothing yet says what the
//               dish is made of, so it posts no consumption. Counted
//               separately and carried through to the screen, because
//               importing it silently is what makes food cost quietly wrong.
// ---------------------------------------------------------------------------

import { parseNumber } from "@/lib/csv";

/** A till code mapped to a dish, from `menu_items`. */
export interface CodeMapping {
  posItemCode: string;
  recipeId: string;
  itemName: string;
}

export interface PlannedSalesLine {
  /** 1-based, counting the header, so it matches what Excel shows. */
  line: number;
  posItemCode: string;
  /** Null where no menu item claims the code. The row still imports. */
  recipeId: string | null;
  itemName: string | null;
  unitsSold: number;
  netSales: number | null;
  grossAmount: number | null;
  covers: number | null;
}

export interface SalesImportProblem {
  line: number;
  code: string;
  reason: string;
}

export interface SalesImportPlan {
  lines: PlannedSalesLine[];
  problems: SalesImportProblem[];
  /** How many of `lines` will post no consumption, and their value. */
  unmappedCount: number;
  unmappedNetSales: number;
  /** Column headers as found, so the screen can say what it read. */
  matchedOn: { code: string; units: string; net: string | null } | null;
}

const CODE_HEADERS = ["code", "pos", "item code", "plu", "sku", "item"];
const UNIT_HEADERS = ["qty", "quantity", "units", "sold", "count"];
const NET_HEADERS = ["net", "net sales", "amount", "revenue", "total"];
const GROSS_HEADERS = ["gross", "gross sales", "gross amount"];
const COVER_HEADERS = ["covers", "guests", "pax"];

/**
 * Finds a column by what its header contains, not by position.
 *
 * Tills export in whatever order they like and rename columns between
 * versions. Matching on position is how an import silently reads the price
 * column as the quantity.
 */
function findColumn(header: string[], candidates: string[]): number {
  const normalised = header.map((h) => h.trim().toLowerCase());
  for (const c of candidates) {
    const exact = normalised.indexOf(c);
    if (exact !== -1) return exact;
  }
  for (const c of candidates) {
    const partial = normalised.findIndex((h) => h.includes(c));
    if (partial !== -1) return partial;
  }
  return -1;
}

export function planSalesImport(
  rows: string[][],
  mappings: CodeMapping[],
): SalesImportPlan {
  const empty: SalesImportPlan = {
    lines: [], problems: [], unmappedCount: 0, unmappedNetSales: 0, matchedOn: null,
  };
  if (rows.length < 2) {
    return {
      ...empty,
      problems: [{ line: 1, code: "", reason: "The file has no rows under its header." }],
    };
  }

  const header = rows[0]!;
  const codeAt = findColumn(header, CODE_HEADERS);
  const unitsAt = findColumn(header, UNIT_HEADERS);
  const netAt = findColumn(header, NET_HEADERS);
  const grossAt = findColumn(header, GROSS_HEADERS);
  const coversAt = findColumn(header, COVER_HEADERS);

  if (codeAt === -1 || unitsAt === -1) {
    return {
      ...empty,
      problems: [{
        line: 1,
        code: "",
        reason:
          "Could not find a till code column and a quantity column. " +
          `Read the headers as: ${header.join(", ")}`,
      }],
    };
  }

  // Case-folded, because a till that exports TILL-01 one day and till-01 the
  // next is not reporting two different dishes.
  const byCode = new Map(
    mappings.map((m) => [m.posItemCode.trim().toLowerCase(), m]),
  );

  const lines: PlannedSalesLine[] = [];
  const problems: SalesImportProblem[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    const line = i + 1;
    const code = (row[codeAt] ?? "").trim();

    // A wholly blank row is the trailing newline every spreadsheet writes.
    // Reporting it as a problem would make every clean file look dirty.
    if (row.every((cell) => (cell ?? "").trim() === "")) continue;

    if (code === "") {
      problems.push({ line, code: "", reason: "No till code on this row." });
      continue;
    }

    const rawUnits = (row[unitsAt] ?? "").trim();
    if (rawUnits === "") {
      /*
       * Not read as zero. A blank quantity is a row the till did not fill
       * in, and treating it as "none sold" would post a confident figure
       * nobody supplied — the same argument the count sheet makes about an
       * empty box.
       */
      problems.push({ line, code, reason: "No quantity on this row." });
      continue;
    }

    const units = parseNumber(rawUnits);
    if (units === null || !Number.isFinite(units)) {
      problems.push({ line, code, reason: `"${rawUnits}" is not a quantity.` });
      continue;
    }
    if (units < 0) {
      /*
       * Allowed through as a problem rather than silently imported. A
       * negative line is usually a void or a refund, which is real, but it
       * is also what a mis-exported file looks like — and posting negative
       * consumption puts stock back on the shelf.
       */
      problems.push({
        line, code,
        reason: `Negative quantity (${units}). Voids and refunds need checking before import.`,
      });
      continue;
    }

    const match = byCode.get(code.toLowerCase()) ?? null;
    const net = netAt === -1 ? null : parseNumber((row[netAt] ?? "").trim());
    const gross = grossAt === -1 ? null : parseNumber((row[grossAt] ?? "").trim());
    const covers = coversAt === -1 ? null : parseNumber((row[coversAt] ?? "").trim());

    lines.push({
      line,
      posItemCode: code,
      recipeId: match?.recipeId ?? null,
      itemName: match?.itemName ?? null,
      unitsSold: units,
      netSales: net,
      grossAmount: gross,
      covers: covers === null ? null : Math.round(covers),
    });
  }

  const unmapped = lines.filter((l) => l.recipeId === null);

  return {
    lines,
    problems,
    unmappedCount: unmapped.length,
    unmappedNetSales: unmapped.reduce((s, l) => s + (l.netSales ?? 0), 0),
    matchedOn: {
      code: header[codeAt]!,
      units: header[unitsAt]!,
      net: netAt === -1 ? null : header[netAt]!,
    },
  };
}
