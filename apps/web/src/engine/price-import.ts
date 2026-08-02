// ---------------------------------------------------------------------------
// Supplier price list import
// ---------------------------------------------------------------------------
// The recurring job in a costing kitchen is not creating recipes, it is
// re-pricing. A supplier sends a new list, and 1.102 products need checking
// against it. Doing that one form at a time is why costings go stale, and stale
// costings are the reason the venue's food cost drifts without anyone noticing.
//
// This is the matching and diffing half — pure, so it can be tested and so the
// preview and the commit can never disagree about what is about to happen.
// Nothing here writes.
//
// The design rule throughout: a row that cannot be understood is reported, not
// skipped. Silently ignoring six of two hundred rows produces an import that
// looks successful and leaves the catalogue half-updated.
// ---------------------------------------------------------------------------

import type { Product } from "@ccos/shared";
import { parseNumber } from "@/lib/csv";
import { toDecimal } from "./cost-engine";

export interface PriceChange {
  product: Product;
  oldPrice: string;
  newPrice: string;
  /** Signed percentage move, for sorting and for spotting a 1.000x typo. */
  percentChange: number;
  /**
   * Nutrition the file supplied, when it carried any.
   *
   * Every imported ingredient arrived without nutrition, so every dish reports
   * none — correctly, but uselessly. Nobody is going to type it into 1.097
   * forms, so it comes in the same way prices do.
   */
  nutrition?: Partial<{
    fatG: number; carbsG: number; proteinG: number; kcal: number;
    vitAMg: number; vitCMg: number; calciumMg: number; ironMg: number; sodiumMg: number;
  }>;
}

export interface ImportProblem {
  /** 1-based, counting the header, so it matches what Excel shows. */
  line: number;
  name: string;
  reason: string;
}

export interface ImportPlan {
  changes: PriceChange[];
  /** Rows that matched a product whose price is already the given figure. */
  unchanged: number;
  problems: ImportProblem[];
  /** Column headers as found, so the UI can say what it read. */
  matchedOn: { name: string; price: string } | null;
}

