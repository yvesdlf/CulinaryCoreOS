import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Save } from "lucide-react";
import type { IngredientLine, RecipeStatus } from "@ccos/shared";
import { PageHeader } from "@/components/layout/page-header";
import { PermissionGate } from "@/components/shared/permission-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { IngredientLinesTable } from "@/components/recipes/ingredient-lines-table";
import { CostSummaryPanel } from "@/components/recipes/cost-summary-panel";
import { NutritionPanel } from "@/components/recipes/nutrition-panel";
import { AllergenPanel } from "@/components/recipes/allergen-panel";
import { AllergenReviewNotice } from "@/components/shared/allergen-review-notice";
import { useAllergenReviews } from "@/hooks/use-allergen-reviews";
import { useRecipeStore } from "@/stores/recipe-store";
import {
  RECIPE_CATEGORIES,
  RECIPE_STATUSES,
  UNITS,
  DEFAULT_CURRENCY,
  DEFAULT_RECIPE_WASTE_PERCENT,
  DEFAULT_RECIPE_INFLATION_PERCENT,
  DEFAULT_TAX_PERCENT,
} from "@/lib/constants";
import {
  calculateRecipeTotalCost,
  calculatePercentAmount,
  calculateTotalCog,
  calculatePriceInclTax,
  calculateFoodCostPercent,
  calculateContributionMargin,
  calculateGrossProfitPercent,
} from "@/engine/cost-engine";
import {
  deriveRecipeNutrition,
  deriveAllergens,
  deriveDietaryFlags,
} from "@/engine/nutrition-engine";
import { formatCurrency } from "@/lib/format";
import { useProductStore } from "@/stores/product-store";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import { createRecipe, saveRecipe } from "@/stores/persistence";

