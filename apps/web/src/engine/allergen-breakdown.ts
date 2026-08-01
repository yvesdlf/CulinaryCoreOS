// ---------------------------------------------------------------------------
// Per-recipe allergen attribution
// ---------------------------------------------------------------------------
// The menu-wide matrix answers "which dishes contain milk". This answers the
// question that follows: "which part of this dish is the milk in, and can it
// come out". A dish-level list says a plate is unsafe; only an ingredient-level
// one tells a chef what to change.
//
// Attribution follows the same edges as inheritance, so an allergen arriving
// through a preparation is credited to that preparation and to the ingredient
// inside it — a chef swapping a sauce needs to see that the sauce is where the
// gluten came from, not just that the dish has gluten somewhere.
// ---------------------------------------------------------------------------

import type { Product, SubRecipe } from "@ccos/shared";
import { resolveAllergens } from "@/lib/allergens";

export interface AllergenSource {
  /** The line's own ingredient — a product or a preparation. */
  name: string;
  kind: "product" | "sub-recipe";
  id: string;
  /** Canonical ids this line contributes, in registry order. */
  allergens: string[];
  /**
   * For a preparation, which of its own ingredients carry each allergen —
   * the answer to "what in the sauce".
   */
  via: { name: string; allergens: string[] }[];
  /** The allergen list behind this line has not been verified. */
  needsReview: boolean;
}

interface Sources {
  products: Product[];
  subRecipes: SubRecipe[];
}

interface LineLike {
  productId: string | null;
  subRecipeId: string | null;
}

const canonical = (values: string[]): string[] =>
  resolveAllergens(values).map((r) => (r.known ? r.definition.id : r.raw));

/**
 * Attribute a recipe's allergens to the lines that bring them.
 *
 * Lines carrying nothing are omitted: a breakdown listing twenty ingredients
 * with fourteen empty columns each buries the three that matter.
 */
export function allergenBreakdown(
  lines: LineLike[],
  { products, subRecipes }: Sources,
): AllergenSource[] {
  const productById = new Map(products.map((p) => [p.id, p]));
  const subById = new Map(subRecipes.map((s) => [s.id, s]));

  const out: AllergenSource[] = [];

  for (const line of lines) {
    if (line.productId) {
      const p = productById.get(line.productId);
      if (!p) continue;
      const allergens = canonical(p.allergens);
      if (allergens.length === 0 && !p.allergensNeedReview) continue;
      out.push({
        name: p.name,
        kind: "product",
        id: p.id,
        allergens,
        via: [],
        needsReview: p.allergensNeedReview,
      });
      continue;
    }

    if (!line.subRecipeId) continue;
    const s = subById.get(line.subRecipeId);
    if (!s) continue;

    // One level down is where the answer usually is. Deeper nesting is rare
    // here and would make a printed sheet unreadable; the preparation's own
    // page carries its full breakdown.
    const via: { name: string; allergens: string[] }[] = [];
    let anyReview = false;
    for (const inner of s.ingredientLines) {
      const ip = inner.productId ? productById.get(inner.productId) : undefined;
      const isub = inner.subRecipeId ? subById.get(inner.subRecipeId) : undefined;
      const source = ip ?? isub;
      if (!source) continue;
      if (ip?.allergensNeedReview) anyReview = true;
      const a = canonical(source.allergens);
      if (a.length > 0) via.push({ name: source.name, allergens: a });
    }

    const allergens = canonical(s.allergens);
    if (allergens.length === 0 && !anyReview) continue;
    out.push({
      name: s.name,
      kind: "sub-recipe",
      id: s.id,
      allergens,
      via,
      needsReview: anyReview,
    });
  }

  return out;
}