/** Loose key so "Beef  Tenderloin" and "beef tenderloin" match. */
function key(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Find the two columns that matter.
 *
 * Header names are matched loosely because the file will have been through
 * Excel and possibly a supplier's own template. If either column cannot be
 * found the import refuses rather than guessing at column positions — reading
 * the wrong column would write plausible numbers into every product.
 */
/** Nutrition columns, all optional — a price list rarely carries them. */
const NUTRIENTS: { key: keyof NonNullable<PriceChange["nutrition"]>; names: string[] }[] = [
  { key: "kcal", names: ["kcal", "calories", "energy"] },
  { key: "fatG", names: ["fat"] },
  { key: "carbsG", names: ["carb", "carbohydrate"] },
  { key: "proteinG", names: ["protein"] },
  { key: "vitAMg", names: ["vitamin a", "vit a"] },
  { key: "vitCMg", names: ["vitamin c", "vit c"] },
  { key: "calciumMg", names: ["calcium"] },
  { key: "ironMg", names: ["iron"] },
  { key: "sodiumMg", names: ["sodium", "salt"] },
];

function findColumns(header: string[]): { name: number; price: number } | null {
  const norm = header.map(key);
  const name = norm.findIndex((h) => h === "name" || h === "product" || h === "ingredient");
  const price = norm.findIndex(
    (h) =>
      h.includes("price") || h.includes("cost") || h === "unit cost" || h === "rate",
  );
  return name === -1 || price === -1 ? null : { name, price };
}

function findNutritionColumns(header: string[]) {
  const norm = header.map(key);
  const found: { key: string; index: number }[] = [];
  for (const n of NUTRIENTS) {
    // First header that contains the term. Names are listed most specific
    // first above, so "vitamin c" is tried before a bare nutrient word.
    const index = norm.findIndex((h) => n.names.some((name) => h.includes(name)));
    if (index !== -1) found.push({ key: n.key, index });
  }
  return found;
}

/**
 * Work out what a file would do, without doing any of it.
 *
 * Matching is by name, because that is what a supplier's list carries — it has
 * no idea what our identifiers are. Duplicate names in the catalogue are
 * reported rather than resolved arbitrarily: picking one of two "Carrot" rows
 * would update a price the user cannot see and cannot predict.
 */
export function planPriceImport(rows: string[][], products: Product[]): ImportPlan {
  const problems: ImportProblem[] = [];
  const changes: PriceChange[] = [];
  let unchanged = 0;

  if (rows.length < 2) {
    return {
      changes,
      unchanged,
      problems: [{ line: 1, name: "", reason: "The file has no data rows." }],
      matchedOn: null,
    };
  }

  const header = rows[0];
  const cols = findColumns(header);
  if (!cols) {
    return {
      changes,
      unchanged,
      problems: [
        {
          line: 1,
          name: "",
          reason:
            "Could not find a name column and a price column. Expected headers " +
            'like "Name" and "Unit cost".',
        },
      ],
      matchedOn: null,
    };
  }

  // Names that appear more than once cannot be matched unambiguously.
  const byName = new Map<string, Product[]>();
  for (const p of products) {
    const k = key(p.name);
    byName.set(k, [...(byName.get(k) ?? []), p]);
  }

  const seen = new Set<string>();
  const nutritionCols = findNutritionColumns(header);

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const line = i + 1;
    const rawName = (row[cols.name] ?? "").trim();
    const rawPrice = (row[cols.price] ?? "").trim();

    // A wholly blank row is Excel padding, not a mistake worth reporting.
    if (!rawName && !rawPrice) continue;

    if (!rawName) {
      problems.push({ line, name: "", reason: "No product name." });
      continue;
    }

    const k = key(rawName);
    const matches = byName.get(k);

    if (!matches) {
      problems.push({
        line,
        name: rawName,
        reason: "No product with this name. Create it first, or correct the spelling.",
      });
      continue;
    }
    if (matches.length > 1) {
      problems.push({
        line,
        name: rawName,
        reason: `${matches.length} products share this name — rename them so the file can say which one it means.`,
      });
      continue;
    }
    if (seen.has(k)) {
      problems.push({
        line,
        name: rawName,
        reason: "This product appears more than once in the file.",
      });
      continue;
    }
    seen.add(k);

    const parsed = parseNumber(rawPrice);
    if (parsed === null) {
      problems.push({
        line,
        name: rawName,
        reason: rawPrice ? `Could not read "${rawPrice}" as a price.` : "No price given.",
      });
      continue;
    }
    if (parsed < 0) {
      problems.push({ line, name: rawName, reason: "Price is negative." });
      continue;
    }

    const product = matches[0];
    const oldPrice = toDecimal(product.cost.grossPricePerUnit);
    const newPrice = toDecimal(parsed);

    const nutrition: Record<string, number> = {};
    for (const col of nutritionCols) {
      const v = parseNumber((row[col.index] ?? "").trim());
      if (v !== null) nutrition[col.key] = v;
    }
    const hasNutrition = Object.keys(nutrition).length > 0;

    // A row that changes neither is genuinely unchanged; one carrying new
    // nutrition is a change even at the same price.
    if (oldPrice.equals(newPrice) && !hasNutrition) {
      unchanged++;
      continue;
    }

    changes.push({
      product,
      oldPrice: oldPrice.toFixed(5),
      newPrice: newPrice.toFixed(5),
      // A price rising from zero has no meaningful percentage; reporting
      // Infinity would sort it to the top of a list meant to surface typos.
      percentChange: oldPrice.greaterThan(0)
        ? newPrice.minus(oldPrice).dividedBy(oldPrice).times(100).toNumber()
        : 0,
      ...(hasNutrition ? { nutrition } : {}),
    });
  }

  // Biggest move first — a misread separator shows up as a 99% drop or a
  // 99.900% rise, and belongs where it will be seen.
  changes.sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange));

  return {
    changes,
    unchanged,
    problems,
    matchedOn: { name: header[cols.name], price: header[cols.price] },
  };
}
