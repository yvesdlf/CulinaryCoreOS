import { EMPTY_PREPARATION } from "@ccos/shared";
// ---------------------------------------------------------------------------
// Recipe import
// ---------------------------------------------------------------------------
// Same two-step shape as the price import: choose a file, read what it would
// do, then decide. Creating twenty dishes from a file nobody checked is the
// same class of mistake as rewriting a thousand prices from one.
//
// The preview leads with the cost, because that is the number that reveals a
// misread file: a dish costing a hundredth of what it should means the
// quantities were read in the wrong unit, and it is obvious at a glance and
// invisible in a success message.
// ---------------------------------------------------------------------------

import { useRef, useState } from "react";
import { Upload, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

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
import { parseCsv } from "@/lib/csv";
import { planRecipeImport, type RecipeImportPlan } from "@/engine/recipe-import";
import { useProductStore } from "@/stores/product-store";
import { useRecipeStore } from "@/stores/recipe-store";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import { createRecipe, saveRecipe } from "@/stores/persistence";
import {
  calculatePercentAmount,
  calculateTotalCog,
  calculatePriceInclTax,
  calculateFoodCostPercent,
  calculateContributionMargin,
  calculateGrossProfitPercent,
  toDecimal,
} from "@/engine/cost-engine";
import {
  DEFAULT_CURRENCY,
  DEFAULT_RECIPE_WASTE_PERCENT,
  DEFAULT_RECIPE_INFLATION_PERCENT,
  DEFAULT_TAX_PERCENT,
} from "@/lib/constants";

const PREVIEW_ROWS = 15;

export function RecipeImportDialog() {
  const products = useProductStore((s) => s.products);
  const subRecipes = useSubRecipeStore((s) => s.subRecipes);
  const recipes = useRecipeStore((s) => s.recipes);
  const fileInput = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<RecipeImportPlan | null>(null);
  const [filename, setFilename] = useState("");
  const [applying, setApplying] = useState(false);

  async function handleFile(file: File) {
    const text = await file.text();
    setFilename(file.name);
    setPlan(planRecipeImport(parseCsv(text), { products, subRecipes, recipes }));
  }

  function reset() {
    setPlan(null);
    setFilename("");
    if (fileInput.current) fileInput.current.value = "";
  }

  async function apply() {
    if (!plan) return;
    setApplying(true);
    let created = 0;
    let updated = 0;
    try {
      for (const dish of plan.recipes) {
        const menuPrice = toDecimal(dish.menuPrice ?? 0);
        const totalCost = toDecimal(dish.totalCost);
        const waste = DEFAULT_RECIPE_WASTE_PERCENT;
        const inflation = DEFAULT_RECIPE_INFLATION_PERCENT;
        const tax = DEFAULT_TAX_PERCENT;
        const totalCog = calculateTotalCog(totalCost, waste, inflation);

        const data = {
          name: dish.name,
          category: dish.category ?? "Uncategorised",
          // NEW, not ACTUAL: an imported dish has not been cooked or approved
          // here, and marking it live would put it on a menu unreviewed.
          status: "NEW" as const,
          ingredientLines: dish.lines.map((l, i) => ({
            id: `import-${dish.name}-${i}`,
            lineNumber: i + 1,
            productId: l.productId,
            subRecipeId: l.subRecipeId,
            nettQty: l.qty,
            nettUnit: l.unit,
            refPercent: l.refPercent,
            grossQty: l.grossQty,
            grossUnit: l.unit,
            costPerUnit: l.costPerUnit,
            lineCost: l.lineCost,
          })),
          portion: { yieldQty: 1, yieldUnit: "por" },
          pricing: {
            menuPrice: menuPrice.toFixed(2),
            priceInclTax: calculatePriceInclTax(menuPrice, tax).toFixed(2),
            totalCost: totalCost.toFixed(2),
            wasteAmount: calculatePercentAmount(totalCost, waste).toFixed(2),
            inflationAmount: calculatePercentAmount(totalCost, inflation).toFixed(2),
            totalCog: totalCog.toFixed(2),
            grossProfit: calculateContributionMargin(menuPrice, totalCog).toFixed(2),
            grossProfitPercent: calculateGrossProfitPercent(menuPrice, totalCog)
              .toDecimalPlaces(1)
              .toNumber(),
            foodCostPercent: calculateFoodCostPercent(totalCog, menuPrice)
              .toDecimalPlaces(1)
              .toNumber(),
            currency: DEFAULT_CURRENCY,
          },
          wastePercent: waste,
          inflationPercent: inflation,
          taxPercent: tax,
          nutritionPerPortion: {
            fatG: 0, carbsG: 0, proteinG: 0, vitAMg: 0, vitCMg: 0,
            calciumMg: 0, ironMg: 0, sodiumMg: 0, kcal: 0,
          },
          // Left empty on purpose: the cascade derives these from the lines,
          // and a guess written here would be overwritten by the truth anyway.
          allergens: [],
          preparation: EMPTY_PREPARATION,
          dietaryFlags: {
            glutenFree: false, dairyFree: false, vegetarian: false,
            vegan: false, nutsFree: false, soyFree: false, sulfitesFree: false,
          },
          version: 1,
        };

        if (dish.existingId) {
          saveRecipe(dish.existingId, data);
          updated++;
        } else {
          await createRecipe(data);
          created++;
        }
      }

      toast.success(
        `${created} created, ${updated} updated`,
        { description: "Imported dishes are marked NEW until someone approves them." },
      );
      reset();
    } catch (err) {
      toast.error("Import failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setApplying(false);
    }
  }

  return (
    <div>
      <input
        ref={fileInput}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        aria-label="Recipe sheet (CSV)"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />

      <Button variant="outline" onClick={() => fileInput.current?.click()}>
        <Upload className="mr-1 size-4" aria-hidden="true" />
        Import recipes
      </Button>

      {plan && (
        <div className="mt-4 rounded-lg border p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">
                {filename} — nothing has been created yet
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {plan.columns && (
                  <>
                    Read <strong>{plan.columns.dish}</strong> as the dish and{" "}
                    <strong>{plan.columns.ingredient}</strong> as the
                    ingredient.{" "}
                  </>
                )}
                {plan.recipes.length} dishes ·{" "}
                {plan.recipes.reduce((n, r) => n + r.lines.length, 0)} lines ·{" "}
                {plan.problems.length} not imported
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={reset}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void apply()}
                disabled={plan.recipes.length === 0 || applying}
              >
                Import {plan.recipes.length}{" "}
                {plan.recipes.length === 1 ? "dish" : "dishes"}
              </Button>
            </div>
          </div>

          {plan.problems.length > 0 && (
            <div
              role="alert"
              className="mb-3 rounded-md border border-status-warning/40 bg-status-warning-soft p-3"
            >
              <p className="flex items-center gap-2 text-sm font-medium text-status-warning">
                <TriangleAlert className="size-4" aria-hidden="true" />
                {plan.problems.length}{" "}
                {plan.problems.length === 1 ? "row" : "rows"} will not be imported
              </p>
              <ul className="mt-2 space-y-1 text-xs text-foreground/80">
                {plan.problems.slice(0, 8).map((p, i) => (
                  <li key={`${p.line}-${i}`}>
                    {p.line > 0 && <>Line {p.line} · </>}
                    {p.recipe && <>{p.recipe} — </>}
                    {p.reason}
                  </li>
                ))}
              </ul>
              {plan.problems.length > 8 && (
                <p className="mt-1 text-xs text-foreground/80">
                  and {plan.problems.length - 8} more
                </p>
              )}
            </div>
          )}

          {plan.recipes.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dish</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="text-right">Ingredient cost</TableHead>
                  <TableHead className="text-right">Menu price</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.recipes.slice(0, PREVIEW_ROWS).map((r) => (
                  <TableRow key={r.name}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.category ?? "--"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.lines.length}
                    </TableCell>
                    <TableCell className="text-right">
                      <CurrencyDisplay value={r.totalCost} />
                    </TableCell>
                    <TableCell className="text-right">
                      {r.menuPrice ? (
                        <CurrencyDisplay value={String(r.menuPrice)} />
                      ) : (
                        <span className="text-muted-foreground">not set</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.existingId ? "update existing" : "create"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {plan.recipes.length > PREVIEW_ROWS && (
            <p className="mt-2 text-xs text-muted-foreground">
              Showing {PREVIEW_ROWS} of {plan.recipes.length}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
