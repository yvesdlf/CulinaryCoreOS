// ---------------------------------------------------------------------------
// Sales mix import — units sold per dish, from a POS export
// ---------------------------------------------------------------------------
// Menu engineering needs one number the app has never held: how many of each
// dish were actually sold. This reads it from the item section of a POS sales
// report.
//
// The reports are hierarchical: a category row carries the total of the item
// rows beneath it, so `Entrante 689` sits above the five starters that make it
// up. Importing a category row as if it were a dish would count those sales
// twice.
//
// Nothing here tries to work out which rows are categories. In a real export
// the levels are marked only by bold, which is lost the moment the sheet
// becomes a CSV, and inferring them arithmetically does not survive contact
// with the data — small leaf rows coincidentally sum to their neighbours often
// enough to misread a fifth of the file.
//
// Instead every row is matched against the recipe catalogue by name. Category
// names are not dish names, so they fail to match and are reported as skipped
// alongside everything else the file mentions that this kitchen does not cook.
// The list of skipped rows is the check: if a real dish is in it, the operator
// can see that immediately.
// ---------------------------------------------------------------------------

import type { Recipe } from "@ccos/shared";
import { parseNumber } from "@/lib/csv";

export interface SalesLine {
  recipe: Recipe;
  unitsSold: number;
  /** What the POS actually took, after discounts. Null when not supplied. */
  netSales: number | null;
}

export interface SalesMixProblem {
  /** 1-based, counting the header, so it matches what Excel shows. */
  line: number;
  name: string;
  reason: string;
}

export interface SalesMixImport {
  lines: SalesLine[];
  problems: SalesMixProblem[];
  /** Column headers as found, so the UI can say what it read. */
  matchedOn: { name: string; units: string; net: string | null } | null;
  /** Rows that named nothing this kitchen cooks — mostly category headings. */
  skipped: { name: string; unitsSold: number }[];
}

