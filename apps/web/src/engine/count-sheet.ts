// ---------------------------------------------------------------------------
// Periodic count sheets
// ---------------------------------------------------------------------------
// A stock count happens in the store room, not at a desk. Somebody walks the
// shelves with a printed sheet and a pen at the end of service, and the numbers
// get typed in afterwards — often by somebody else, often the next morning.
// Making them type into a browser while standing in a walk-in at 2 °C is how
// counts stop happening.
//
// So: download a sheet, count on paper or in Excel, upload it back.
//
// The sheet deliberately does not carry the expected quantity. That is the same
// position the on-screen count sheet takes and it matters more on paper, where
// nobody is watching: a person who can see "expected 4" writes 4. A count that
// agrees with the books because the books were printed on the sheet is not a
// count, and the whole exercise exists to find the lines where the books are
// wrong.
//
// Rows are ordered by category so the sheet reads in the order somebody walks
// the store, rather than alphabetically across four different rooms.
//
// Pure, so the preview and the commit cannot disagree about what will happen.
// ---------------------------------------------------------------------------

import type { Product } from "@ccos/shared";
import { parseNumber } from "@/lib/csv";

export const COUNT_SHEET_HEADERS = [
  "ref", "ingredient", "category", "unit", "counted",
] as const;

export interface CountSheetLine {
  product: Product;
  unit: string;
}

/**
 * The rows of a blank sheet.
 *
 * `ref` is the product id. It is unlovely on a printed page and it is what
 * makes the upload reliable: two suppliers' "Butter, unsalted" are two
 * products, and matching a typed name back to the right one is guesswork.
 * The name is there for the person holding the pen; the ref is there for the
 * import, and a sheet that loses it still works by name.
 */
export function buildCountSheet(lines: CountSheetLine[]): string[][] {
  return [...lines]
    .sort(
      (a, b) =>
        (a.product.category ?? "").localeCompare(b.product.category ?? "") ||
        a.product.name.localeCompare(b.product.name),
    )
    .map((l) => [
      l.product.id,
      l.product.name,
      l.product.category ?? "",
      l.unit,
      "", // counted — left for whoever is holding the pen
    ]);
}

export interface ParsedCount {
  productId: string;
  counted: number;
}

export interface CountSheetProblem {
  line: number;
  ingredient: string;
  reason: string;
}

export interface CountSheetPlan {
  counts: ParsedCount[];
  problems: CountSheetProblem[];
  /** Rows that were left blank — not counted, which is not a problem. */
  skipped: number;
}

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

const HEADERS: Record<string, string[]> = {
  ref: ["ref", "id", "product id", "code", "reference"],
  ingredient: ["ingredient", "product", "name", "item", "description"],
  counted: ["counted", "count", "qty", "quantity", "actual", "on hand", "physical"],
};

function findHeader(rows: string[][]): { row: number; map: Record<string, number> } | null {
  const limit = Math.min(rows.length, 10);
  for (let r = 0; r < limit; r++) {
    const map: Record<string, number> = {};
    rows[r].forEach((cell, i) => {
      const k = key(cell);
      for (const [meaning, names] of Object.entries(HEADERS)) {
        if (map[meaning] === undefined && names.includes(k)) map[meaning] = i;
      }
    });
    // A count sheet without a counted column is not a count sheet, and one
    // with nothing naming the product cannot be matched to anything.
    if (map.counted === undefined) continue;
    if (map.ref === undefined && map.ingredient === undefined) continue;
    return { row: r, map };
  }
  return null;
}

/**
 * Read a filled-in sheet back.
 *
 * Matches on the ref, and falls back to an exact name match so a sheet
 * retyped from paper without the ref column still imports. A name that matches
 * two products is reported rather than guessed at: picking one silently would
 * write a correction against the wrong ingredient, which is worse than not
 * importing the line.
 *
 * A blank count is skipped, not zeroed. "I did not count this" and "there are
 * none" are different statements, and treating the first as the second writes
 * off the entire shelf.
 */
export function parseCountSheet(
  rows: string[][],
  products: Product[],
): CountSheetPlan {
  const header = findHeader(rows);
  if (!header) {
    return {
      counts: [],
      skipped: 0,
      problems: [{
        line: 0, ingredient: "",
        reason:
          "No header row found. The sheet needs a counted column and either a " +
          "ref or an ingredient name — download a fresh sheet to see the shape.",
      }],
    };
  }

  const { row: headerRow, map } = header;
  const at = (row: string[], meaning: string): string => {
    const i = map[meaning];
    return i === undefined ? "" : (row[i] ?? "").trim();
  };

  const byId = new Map(products.map((p) => [p.id, p]));
  // A name shared by two products cannot identify either of them.
  const byName = new Map<string, Product | null>();
  for (const p of products) {
    const k = key(p.name);
    byName.set(k, byName.has(k) ? null : p);
  }

  const counts: ParsedCount[] = [];
  const problems: CountSheetProblem[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const line = r + 1;
    if (row.every((c) => c.trim() === "")) continue;

    const ref = at(row, "ref");
    const name = at(row, "ingredient");
    const raw = at(row, "counted");

    if (raw === "") {
      skipped++;
      continue;
    }

    let product = ref ? byId.get(ref) : undefined;
    if (!product && name) {
      const found = byName.get(key(name));
      if (found === null) {
        problems.push({
          line, ingredient: name,
          reason: "More than one ingredient has this name; the sheet needs its ref.",
        });
        continue;
      }
      product = found ?? undefined;
    }

    if (!product) {
      problems.push({
        line, ingredient: name || ref,
        reason: ref && !name
          ? "No ingredient with this ref."
          : "Not in the catalogue.",
      });
      continue;
    }

    const counted = parseNumber(raw);
    if (counted === null) {
      problems.push({
        line, ingredient: product.name,
        reason: `"${raw}" is not a number.`,
      });
      continue;
    }
    if (counted < 0) {
      problems.push({
        line, ingredient: product.name,
        reason: "A count cannot be negative.",
      });
      continue;
    }

    const previous = seen.get(product.id);
    if (previous !== undefined) {
      problems.push({
        line, ingredient: product.name,
        reason: `Counted twice — also on line ${previous}.`,
      });
      continue;
    }
    seen.set(product.id, line);
    counts.push({ productId: product.id, counted });
  }

  return { counts, problems, skipped };
}
