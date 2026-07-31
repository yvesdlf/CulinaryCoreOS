// ---------------------------------------------------------------------------
// Price change impact
// ---------------------------------------------------------------------------
// The question a supplier price rise actually raises is not "what does this
// ingredient cost now", it is "which dishes stop making money". Answering that
// by hand means opening every recipe that uses it, which is why nobody does it
// and why menus drift.
//
// This runs the real cascade — the same `cascadeFrom` a saved price change
// runs — against a copy of the catalogue, and diffs the result. Nothing is
// written. A simulation that used a simplified model would be worse than none,
// because it would disagree with the app the moment you committed the change.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { TrendingUp } from "lucide-react";
import type { Product } from "@ccos/shared";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { formatPercent } from "@/lib/format";
import { FoodCostIndicator } from "@/components/shared/food-cost-indicator";
import { cascadeFrom } from "@/engine/cascade";
import { toDecimal } from "@/engine/cost-engine";
import { useProductStore } from "@/stores/product-store";
import { useRecipeStore } from "@/stores/recipe-store";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import {
  TARGET_FOOD_COST_PERCENT,
  FOOD_COST_VARIANCE_PERCENT,
} from "@/lib/constants";

const PRESETS = [-10, -5, 5, 10, 25];

export function PriceImpact({ product }: { product: Product }) {
  const products = useProductStore((s) => s.products);
  const recipes = useRecipeStore((s) => s.recipes);
  const subRecipes = useSubRecipeStore((s) => s.subRecipes);
  const [percent, setPercent] = useState<number>(10);

  const upper = TARGET_FOOD_COST_PERCENT + FOOD_COST_VARIANCE_PERCENT;

  const impact = useMemo(() => {
    const factor = toDecimal(100 + percent).dividedBy(100);
    const scale = (v: string) => toDecimal(v).times(factor).toFixed(5);

    // A copy, so the stores — and therefore the rest of the UI — never see
    // the hypothetical price. The cascade is pure, but the array it reads is
    // shared, and mutating it here would silently reprice the whole app.
    const hypothetical: Product[] = products.map((p) =>
      p.id === product.id
        ? {
            ...p,
            cost: {
              ...p.cost,
              buyingPricePerPack: scale(p.cost.buyingPricePerPack),
              buyingPricePerUnit: scale(p.cost.buyingPricePerUnit),
              grossPricePerUnit: scale(p.cost.grossPricePerUnit),
              nettPricePerUnit: scale(p.cost.nettPricePerUnit),
            },
          }
        : p,
    );

    const before = new Map(recipes.map((r) => [r.id, r]));
    const after = cascadeFrom(product.id, {
      products: hypothetical,
      subRecipes,
      recipes,
    });

    const changed = after.recipes
      .map((now) => {
        const was = before.get(now.id)!;
        return {
          recipe: now,
          wasCost: was.pricing.totalCog,
          wasPercent: was.pricing.foodCostPercent,
          nowPercent: now.pricing.foodCostPercent,
          // Only dishes whose food cost actually moved; a recipe can be a
          // dependent and still round to the same figure.
          moved: Math.abs(now.pricing.foodCostPercent - was.pricing.foodCostPercent) >= 0.05,
        };
      })
      .filter((r) => r.moved)
      .sort((a, b) => b.nowPercent - a.nowPercent);

    return {
      changed,
      // The headline: dishes that were fine and no longer are.
      breaking: changed.filter(
        (r) => r.wasPercent <= upper && r.nowPercent > upper,
      ),
      subRecipesTouched: after.affected.subRecipeIds.length,
    };
  }, [product, products, recipes, subRecipes, percent, upper]);

  const newPrice = toDecimal(product.cost.grossPricePerUnit)
    .times(toDecimal(100 + percent).dividedBy(100))
    .toFixed(2);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="size-4" aria-hidden="true" />
          If this price changes
        </CardTitle>
        <CardDescription>
          Nothing is saved. This runs the same re-costing a real price change
          would, so the figures are the ones you would get.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p}
              variant={percent === p ? "default" : "outline"}
              size="sm"
              onClick={() => setPercent(p)}
            >
              {p > 0 ? `+${p}%` : `${p}%`}
            </Button>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">Custom percentage change</span>
            <Input
              type="number"
              value={percent}
              onChange={(e) => setPercent(Number(e.target.value) || 0)}
              className="w-20"
              aria-label="Percentage change"
            />
            %
          </label>
        </div>

        <p className="mb-4 text-sm text-muted-foreground">
          <CurrencyDisplay value={product.cost.grossPricePerUnit} decimals={2} />{" "}
          → <CurrencyDisplay value={newPrice} decimals={2} /> per{" "}
          {product.yield_.grossUnit || product.packing.totalUnit}
          {impact.subRecipesTouched > 0 && (
            <>
              {" "}
              · reaches {impact.subRecipesTouched}{" "}
              {impact.subRecipesTouched === 1 ? "preparation" : "preparations"}
            </>
          )}
        </p>

        {impact.changed.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No dish{" "}
            {percent === 0 ? "would change" : "moves by as much as 0,05 points"}
            . This ingredient is either unused or a rounding error in every
            recipe that has it.
          </p>
        ) : (
          <>
            {impact.breaking.length > 0 && (
              <p className="mb-3 text-sm font-medium text-status-warning">
                {impact.breaking.length}{" "}
                {impact.breaking.length === 1 ? "dish crosses" : "dishes cross"}{" "}
                {upper}% food cost:{" "}
                {impact.breaking.map((b) => b.recipe.name).join(", ")}
              </p>
            )}

            <ul className="divide-y">
              {impact.changed.slice(0, 12).map((r) => (
                <li
                  key={r.recipe.id}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <Link
                    to={`/recipes/${r.recipe.id}`}
                    className="min-w-0 flex-1 truncate underline-offset-4 hover:underline"
                  >
                    {r.recipe.name}
                  </Link>
                  <span className="flex items-center gap-2 tabular-nums">
                    {/* formatPercent, not toFixed: the indicator beside it
                        formats for id-ID, and "87.7% → 94,3%" side by side
                        reads as two different measurements. */}
                    <span className="text-muted-foreground">
                      {formatPercent(r.wasPercent)}
                    </span>
                    <span aria-hidden="true">→</span>
                    <FoodCostIndicator value={r.nowPercent} />
                  </span>
                </li>
              ))}
            </ul>
            {impact.changed.length > 12 && (
              <p className="mt-2 text-xs text-muted-foreground">
                and {impact.changed.length - 12} more
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