/** Loose key so "Lomo de Res" and "lomo de  res" match. */
function key(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

const NAME_HEADERS = ["name", "item", "product", "menu item", "dish"];
/*
 * Most specific first, and the order is load-bearing.
 *
 * A POS report stacks a dozen little tables above the item list, and several
 * of them also have a "Name" column beside a "Count" column — takings by
 * payment type, checks opened and closed, covers by hour. Searching for the
 * first row that looks like a header lands on one of those, and the import
 * then reads a table of cheque counts as if it were a sales mix.
 *
 * So the header is chosen by how specific its quantity column is: a row
 * offering "Quantity Sold" beats one offering only "Count", wherever each sits
 * in the file.
 */
const UNIT_HEADERS = [
  "quantity sold",
  "units sold",
  "qty sold",
  "quantity",
  "units",
  "qty",
  "sold",
  "count",
];
const NET_HEADERS = [
  "sales less item discounts",
  "net sales",
  "net",
  "sales less discounts",
];

/**
 * Locate a column, reporting how specific the match was.
 *
 * `rank` is the position in the candidate list, so a smaller number is a more
 * specific header. It is what lets the caller choose between two rows that
 * both look like headers.
 */
function findColumn(
  headers: string[],
  candidates: string[],
): { index: number; rank: number } {
  const keyed = headers.map(key);
  for (let rank = 0; rank < candidates.length; rank++) {
    const exact = keyed.indexOf(candidates[rank]);
    if (exact !== -1) return { index: exact, rank };
  }
  for (let rank = 0; rank < candidates.length; rank++) {
    const partial = keyed.findIndex((h) => h.includes(candidates[rank]));
    if (partial !== -1) return { index: partial, rank: rank + candidates.length };
  }
  return { index: -1, rank: Number.MAX_SAFE_INTEGER };
}

/**
 * Read a sales mix.
 *
 * `rows` is the whole sheet. POS exports put a page of totals above the item
 * table, so the header row is searched for rather than assumed to be first.
 */
export function parseSalesMix(rows: string[][], recipes: Recipe[]): SalesMixImport {
  const empty: SalesMixImport = {
    lines: [],
    problems: [],
    matchedOn: null,
    skipped: [],
  };

  /*
   * Find the header row of the item table.
   *
   * Every row that carries a name column and a quantity column is a candidate,
   * and the most specific one wins — see UNIT_HEADERS. Taking the first
   * candidate instead reads a summary table higher up the report.
   */
  let headerIndex = -1;
  let nameCol = -1;
  let unitsCol = -1;
  let netCol = -1;
  let bestRank = Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < rows.length; i++) {
    const n = findColumn(rows[i], NAME_HEADERS);
    const u = findColumn(rows[i], UNIT_HEADERS);
    if (n.index === -1 || u.index === -1) continue;
    const net = findColumn(rows[i], NET_HEADERS);
    // A row that also names its net sales column is the fuller table.
    const rank = u.rank * 2 + (net.index === -1 ? 1 : 0);
    if (rank < bestRank) {
      bestRank = rank;
      headerIndex = i;
      nameCol = n.index;
      unitsCol = u.index;
      netCol = net.index;
    }
  }
  if (headerIndex === -1) {
    return {
      ...empty,
      problems: [
        {
          line: 1,
          name: "",
          reason:
            "Could not find a column of item names and a column of quantities sold.",
        },
      ],
    };
  }

  /*
   * The item table ends at the first blank row.
   *
   * A POS report is a stack of tables in one sheet, separated by an empty
   * row, and the item list is rarely the last of them. Reading to the end of
   * the file pulls in the payment breakdown that follows — which does not
   * match any dish, so nothing is imported wrongly, but it buries the list of
   * skipped rows under a few hundred entries and that list is the only check
   * an operator has that a real dish was not missed.
   */
  const afterHeader = rows.slice(headerIndex + 1);
  const blank = afterHeader.findIndex((r) => r.every((c) => !c?.trim()));
  const body = blank === -1 ? afterHeader : afterHeader.slice(0, blank);
  if (body.every((r) => r.every((c) => !c?.trim()))) {
    return {
      ...empty,
      matchedOn: {
        name: rows[headerIndex][nameCol],
        units: rows[headerIndex][unitsCol],
        net: netCol === -1 ? null : rows[headerIndex][netCol],
      },
      problems: [
        { line: headerIndex + 1, name: "", reason: "The file has no data rows." },
      ],
    };
  }

  // A name shared by two dishes cannot be resolved to one of them.
  const byName = new Map<string, Recipe[]>();
  for (const recipe of recipes) {
    const k = key(recipe.name);
    byName.set(k, [...(byName.get(k) ?? []), recipe]);
  }

  const lines: SalesLine[] = [];
  const problems: SalesMixProblem[] = [];
  const skipped: { name: string; unitsSold: number }[] = [];
  const seen = new Map<string, number>();

  body.forEach((row, i) => {
    const line = headerIndex + i + 2;
    const rawName = (row[nameCol] ?? "").trim();
    const rawUnits = (row[unitsCol] ?? "").trim();
    if (!rawName && !rawUnits) return; // Blank padding row.

    if (!rawName) {
      problems.push({ line, name: "", reason: "No item name given." });
      return;
    }

    const units = parseNumber(rawUnits);
    if (rawUnits === "") {
      problems.push({ line, name: rawName, reason: "No quantity given." });
      return;
    }
    if (units === null) {
      problems.push({
        line,
        name: rawName,
        reason: `Could not read "${rawUnits}" as a quantity.`,
      });
      return;
    }
    if (units < 0) {
      // A refund column, or the wrong column entirely. Either way not a mix.
      problems.push({
        line,
        name: rawName,
        reason: "Quantity sold is negative.",
      });
      return;
    }

    const k = key(rawName);
    const matches = byName.get(k);
    if (!matches) {
      // Category headings land here, and so does anything on the menu that
      // this kitchen does not have a recipe for.
      skipped.push({ name: rawName, unitsSold: units });
      return;
    }
    if (matches.length > 1) {
      problems.push({
        line,
        name: rawName,
        reason: `${matches.length} dishes share this name, so the sales could not be assigned.`,
      });
      return;
    }

    const previous = seen.get(k);
    if (previous !== undefined) {
      // A POS export can list the same item under two revenue centres. Adding
      // them silently would be a guess; the operator should decide.
      problems.push({
        line,
        name: rawName,
        reason: `This item appears more than once in the file (also on line ${previous}).`,
      });
      return;
    }
    seen.set(k, line);

    const net = netCol === -1 ? null : parseNumber((row[netCol] ?? "").trim());
    lines.push({ recipe: matches[0], unitsSold: units, netSales: net });
  });

  // Best sellers first: that is the order the numbers get read in.
  lines.sort((a, b) => b.unitsSold - a.unitsSold);
  skipped.sort((a, b) => b.unitsSold - a.unitsSold);

  return {
    lines,
    problems,
    matchedOn: {
      name: rows[headerIndex][nameCol],
      units: rows[headerIndex][unitsCol],
      net: netCol === -1 ? null : rows[headerIndex][netCol],
    },
    skipped,
  };
}
