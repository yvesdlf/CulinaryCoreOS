// ---------------------------------------------------------------------------
// Recipe sheet — DOC4 §11.3
// ---------------------------------------------------------------------------
// The formatted recipe as a component, so the single-recipe page and a
// collection printing twenty of them share one template. Two copies of a
// layout drift, and the one that drifts is the one nobody was looking at.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { TriangleAlert } from "lucide-react";
import type { Recipe } from "@ccos/shared";

import { useProductStore } from "@/stores/product-store";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import { allergenBreakdown } from "@/engine/allergen-breakdown";
import { nutritionCoverage, deriveRecipeNutrition } from "@/engine/nutrition-engine";
import { resolveAllergens } from "@/lib/allergens";
import { formatCurrency, formatPercent, formatNumber } from "@/lib/format";

export function RecipeSheet({ recipe }: { recipe: Recipe }) {
  const products = useProductStore((s) => s.products);
  const subRecipes = useSubRecipeStore((s) => s.subRecipes);
  const getProduct = useProductStore((s) => s.getById);
  const getSubRecipe = useSubRecipeStore((s) => s.getById);

  const breakdown = useMemo(
    () => allergenBreakdown(recipe.ingredientLines, { products, subRecipes }),
    [recipe, products, subRecipes],
  );

  const nutrition = useMemo(
    () =>
      deriveRecipeNutrition(recipe.ingredientLines, recipe.portion.yieldQty, {
        getProduct,
        getSubRecipe,
      }),
    [recipe, getProduct, getSubRecipe],
  );

  const coverage = useMemo(
    () => nutritionCoverage(recipe.ingredientLines, { getProduct, getSubRecipe }),
    [recipe, getProduct, getSubRecipe],
  );

  const named = resolveAllergens(recipe.allergens);
  const unverified = breakdown.filter((b) => b.needsReview);

  const lineName = (l: (typeof recipe.ingredientLines)[number]) =>
    (l.productId ? getProduct(l.productId)?.name : getSubRecipe(l.subRecipeId ?? "")?.name) ??
    "Unknown ingredient";

  return (
    <article className="mx-auto max-w-3xl break-after-page last:break-after-auto">
      <header className="border-b pb-4">
        <h1 className="text-3xl font-semibold">{recipe.name}</h1>
        {/* Text, not badges — §11.3, and a badge prints as a grey lozenge. */}
        <p className="mt-1 text-sm text-muted-foreground">
          {recipe.category} · {recipe.status} · Yields{" "}
          {formatNumber(recipe.portion.yieldQty)} {recipe.portion.yieldUnit}
          {recipe.preparation.prepMinutes !== null && (
            <> · Prep {recipe.preparation.prepMinutes} min</>
          )}
          {recipe.preparation.cookMinutes !== null && (
            <> · Cook {recipe.preparation.cookMinutes} min</>
          )}
        </p>
      </header>

      {/* ── Allergens ─────────────────────────────────────────────────────── */}
      <section className="mt-6" aria-labelledby={`allergens-${recipe.id}`}>
        <h2 id={`allergens-${recipe.id}`} className="text-sm font-semibold uppercase tracking-wide">
          Allergens
        </h2>

        {named.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            None declared. That is not the same as having been checked.
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {named.map((r) => (
              <li key={r.known ? r.definition.id : r.raw} className="flex items-center gap-1.5 text-sm">
                {r.known ? (
                  <>
                    <r.definition.icon className="size-4" aria-hidden="true" />
                    {/* The written name, always — a code never stands alone. */}
                    <span>{r.definition.name}</span>
                    <span className="text-muted-foreground">({r.definition.code})</span>
                  </>
                ) : (
                  <span>{r.raw}</span>
                )}
              </li>
            ))}
          </ul>
        )}

        {breakdown.length > 0 && (
          <table className="mt-4 w-full text-sm">
            <caption className="sr-only">
              Which ingredient contributes each allergen
            </caption>
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="py-1 font-medium">Ingredient</th>
                <th scope="col" className="py-1 font-medium">Contributes</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((b) => (
                <tr key={b.id} className="border-b align-top last:border-0">
                  <td className="py-1.5">
                    {b.name}
                    {b.kind === "sub-recipe" && (
                      <span className="text-muted-foreground"> (preparation)</span>
                    )}
                    {b.via.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        from {b.via.map((v) => v.name).join(", ")}
                      </div>
                    )}
                  </td>
                  <td className="py-1.5">
                    {resolveAllergens(b.allergens)
                      .map((r) => (r.known ? r.definition.name : r.raw))
                      .join(", ") || "--"}
                    {b.needsReview && (
                      <span className="block text-xs text-status-warning">
                        Not verified against the product — check before serving.
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {unverified.length > 0 && (
          <p className="mt-3 flex items-start gap-2 rounded-md border border-status-warning/40 bg-status-warning-soft p-3 text-xs text-foreground/80">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-status-warning" aria-hidden="true" />
            This sheet is not an allergen declaration while{" "}
            {unverified.length === 1 ? "an ingredient has" : `${unverified.length} ingredients have`}{" "}
            an unverified list.
          </p>
        )}
      </section>

      {/* ── Ingredients ───────────────────────────────────────────────────── */}
      <section className="mt-6" aria-labelledby={`ingredients-${recipe.id}`}>
        <h2 id={`ingredients-${recipe.id}`} className="text-sm font-semibold uppercase tracking-wide">
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
            {recipe.ingredientLines.map((l) => (
              <tr key={l.id} className="border-b last:border-0">
                <td className="whitespace-nowrap py-1.5 tabular-nums">
                  {formatNumber(l.nettQty)} {l.nettUnit}
                </td>
                <td className="py-1.5">
                  {lineName(l)}
                  {/* The asterisk convention from §11.3: made in house. */}
                  {l.subRecipeId && <span aria-label=" (made in house)">*</span>}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {formatCurrency(l.lineCost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {recipe.ingredientLines.some((l) => l.subRecipeId) && (
          <p className="mt-1 text-xs text-muted-foreground">
            * prepared in house — see its own sheet for the method.
          </p>
        )}
      </section>

      {/* ── Method ────────────────────────────────────────────────────────── */}
      <section className="mt-6" aria-labelledby={`method-${recipe.id}`}>
        <h2
          id={`method-${recipe.id}`}
          className="text-sm font-semibold uppercase tracking-wide"
        >
          Method
        </h2>
        {recipe.preparation.method.length === 0 ? (
          // Said plainly rather than left blank: a sheet with an empty method
          // section looks like a printing fault, and someone will assume the
          // steps were lost rather than never written.
          <p className="mt-2 text-sm text-muted-foreground">
            Not written yet.
          </p>
        ) : (
          <ol className="mt-2 space-y-2 text-sm">
            {recipe.preparation.method.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground">
                  {i + 1}.
                </span>
                <span className="flex-1">{step}</span>
              </li>
            ))}
          </ol>
        )}
        {/* internalNotes is deliberately absent — the editor promises it stays
            off printed sheets, and this is the sheet. */}
      </section>

      {/* ── Cost and nutrition ────────────────────────────────────────────── */}
      <section className="mt-6 grid gap-6 sm:grid-cols-2 print:grid-cols-1">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide">Cost</h2>
          <dl className="mt-2 space-y-1 text-sm">
            {[
              ["Ingredients", formatCurrency(recipe.pricing.totalCost)],
              ["Waste", formatCurrency(recipe.pricing.wasteAmount)],
              ["Inflation", formatCurrency(recipe.pricing.inflationAmount)],
              ["Total cost", formatCurrency(recipe.pricing.totalCog)],
              ["Menu price (excl. tax)", formatCurrency(recipe.pricing.menuPrice)],
              ["Guest price (incl. tax)", formatCurrency(recipe.pricing.priceInclTax)],
              ["Food cost", formatPercent(recipe.pricing.foodCostPercent)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide">
            Nutrition (per portion)
          </h2>
          {coverage.withData === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Not recorded. None of these ingredients carry nutrition data.
            </p>
          ) : (
            <>
              <dl className="mt-2 space-y-1 text-sm">
                {nutrition &&
                  [
                    ["Calories", `${Math.round(nutrition.kcal)} kcal`],
                    ["Fat", `${formatNumber(nutrition.fatG)} g`],
                    ["Carbohydrate", `${formatNumber(nutrition.carbsG)} g`],
                    ["Protein", `${formatNumber(nutrition.proteinG)} g`],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="tabular-nums">{v}</dd>
                    </div>
                  ))}
              </dl>
              {coverage.withData < coverage.total && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Based on {coverage.withData} of {coverage.total} ingredients —
                  a minimum, not a total.
                </p>
              )}
            </>
          )}
        </div>
      </section>

    </article>
  );
}
