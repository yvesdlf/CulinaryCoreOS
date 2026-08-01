// ---------------------------------------------------------------------------
// Sub-recipe sheet
// ---------------------------------------------------------------------------
// The recipe sheet prints "* prepared in house — see its own sheet for the
// method" against every component. Until now there was no such sheet, so the
// app pointed at something that did not exist, and a prep pack — which is
// mostly preparations — had nothing to print for the parts that get made.
//
// Same template as the dish sheet, with the differences a preparation actually
// has: a batch yield rather than a portion, a cost per unit rather than a menu
// price and food cost, and no allergen declaration of its own — a preparation
// is never served, so what matters is what it passes upward.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import type { SubRecipe } from "@ccos/shared";

import { useProductStore } from "@/stores/product-store";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import { allergenBreakdown } from "@/engine/allergen-breakdown";
import { resolveAllergens } from "@/lib/allergens";
import { getDependents } from "@/engine/cascade";
import { useRecipeStore } from "@/stores/recipe-store";
import { formatCurrency, formatNumber } from "@/lib/format";

export function SubRecipeSheet({ subRecipe }: { subRecipe: SubRecipe }) {
  const products = useProductStore((s) => s.products);
  const subRecipes = useSubRecipeStore((s) => s.subRecipes);
  const recipes = useRecipeStore((s) => s.recipes);
  const getProduct = useProductStore((s) => s.getById);
  const getSubRecipe = useSubRecipeStore((s) => s.getById);

  const breakdown = useMemo(
    () => allergenBreakdown(subRecipe.ingredientLines, { products, subRecipes }),
    [subRecipe, products, subRecipes],
  );

  /*
   * Which dishes this feeds, printed on the sheet.
   *
   * A cook holding a prep sheet is deciding how much to make, and the answer
   * is "however much those dishes need". It is the one thing a preparation
   * knows that a dish does not.
   */
  const feeds = useMemo(() => {
    const dep = getDependents(subRecipe.id, { subRecipes, recipes });
    const byId = new Map(recipes.map((r) => [r.id, r]));
    return dep.recipeIds
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [subRecipe.id, subRecipes, recipes]);

  const allergens = resolveAllergens(subRecipe.allergens);

  const lineName = (l: (typeof subRecipe.ingredientLines)[number]) =>
    (l.productId ? getProduct(l.productId)?.name : getSubRecipe(l.subRecipeId ?? "")?.name) ??
    "Unknown ingredient";

  return (
    <article className="mx-auto max-w-3xl break-after-page last:break-after-auto">
      <header className="border-b pb-4">
        <h1 className="text-3xl font-semibold">{subRecipe.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Preparation · {subRecipe.category} · {subRecipe.status} · Batch{" "}
          {formatNumber(subRecipe.batchYield.qty)} {subRecipe.batchYield.unit}
          {subRecipe.preparation.prepMinutes !== null && (
            <> · Prep {subRecipe.preparation.prepMinutes} min</>
          )}
          {subRecipe.preparation.cookMinutes !== null && (
            <> · Cook {subRecipe.preparation.cookMinutes} min</>
          )}
        </p>
      </header>

      {allergens.length > 0 && (
        <section className="mt-6" aria-labelledby={`sub-allergens-${subRecipe.id}`}>
          <h2
            id={`sub-allergens-${subRecipe.id}`}
            className="text-sm font-semibold uppercase tracking-wide"
          >
            Allergens carried into every dish using this
          </h2>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {allergens.map((r) => (
              <li
                key={r.known ? r.definition.id : r.raw}
                className="flex items-center gap-1.5 text-sm"
              >
                {r.known ? (
                  <>
                    <r.definition.icon className="size-4" aria-hidden="true" />
                    <span>{r.definition.name}</span>
                    <span className="text-muted-foreground">({r.definition.code})</span>
                  </>
                ) : (
                  <span>{r.raw}</span>
                )}
              </li>
            ))}
          </ul>
          {breakdown.some((b) => b.needsReview) && (
            <p className="mt-2 text-xs text-status-warning">
              Some of these are not verified against the product bought.
            </p>
          )}
        </section>
      )}

      <section className="mt-6" aria-labelledby={`sub-ingredients-${subRecipe.id}`}>
        <h2
          id={`sub-ingredients-${subRecipe.id}`}
          className="text-sm font-semibold uppercase tracking-wide"
        >
          Ingredients
        </h2>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="py-1 font-medium">Quantity</th>
              <th scope="col" className="py-1 font-medium">Ingredient</th>
              <th scope="col" className="py-1 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {subRecipe.ingredientLines.map((l) => (
              <tr key={l.id} className="border-b last:border-0">
                <td className="whitespace-nowrap py-1.5 tabular-nums">
                  {formatNumber(l.nettQty)} {l.nettUnit}
                </td>
                <td className="py-1.5">{lineName(l)}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {formatCurrency(l.lineCost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-6" aria-labelledby={`sub-method-${subRecipe.id}`}>
        <h2
          id={`sub-method-${subRecipe.id}`}
          className="text-sm font-semibold uppercase tracking-wide"
        >
          Method
        </h2>
        {subRecipe.preparation.method.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Not written yet.</p>
        ) : (
          <ol className="mt-2 space-y-2 text-sm">
            {subRecipe.preparation.method.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground">
                  {i + 1}.
                </span>
                <span className="flex-1">{step}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-6 grid gap-6 sm:grid-cols-2 print:grid-cols-1">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide">Batch cost</h2>
          <dl className="mt-2 space-y-1 text-sm">
            {[
              ["Ingredients", formatCurrency(subRecipe.totalCost)],
              [
                "Batch yield",
                `${formatNumber(subRecipe.batchYield.qty)} ${subRecipe.batchYield.unit}`,
              ],
              // The figure a dish multiplies by, which is what makes this
              // preparation cost anything upstream.
              ["Cost per unit", formatCurrency(subRecipe.costPerUnit)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide">Used in</h2>
          {feeds.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No dish uses this yet.
            </p>
          ) : (
            <ul className="mt-2 space-y-0.5 text-sm">
              {feeds.map((r) => (
                <li key={r.id}>{r.name}</li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </article>
  );
}
