// ---------------------------------------------------------------------------
// Food cost summary — the dashboard
// ---------------------------------------------------------------------------
// This replaces the workbook's Food Cost Summary sheet, which is the one page
// the venue actually opens. It answers a single question across the whole
// menu: which dishes are off target, and what would put them back?
//
// It reported hardcoded counts before — "20 products, 5 recipes" against a
// catalogue of 1.102 and 115. A dashboard that is decorative is worse than no
// dashboard, because it is the page people trust without checking.
//
// Everything here is derived at render time from the same stores the lists
// read. There is no separate summary to fall out of step with the dishes.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Package, ChefHat, Layers, ArrowRight, TriangleAlert } from "lucide-react";
import type { Recipe } from "@ccos/shared";

import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { FoodCostIndicator } from "@/components/shared/food-cost-indicator";
import { useProductStore } from "@/stores/product-store";
import { useRecipeStore } from "@/stores/recipe-store";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import {
  calculateRecommendedPrice,
  roundToNearest,
  toDecimal,
} from "@/engine/cost-engine";
import {
  TARGET_FOOD_COST_PERCENT,
  FOOD_COST_VARIANCE_PERCENT,
  PRICE_ROUNDING_STEP,
} from "@/lib/constants";

/** How many off-target dishes to list before pointing at the full list. */
const SHOWN = 10;

interface OffTarget {
  recipe: Recipe;
  /** Price that would hit the target food cost, rounded for a menu. */
  suggested: string;
  /** Signed gap in percentage points; negative means cheap, not expensive. */
  gap: number;
}

export function DashboardPage() {
  const products = useProductStore((s) => s.products);
  const recipes = useRecipeStore((s) => s.recipes);
  const subRecipes = useSubRecipeStore((s) => s.subRecipes);

  const upper = TARGET_FOOD_COST_PERCENT + FOOD_COST_VARIANCE_PERCENT;
  const lower = TARGET_FOOD_COST_PERCENT - FOOD_COST_VARIANCE_PERCENT;

  const summary = useMemo(() => {
    // A dish with no price cannot have a food cost, so it is counted as
    // unpriced rather than folded in as 0% and quietly flattering the average.
    const priced = recipes.filter((r) => Number(r.pricing.menuPrice) > 0);

    const offTarget: OffTarget[] = priced
      .filter(
        (r) =>
          r.pricing.foodCostPercent > upper ||
          r.pricing.foodCostPercent < lower,
      )
      .map((recipe) => ({
        recipe,
        suggested: roundToNearest(
          calculateRecommendedPrice(
            recipe.pricing.totalCog,
            TARGET_FOOD_COST_PERCENT,
          ),
          PRICE_ROUNDING_STEP,
        ).toFixed(0),
        gap: recipe.pricing.foodCostPercent - TARGET_FOOD_COST_PERCENT,
      }))
      // Worst first: the dish losing the most money is the one to look at.
      .sort((a, b) => b.gap - a.gap);

    // Weighted by cost, not a mean of percentages. Averaging the percentages
    // would let a Rp 20.000 side dish count as much as a Rp 2.500.000 platter.
    const totalCog = priced.reduce(
      (acc, r) => acc.plus(toDecimal(r.pricing.totalCog)),
      toDecimal(0),
    );
    const totalRevenue = priced.reduce(
      (acc, r) => acc.plus(toDecimal(r.pricing.menuPrice)),
      toDecimal(0),
    );
    const blended = totalRevenue.greaterThan(0)
      ? totalCog.dividedBy(totalRevenue).times(100).toNumber()
      : 0;

    return {
      priced,
      unpriced: recipes.length - priced.length,
      offTarget,
      onTarget: priced.length - offTarget.length,
      blended,
      // Products the import could not resolve, or whose data was inferred.
      needsReview: products.filter((p) => p.status === "PENDING").length,
    };
  }, [recipes, products, upper, lower]);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`Food cost across the menu, against a ${TARGET_FOOD_COST_PERCENT}% target`}
      />

      {/* ── Headline figures ──────────────────────────────────────────────── */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Blended food cost</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {summary.blended.toFixed(1)}%
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Total cost over total menu price, across {summary.priced.length}{" "}
              priced dishes
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>On target</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {summary.onTarget}
              <span className="text-base font-normal text-muted-foreground">
                {" "}
                / {summary.priced.length}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Within {lower}–{upper}%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Needs repricing</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {summary.offTarget.length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Outside the target band in either direction
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Ingredients to review</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {summary.needsReview}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              Imported with inferred data
            </p>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link to="/products?status=PENDING" />}
            >
              Review
              <ArrowRight className="ml-1 size-3" />
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ── Off-target dishes ─────────────────────────────────────────────── */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TriangleAlert className="size-4 text-status-warning" aria-hidden="true" />
            Dishes outside the target band
          </CardTitle>
          <CardDescription>
            Suggested price is what would hit {TARGET_FOOD_COST_PERCENT}% food
            cost, rounded to the nearest{" "}
            {PRICE_ROUNDING_STEP.toLocaleString("id-ID")}. It excludes tax —
            the guest price is higher.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {summary.offTarget.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Every priced dish is within {lower}–{upper}%.
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dish</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Menu price</TableHead>
                    <TableHead className="text-right">Food cost</TableHead>
                    <TableHead className="text-right">
                      Suggested at {TARGET_FOOD_COST_PERCENT}%
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.offTarget.slice(0, SHOWN).map(({ recipe, suggested }) => (
                    <TableRow key={recipe.id}>
                      <TableCell>
                        <Link
                          to={`/recipes/${recipe.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {recipe.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {recipe.category}
                      </TableCell>
                      <TableCell className="text-right">
                        <CurrencyDisplay value={recipe.pricing.totalCog} />
                      </TableCell>
                      <TableCell className="text-right">
                        <CurrencyDisplay value={recipe.pricing.menuPrice} />
                      </TableCell>
                      <TableCell className="text-right">
                        <FoodCostIndicator value={recipe.pricing.foodCostPercent} />
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        <CurrencyDisplay value={suggested} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {summary.offTarget.length > SHOWN && (
                <p className="mt-3 text-sm text-muted-foreground">
                  Showing the {SHOWN} furthest from target, of{" "}
                  {summary.offTarget.length}.{" "}
                  <Link to="/recipes" className="underline underline-offset-4">
                    See all recipes
                  </Link>
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Catalogue ─────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          {
            title: "Products",
            value: products.length,
            description: "Ingredients in your catalogue",
            icon: Package,
            href: "/products",
          },
          {
            title: "Recipes",
            value: recipes.length,
            description:
              summary.unpriced > 0
                ? `${summary.unpriced} without a menu price`
                : "All priced",
            icon: ChefHat,
            href: "/recipes",
          },
          {
            title: "Sub Recipes",
            value: subRecipes.length,
            description: "Reusable preparations",
            icon: Layers,
            href: "/sub-recipes",
          },
        ].map((stat) => (
          <Card key={stat.title}>
            <CardHeader>
              <CardDescription className="flex items-center gap-2">
                <stat.icon className="size-4" aria-hidden="true" />
                {stat.title}
              </CardDescription>
              <CardTitle className="text-3xl tabular-nums">
                {stat.value.toLocaleString()}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-muted-foreground">
                {stat.description}
              </p>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link to={stat.href} />}
              >
                View {stat.title}
                <ArrowRight className="ml-1 size-3" aria-hidden="true" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
