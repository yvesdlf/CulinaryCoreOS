// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------
// A catalogue assembled from spreadsheets accumulates the same thing twice:
// "Shallot" and "Shallots", "UD Astungkara Lancar" and "UD Astungkara lancar".
// The cost is quiet — two rows for one ingredient means two prices to keep
// current, and whichever a recipe happens to point at is the one it costs from.
//
// Detection is by normalised name, then graded by whether the surrounding
// facts agree. Merging is offered only where the evidence supports it: two rows
// with the same name and the same price are the same thing, while two rows with
// the same name and different prices are usually different pack sizes or
// grades, and merging those would destroy a real distinction.
//
// Pure and separate from the UI, because a merge is irreversible and the thing
// deciding which rows are "the same" deserves tests.
// ---------------------------------------------------------------------------

import type { Product } from "@ccos/shared";
import { toDecimal } from "./cost-engine";

export type Confidence = "identical" | "likely" | "review";

export interface DuplicateGroup {
  /** The normalised key the members share. */
  key: string;
  members: Product[];
  confidence: Confidence;
  /** Why it was graded that way, in words a chef can act on. */
  reason: string;
  /**
   * The row to keep. The most-referenced name wins where that is knowable;
   * otherwise the one with the most filled-in detail, so a merge loses least.
   */
  suggestedSurvivor: Product;
}

/**
 * Normalise a name for comparison.
 *
 * Case, punctuation and spacing are noise. A trailing "s" is the single most
 * common difference in this catalogue — Shallot/Shallots, Green Bean/Green
 * beans, Coriander Seed/Coriander Seeds — and is worth folding even though it
 * will occasionally over-match, because every group is shown before anything
 * is merged.
 */
export function normaliseName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  // Only the last word is de-pluralised: "seeds mix" and "seed mixes" are not
  // the same thing, and stripping every trailing s would say they were.
  return base.replace(/s$/, "");
}

function completeness(p: Product): number {
  return [p.supplier, p.brand, p.allergens.length > 0 ? "y" : null].filter(
    Boolean,
  ).length;
}

/**
 * Group products that look like the same ingredient recorded twice.
 *
 * `usageCount` lets the caller weight by how often each row is actually
 * referenced — the row recipes already point at is the one to keep, since
 * keeping the other means rewriting more lines.
 */
export function findDuplicateProducts(
  products: Product[],
  usageCount: Map<string, number> = new Map(),
): DuplicateGroup[] {
  const byKey = new Map<string, Product[]>();
  for (const p of products) {
    const k = normaliseName(p.name);
    if (!k) continue;
    byKey.set(k, [...(byKey.get(k) ?? []), p]);
  }

  const groups: DuplicateGroup[] = [];

  for (const [key, members] of byKey) {
    if (members.length < 2) continue;

    const prices = new Set(
      members.map((m) => toDecimal(m.cost.grossPricePerUnit).toFixed(5)),
    );
    const suppliers = new Set(
      members.map((m) => (m.supplier ?? "").trim().toLowerCase()),
    );
    const units = new Set(members.map((m) => m.packing.totalUnit.toUpperCase()));

    let confidence: Confidence;
    let reason: string;

    if (units.size > 1) {
      // Sold by the kilo and by the each is not a spelling difference.
      confidence = "review";
      reason = "Recorded in different units, so these may not be the same item.";
    } else if (prices.size === 1 && suppliers.size === 1) {
      confidence = "identical";
      reason = "Same price and same supplier.";
    } else if (prices.size === 1) {
      confidence = "likely";
      reason = "Same price, different supplier recorded.";
    } else if (suppliers.size === 1 && suppliers.has("")) {
      confidence = "review";
      reason = "Different prices and no supplier on either, so nothing corroborates a match.";
    } else {
      confidence = "review";
      reason =
        "Different prices — often a different pack size or grade rather than a duplicate.";
    }

    const suggestedSurvivor = [...members].sort(
      (a, b) =>
        (usageCount.get(b.id) ?? 0) - (usageCount.get(a.id) ?? 0) ||
        completeness(b) - completeness(a) ||
        a.name.localeCompare(b.name),
    )[0];

    groups.push({ key, members, confidence, reason, suggestedSurvivor });
  }

  // Safest first: the ones that can be merged without a judgement call.
  const order: Record<Confidence, number> = { identical: 0, likely: 1, review: 2 };
  return groups.sort(
    (a, b) => order[a.confidence] - order[b.confidence] || a.key.localeCompare(b.key),
  );
}

export interface SupplierDuplicate {
  key: string;
  /** The distinct spellings found, with how many products carry each. */
  spellings: { name: string; items: number }[];
  suggestedSurvivor: string;
}

/**
 * Supplier names that differ only in case or spacing.
 *
 * Kept separate from products because the fix is different: a supplier is a
 * string on many rows, so merging means rewriting that string rather than
 * repointing references.
 */
export function findDuplicateSuppliers(products: Product[]): SupplierDuplicate[] {
  const counts = new Map<string, number>();
  for (const p of products) {
    const name = p.supplier?.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const byKey = new Map<string, string[]>();
  for (const name of counts.keys()) {
    const k = name.toLowerCase().replace(/\s+/g, " ");
    byKey.set(k, [...(byKey.get(k) ?? []), name]);
  }

  return [...byKey.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([key, names]) => {
      const spellings = names
        .map((name) => ({ name, items: counts.get(name) ?? 0 }))
        .sort((a, b) => b.items - a.items || a.name.localeCompare(b.name));
      return { key, spellings, suggestedSurvivor: spellings[0].name };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}
