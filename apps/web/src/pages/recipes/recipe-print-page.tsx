// ---------------------------------------------------------------------------
// Recipe viewer / print view — DOC4 §11.3
// ---------------------------------------------------------------------------
// The formatted recipe: read-only, single column, no navigation chrome, and
// laid out to survive a kitchen printer. This is the artifact that gets pinned
// to a pass or handed to a new commis, so it says what someone cooking needs
// and leaves out what only an accountant does.
//
// The allergen section is per-ingredient rather than a dish-level list. A list
// says the plate is unsafe; only the breakdown tells a chef which component to
// change, which is the question actually asked at service.
//
// Print rules from §11.3: category and status as text rather than coloured
// badges, cost and nutrition side by side on screen and stacked on paper, and
// the interface itself excluded from the printed page.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Printer, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useRecipeStore } from "@/stores/recipe-store";
import { useProductStore } from "@/stores/product-store";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import { allergenBreakdown } from "@/engine/allergen-breakdown";
import { nutritionCoverage, deriveRecipeNutrition } from "@/engine/nutrition-engine";
import { resolveAllergens } from "@/lib/allergens";
import { formatCurrency, formatPercent, formatNumber } from "@/lib/format";

export function RecipePrintPage() {
  const { id } = useParams<{ id: string }>();
  const recipe = useRecipeStore((s) => (id ? s.getById(id) : undefined));
  const products = useProductStore((s) => s.products);
  const subRecipes = useSubRecipeStore((s) => s.subRecipes);
  const getProduct = useProductStore((s) => s.getById);
  const getSubRecipe = useSubRecipeStore((s) => s.getById);

  const breakdown = useMemo(
    () =>
      recipe ? allergenBreakdown(recipe.ingredientLines, { products, subRecipes }) : [],
    [recipe, products, subRecipes],
  );

  const nutrition = useMemo(
    () =>
      recipe
        ? deriveRecipeNutrition(recipe.ingredientLines, recipe.portion.yieldQty, {
            getProduct,
            getSubRecipe,
          })
        : null,
    [recipe, getProduct, getSubRecipe],
  );

  const coverage = useMemo(
    () =>
      recipe
        ? nutritionCoverage(recipe.ingredientLines, { getProduct, getSubRecipe })
        : { withData: 0, total: 0 },
    [recipe, getProduct, getSubRecipe],
  );

  if (!recipe) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted-foreground">Recipe not found.</p>
        <Link to="/recipes" className="text-sm underline underline-offset-4">
          Back to recipes
        </Link>
      </div>
    );
  }

  const named = resolveAllergens(recipe.allergens);
  const unverified = breakdown.filter((b) => b.needsReview);

  const lineName = (l: (typeof recipe.ingredientLines)[number]) =>
    (l.productId ? getProduct(l.productId)?.name : getSubRecipe(l.subRecipeId ?? "")?.name) ??
    "Unknown ingredient";

  return (
    <article className="mx-auto max-w-3xl">
      {/* Not printed: the controls that put it on paper. */}
      <div className="mb-6 flex items-center justify-between gap-3 print:hidden">
        <Button variant="outline" nativeButton={false} render={<Link to={`/recipes/${recipe.id}`} />}>
          <ArrowLeft className="mr-1 size-4" aria-hidden="true" />
          Back to editor
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="mr-1 size-4" aria-hidden="true" />
          Print
        </Button>
      </div>

      <header className="border-b pb-4">
        <h1 className="text-3xl font-semibold">{recipe.name}</h1>
        {/* Text, not badges — §11.3, and a badge prints as a grey lozenge. */}
        <p className="mt-1 text-sm text-muted-foreground">
          {recipe.category} · {recipe.status} · Yields{" "}
          {formatNumber(recipe.portion.yieldQty)} {recipe.portion.yieldUnit}
        </p>
      </header>

      {/* ── Allergens ─────────────────────────────────────────────────────── */}
      <section className="mt-6" aria-labelledby="print-allergens">
        <h2 id="print-allergens" className="text-sm font-semibold uppercase tracking-wide">
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
      <section className="mt-6" aria-labelledby="print-ingredients">
        <h2 id="print-ingredients" className="text-sm font-semibold uppercase tracking-wide">
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

      <footer className="mt-8 border-t pt-3 text-xs text-muted-foreground">
        {/* Printed sheets outlive the prices on them, so the sheet says when it
            was true rather than leaving someone to guess. */}
        CulinaryCoreOS · {recipe.name} · costs as at{" "}
        {new Date().toLocaleDateString("id-ID")}
      </footer>
    </article>
  );
}
