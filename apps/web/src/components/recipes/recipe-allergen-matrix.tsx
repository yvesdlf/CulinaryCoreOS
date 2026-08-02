// ---------------------------------------------------------------------------
// Per-recipe allergen matrix
// ---------------------------------------------------------------------------
// The menu-wide grid is dishes down the side and the regulated fourteen
// across. This is the same grid for one dish: its ingredients down the side,
// the same fourteen across, so a chef can see at a glance which component
// carries what — and which column would empty if one were swapped out.
//
// A prose list ("contains crustaceans, fish, molluscs") answers whether the
// plate is safe. A grid answers what to change, which is the question asked
// when a guest declares an allergy and the kitchen has ninety seconds.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import type { Recipe, SubRecipe } from "@ccos/shared";

import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { useProductStore } from "@/stores/product-store";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import { allergenBreakdown } from "@/engine/allergen-breakdown";
import { EU14_ALLERGENS, resolveAllergens } from "@/lib/allergens";

interface Props {
  /** A dish or a preparation — both are lists of ingredient lines. */
  entity: Pick<Recipe | SubRecipe, "id" | "ingredientLines">;
}

export function RecipeAllergenMatrix({ entity }: Props) {
  const products = useProductStore((s) => s.products);
  const subRecipes = useSubRecipeStore((s) => s.subRecipes);

  const rows = useMemo(
    () => allergenBreakdown(entity.ingredientLines, { products, subRecipes }),
    [entity, products, subRecipes],
  );

  /*
   * Only the columns this dish actually touches.
   *
   * Fourteen columns for a dish carrying three allergens is thirteen-fourteenths
   * empty, and on a printed sheet it forces the ingredient names into a narrow
   * gutter. The full fourteen live on the menu-wide matrix, where comparing
   * dishes is the point.
   */
  const columns = useMemo(() => {
    const present = new Set<string>();
    for (const r of rows) {
      for (const a of resolveAllergens(r.allergens)) {
        if (a.known) present.add(a.definition.id);
      }
    }
    return EU14_ALLERGENS.filter((a) => present.has(a.id));
  }, [rows]);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No ingredient here declares an allergen. That is not the same as having
        been checked.
      </p>
    );
  }

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[12rem]">Ingredient</TableHead>
            {columns.map((a) => (
              <TableHead key={a.id} className="text-center">
                <abbr title={a.name} className="no-underline">
                  <span className="flex flex-col items-center gap-0.5">
                    <a.icon className="size-3.5" aria-hidden="true" />
                    <span aria-hidden="true">{a.code}</span>
                  </span>
                  {/* The written name carries the meaning; the code and icon
                      are compact aids and never stand alone (Appendix G). */}
                  <span className="sr-only">{a.name}</span>
                </abbr>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const ids = new Set(
              resolveAllergens(r.allergens)
                .filter((x) => x.known)
                .map((x) => x.definition.id),
            );
            return (
              <TableRow key={r.id}>
                <TableCell>
                  {r.name}
                  {r.kind === "sub-recipe" && (
                    <span className="text-muted-foreground"> (preparation)</span>
                  )}
                  {r.needsReview && (
                    <span className="block text-xs text-status-warning">
                      Not verified against the product.
                    </span>
                  )}
                </TableCell>
                {columns.map((a) => (
                  <TableCell key={a.id} className="text-center">
                    {ids.has(a.id) ? (
                      <a.icon
                        className="mx-auto size-4 text-status-danger"
                        aria-hidden="true"
                      />
                    ) : (
                      <span aria-hidden="true" className="text-muted-foreground">
                        –
                      </span>
                    )}
                    {/* Absence is announced too — a screen reader reading a row
                        of silence cannot tell an empty cell from a skipped one. */}
                    <span className="sr-only">
                      {ids.has(a.id)
                        ? `${r.name} contributes ${a.name}`
                        : `${r.name}: no ${a.name}`}
                    </span>
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
