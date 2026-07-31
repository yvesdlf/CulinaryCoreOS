// ---------------------------------------------------------------------------
// Unverified allergen sources
// ---------------------------------------------------------------------------
// An allergen declaration imported from a costing sheet describes a generic
// ingredient, not the jar in the store cupboard. Whether a tom yum paste
// contains shrimp is a property of the brand, and only someone holding it can
// say. The product carries a flag for that; this module answers the question
// that actually matters at service: which dishes depend on one?
//
// Transitive, because the risk is. A dish uses Kimchi Mayo, which uses Kimchi
// sauce, which nobody has checked — and the plate reaching a guest with a
// shellfish allergy is the dish, not the sauce.
//
// Deliberately not stored. Marking one product as reviewed would otherwise
// have to invalidate a cached flag on every dish above it, and a stale "no
// review needed" is exactly the failure this exists to prevent.
// ---------------------------------------------------------------------------

import type { Product, SubRecipe, Recipe } from "@ccos/shared";

export interface AllergenReview {
  productId: string;
  productName: string;
  note: string | null;
  /**
   * How the dish reaches it — [] when the product is used directly, otherwise
   * the sub-recipes in between, so a chef knows where to look.
   */
  via: string[];
}

interface Sources {
  products: Product[];
  subRecipes: SubRecipe[];
}

interface LineLike {
  productId: string | null;
  subRecipeId: string | null;
}

/**
 * Every unverified ingredient an entity depends on, directly or through its
 * preparations.
 *
 * Cycle-safe: nothing prevents two sub-recipes referencing each other, and a
 * naive walk would recurse until the tab died.
 */
export function findUnverifiedAllergens(
  lines: LineLike[],
  { products, subRecipes }: Sources,
): AllergenReview[] {
  const productById = new Map(products.map((p) => [p.id, p]));
  const subById = new Map(subRecipes.map((s) => [s.id, s]));

  const found = new Map<string, AllergenReview>();
  const visited = new Set<string>();

  function walk(current: LineLike[], via: string[]): void {
    for (const line of current) {
      if (line.productId) {
        const product = productById.get(line.productId);
        if (product?.allergensNeedReview && !found.has(product.id)) {
          found.set(product.id, {
            productId: product.id,
            productName: product.name,
            note: product.allergenReviewNote,
            via,
          });
        }
        continue;
      }

      if (!line.subRecipeId || visited.has(line.subRecipeId)) continue;
      visited.add(line.subRecipeId);
      const sub = subById.get(line.subRecipeId);
      if (sub) walk(sub.ingredientLines, [...via, sub.name]);
    }
  }

  walk(lines, []);
  // Stable order so the same dish reads the same way twice running.
  return [...found.values()].sort((a, b) =>
    a.productName.localeCompare(b.productName),
  );
}

/** Convenience for a whole recipe or sub-recipe. */
export function reviewsFor(
  entity: Recipe | SubRecipe,
  sources: Sources,
): AllergenReview[] {
  return findUnverifiedAllergens(entity.ingredientLines, sources);
}