export function RecipeDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const getById = useRecipeStore((s) => s.getById);
  const getProduct = useProductStore((s) => s.getById);
  const getSubRecipe = useSubRecipeStore((s) => s.getById);


  const existing = id ? getById(id) : undefined;

  // Redirect if an id was provided but recipe not found
  useEffect(() => {
    if (id && !existing) {
      navigate("/recipes", { replace: true });
    }
  }, [id, existing, navigate]);

  // Local form state
  const [name, setName] = useState(existing?.name ?? "");
  const [category, setCategory] = useState(
    existing?.category ?? RECIPE_CATEGORIES[0].value,
  );
  const [status, setStatus] = useState<RecipeStatus>(
    existing?.status ?? "NEW",
  );
  const [yieldQty, setYieldQty] = useState(existing?.portion.yieldQty ?? 1);
  const [yieldUnit, setYieldUnit] = useState(
    existing?.portion.yieldUnit ?? "por",
  );
  const [menuPrice, setMenuPrice] = useState(
    existing ? parseFloat(existing.pricing.menuPrice) : 0,
  );
  const [wastePercent, setWastePercent] = useState(
    existing?.wastePercent ?? DEFAULT_RECIPE_WASTE_PERCENT,
  );
  const [inflationPercent, setInflationPercent] = useState(
    existing?.inflationPercent ?? DEFAULT_RECIPE_INFLATION_PERCENT,
  );
  const [taxPercent, setTaxPercent] = useState(
    existing?.taxPercent ?? DEFAULT_TAX_PERCENT,
  );
  const [lines, setLines] = useState<IngredientLine[]>(
    existing?.ingredientLines ?? [],
  );

  // Recomputed as lines change rather than read from the saved recipe, so
  // adding an unverified ingredient warns immediately instead of after a save.
  const allergenReviews = useAllergenReviews(lines);

  const isNew = !id;

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Recipe name is required");
      return;
    }

    const totalCost = calculateRecipeTotalCost(lines);
    const wasteAmount = calculatePercentAmount(totalCost, wastePercent);
    const inflationAmount = calculatePercentAmount(totalCost, inflationPercent);
    const totalCog = calculateTotalCog(totalCost, wastePercent, inflationPercent);
    const priceInclTax = calculatePriceInclTax(menuPrice, taxPercent);
    const foodCostPercent = calculateFoodCostPercent(totalCog, menuPrice);
    const grossProfit = calculateContributionMargin(menuPrice, totalCog);
    const grossProfitPercent = calculateGrossProfitPercent(menuPrice, totalCog);

    // One derivation shared with the nutrition panel.
    const sources = { getProduct, getSubRecipe };
    const derivedNutrition = deriveRecipeNutrition(lines, yieldQty, sources);
    const derivedAllergens = deriveAllergens(lines, sources);

    const recipeData = {
      name: name.trim(),
      category,
      status,
      ingredientLines: lines,
      portion: { yieldQty, yieldUnit },
      pricing: {
        menuPrice: menuPrice.toFixed(2),
        priceInclTax: priceInclTax.toFixed(2),
        totalCost: totalCost.toFixed(2),
        wasteAmount: wasteAmount.toFixed(2),
        inflationAmount: inflationAmount.toFixed(2),
        totalCog: totalCog.toFixed(2),
        grossProfit: grossProfit.toFixed(2),
        grossProfitPercent: grossProfitPercent.toDecimalPlaces(1).toNumber(),
        foodCostPercent: foodCostPercent.toDecimalPlaces(1).toNumber(),
        currency: DEFAULT_CURRENCY,
      },
      wastePercent,
      inflationPercent,
      taxPercent,
      // Derived, not carried. Reusing the previous values here meant the
      // nutrition panel showed live figures while the old ones were saved.
      nutritionPerPortion: derivedNutrition,
      allergens: derivedAllergens,
      dietaryFlags: {
        ...deriveDietaryFlags(derivedAllergens),
        // Not inferable from allergens — beef carries none. Author-controlled.
        vegetarian: existing?.dietaryFlags.vegetarian ?? false,
        vegan: existing?.dietaryFlags.vegan ?? false,
      },
      version: existing ? existing.version + 1 : 1,
    };

    if (isNew) {
      try {
        await createRecipe(recipeData);
        toast.success("Recipe created");
      } catch (err) {
        toast.error("Could not create recipe", {
          description: err instanceof Error ? err.message : String(err),
        });
        return;
      }
    } else {
      saveRecipe(id!, recipeData, existing?.version);
      toast.success("Recipe updated");
    }

    navigate("/recipes");
  }

  return (
    <div>
      <PageHeader title={isNew ? "New Recipe" : name || "Edit Recipe"}>
        <Button variant="outline" nativeButton={false} render={<Link to="/recipes" />}>
          <ArrowLeft className="mr-1 size-4" />
          Back
        </Button>
        <PermissionGate>
          <Button onClick={handleSave}>
            <Save className="mr-1 size-4" />
            Save
          </Button>
        </PermissionGate>
      </PageHeader>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Left side: form and ingredient table */}
        <div className="flex-1 space-y-6 min-w-0">
          {/* Top bar fields */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="col-span-2 space-y-1">
              <Label htmlFor="recipe-name">Name</Label>
              <Input
                id="recipe-name"
                placeholder="Recipe name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v ?? "")}>
                <SelectTrigger className="w-full" aria-label="Category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECIPE_CATEGORIES.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as RecipeStatus)}
              >
                <SelectTrigger className="w-full" aria-label="Status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECIPE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="yield-qty">Yield</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  id="yield-qty"
                  type="number"
                  min={1}
                  value={yieldQty}
                  onChange={(e) =>
                    setYieldQty(parseFloat(e.target.value) || 1)
                  }
                  className="w-16"
                />
                <Select value={yieldUnit} onValueChange={(v) => setYieldUnit(v ?? "")}>
                  <SelectTrigger className="w-full" aria-label="Unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="menu-price">Menu Price (excl. tax)</Label>
              <Input
                id="menu-price"
                type="number"
                min={0}
                step="0.01"
                value={menuPrice || ""}
                onChange={(e) =>
                  setMenuPrice(parseFloat(e.target.value) || 0)
                }
              />
            </div>
          </div>

          {/*
            Costing buffers and tax, editable per recipe. They default to the
            venue's own figures — 4% inflation on cost of sales, 21% tax and
            service — but a dish costed differently can override any of them.
            Waste defaults to 0 here because the workbook takes it when costing
            a batch; setting it on both would count the same trim twice.
          */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="space-y-1">
              <Label htmlFor="recipe-waste">Waste %</Label>
              <Input
                id="recipe-waste"
                type="number"
                min={0}
                max={100}
                step="0.5"
                value={wastePercent}
                onChange={(e) => setWastePercent(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="recipe-inflation">Inflation %</Label>
              <Input
                id="recipe-inflation"
                type="number"
                min={0}
                max={100}
                step="0.5"
                value={inflationPercent}
                onChange={(e) =>
                  setInflationPercent(parseFloat(e.target.value) || 0)
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="recipe-tax">Tax &amp; service %</Label>
              <Input
                id="recipe-tax"
                type="number"
                min={0}
                max={100}
                step="0.5"
                value={taxPercent}
                onChange={(e) => setTaxPercent(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Guest price (incl. tax)</Label>
              <div className="flex h-8 items-center rounded-lg border border-input bg-muted/40 px-2.5 text-sm tabular-nums">
                {formatCurrency(menuPrice * (1 + taxPercent / 100))}
              </div>
            </div>
          </div>

          {/* Ingredient lines */}
          <div>
            <h2 className="mb-3 text-sm font-medium">Ingredients</h2>
            <IngredientLinesTable lines={lines} onChange={setLines} />
          </div>
        </div>

        {/* Right side: cost and nutrition panels */}
        <div className="w-full space-y-4 lg:w-80 lg:sticky lg:top-4 lg:self-start">
          <CostSummaryPanel
            lines={lines}
            menuPrice={menuPrice}
            wastePercent={wastePercent}
            inflationPercent={inflationPercent}
            taxPercent={taxPercent}
          />
          <NutritionPanel lines={lines} portions={yieldQty} />
          <AllergenPanel lines={lines} />
          {/* Sits directly under the allergen list, because it is a caveat on
              that list rather than a separate concern. */}
          <AllergenReviewNotice reviews={allergenReviews} />
        </div>
      </div>
    </div>
  );
}
