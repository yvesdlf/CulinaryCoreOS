import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Save } from "lucide-react";
import type { IngredientLine, RecipeStatus } from "@ccos/shared";
import { PageHeader } from "@/components/layout/page-header";
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
import { useRecipeStore } from "@/stores/recipe-store";
import {
  RECIPE_CATEGORIES,
  RECIPE_STATUSES,
  UNITS,
  DEFAULT_SECURITY_MARGIN,
  DEFAULT_CURRENCY,
} from "@/lib/constants";
import {
  calculateRecipeTotalCost,
  calculateCostWithMargin,
  calculatePriceExclVat,
  calculateFoodCostPercent,
  calculateContributionMargin,
} from "@/engine/cost-engine";
import { DEFAULT_VAT_RATE } from "@/lib/constants";
import { ZERO_NUTRITION } from "@/engine/nutrition-engine";

export function RecipeDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const getById = useRecipeStore((s) => s.getById);
  const createRecipe = useRecipeStore((s) => s.create);
  const updateRecipe = useRecipeStore((s) => s.update);

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
  const [priceInclVat, setPriceInclVat] = useState(
    existing ? parseFloat(existing.pricing.priceInclVat) : 0,
  );
  const [lines, setLines] = useState<IngredientLine[]>(
    existing?.ingredientLines ?? [],
  );

  const isNew = !id;

  function handleSave() {
    if (!name.trim()) {
      toast.error("Recipe name is required");
      return;
    }

    const lineCosts = lines.map((l) => ({ lineCost: parseFloat(l.lineCost) }));
    const totalCost = calculateRecipeTotalCost(lineCosts);
    const totalCostWithMargin = calculateCostWithMargin(
      totalCost,
      DEFAULT_SECURITY_MARGIN,
    );
    const priceExclVat = calculatePriceExclVat(priceInclVat, DEFAULT_VAT_RATE);
    const foodCostPercent = calculateFoodCostPercent(
      totalCostWithMargin,
      priceExclVat,
    );
    const contributionMargin = calculateContributionMargin(
      priceExclVat,
      totalCostWithMargin,
    );

    const recipeData = {
      name: name.trim(),
      category,
      status,
      ingredientLines: lines,
      portion: { yieldQty, yieldUnit },
      pricing: {
        priceInclVat: priceInclVat.toFixed(2),
        priceExclVat: priceExclVat.toFixed(2),
        totalCost: totalCost.toFixed(2),
        totalCostWithSecurityMargin: totalCostWithMargin.toFixed(2),
        grossContributionMargin: contributionMargin.toFixed(2),
        foodCostPercent: parseFloat(foodCostPercent.toFixed(1)),
        currency: DEFAULT_CURRENCY,
      },
      nutritionPerPortion: existing?.nutritionPerPortion ?? { ...ZERO_NUTRITION },
      allergens: existing?.allergens ?? [],
      dietaryFlags: existing?.dietaryFlags ?? {
        glutenFree: false,
        dairyFree: false,
        vegetarian: false,
        vegan: false,
        nutsFree: false,
        soyFree: false,
        sulfitesFree: false,
      },
      version: existing ? existing.version + 1 : 1,
    };

    if (isNew) {
      createRecipe(recipeData);
      toast.success("Recipe created");
    } else {
      updateRecipe(id!, recipeData);
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
        <Button onClick={handleSave}>
          <Save className="mr-1 size-4" />
          Save
        </Button>
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
                <SelectTrigger className="w-full">
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
                <SelectTrigger className="w-full">
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
                  <SelectTrigger className="w-full">
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
              <Label htmlFor="price-incl-vat">Price (incl. VAT)</Label>
              <Input
                id="price-incl-vat"
                type="number"
                min={0}
                step="0.01"
                value={priceInclVat || ""}
                onChange={(e) =>
                  setPriceInclVat(parseFloat(e.target.value) || 0)
                }
              />
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
            priceInclVat={priceInclVat}
            securityMarginPercent={DEFAULT_SECURITY_MARGIN}
          />
          <NutritionPanel lines={lines} portions={yieldQty} />
        </div>
      </div>
    </div>
  );
}
