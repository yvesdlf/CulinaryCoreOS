import { useMemo } from "react";
import { findUnverifiedAllergens } from "@/engine/allergen-review";
import { useProductStore } from "@/stores/product-store";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";

interface LineLike {
  productId: string | null;
  subRecipeId: string | null;
}

/**
 * Ingredients in these lines whose allergen list nobody has verified.
 *
 * Wrapped as a hook so every page that shows a dish asks the same question the
 * same way — three pages each reaching into two stores would drift, and the
 * one that drifted would be the one that quietly stopped warning.
 */
export function useAllergenReviews(lines: LineLike[]) {
  const products = useProductStore((s) => s.products);
  const subRecipes = useSubRecipeStore((s) => s.subRecipes);

  return useMemo(
    () => findUnverifiedAllergens(lines, { products, subRecipes }),
    [lines, products, subRecipes],
  );
}
