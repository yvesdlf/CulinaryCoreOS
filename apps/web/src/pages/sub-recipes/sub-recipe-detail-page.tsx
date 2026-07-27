import { useState, useEffect } from "react";
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
import { BatchCostPanel } from "@/components/sub-recipes/batch-cost-panel";
import { NutritionPanel } from "@/components/recipes/nutrition-panel";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import {
  RECIPE_STATUSES,
  UNITS,
  DEFAULT_SECURITY_MARGIN,
} from "@/lib/constants";
import {
  calculateRecipeTotalCost,
  calculateCostWithMargin,
  calculateSubRecipeCostPerUnit,
} from "@/engine/cost-engine";
import { ZERO_NUTRITION } from "@/engine/nutrition-engine";

const SUB_RECIPE_CATEGORIES = [
  "Sauce",
  "Bakery",
  "Sides",
  "Pastry",
  "Marinade",
  "Base",
  "Dressing",
  "Stock",
  "Other",
];

export function SubRecipeDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const getById = useSubRecipeStore((s) => s.getById);
  const createSubRecipe = useSubRecipeStore((s) => s.create);
  const updateSubRecipe = useSubRecipeStore((s) => s.update);

  const existing = id ? getById(id) : undefined;

  // Redirect if id provided but not found
  useEffect(() => {
    if (id && !existing) {
      navigate("/sub-recipes", { replace: true });
    }
  }, [id, existing, navigate]);

  // Local form state
  const [name, setName] = useState(existing?.name ?? "");
  const [category, setCategory] = useState(
    existing?.category ?? SUB_RECIPE_CATEGORIES[0],
  );
  const [status, setStatus] = useState<RecipeStatus>(
    existing?.status ?? "NEW",
  );
  const [batchYieldQty, setBatchYieldQty] = useState(
    existing?.batchYield.qty ?? 1000,
  );
  const [batchYieldUnit, setBatchYieldUnit] = useState(
    existing?.batchYield.unit ?? "g",
  );
  const [securityMarginPercent, setSecurityMarginPercent] = useState(
    existing?.securityMarginPercent ?? DEFAULT_SECURITY_MARGIN,
  );
  const [lines, setLines] = useState<IngredientLine[]>(
    existing?.ingredientLines ?? [],
  );

  const isNew = !id;

  function handleSave() {
    if (!name.trim()) {
      toast.error("Sub recipe name is required");
      return;
    }

    const lineCosts = lines.map((l) => ({ lineCost: parseFloat(l.lineCost) }));
    const totalCost = calculateRecipeTotalCost(lineCosts);
    const totalWithMargin = calculateCostWithMargin(
      totalCost,
      securityMarginPercent,
    );
    const costPerUnit = calculateSubRecipeCostPerUnit(
      totalCost,
      batchYieldQty,
    );

    const subRecipeData = {
      name: name.trim(),
      category,
      status,
      ingredientLines: lines,
      batchYield: { qty: batchYieldQty, unit: batchYieldUnit },
      totalCost: totalCost.toFixed(2),
      costPerUnit: costPerUnit.toFixed(5),
      securityMarginPercent,
      nutritionPer100g: existing?.nutritionPer100g ?? { ...ZERO_NUTRITION },
      allergens: existing?.allergens ?? [],
      version: existing ? existing.version + 1 : 1,
    };

    if (isNew) {
      createSubRecipe(subRecipeData);
      toast.success("Sub recipe created");
    } else {
      updateSubRecipe(id!, subRecipeData);
      toast.success("Sub recipe updated");
    }

    navigate("/sub-recipes");
  }

  return (
    <div>
      <PageHeader
        title={isNew ? "New Sub Recipe" : name || "Edit Sub Recipe"}
      >
        <Button variant="outline" nativeButton={false} render={<Link to="/sub-recipes" />}>
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
              <Label htmlFor="sub-recipe-name">Name</Label>
              <Input
                id="sub-recipe-name"
                placeholder="Sub recipe name"
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
                  {SUB_RECIPE_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
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
              <Label htmlFor="batch-yield">Batch Yield</Label>
              <div className="flex items-center gap-1.5">
                {/* Batch yields run to 4-5 digits, so w-20 would clip them. */}
                <Input
                  id="batch-yield"
                  type="number"
                  min={1}
                  value={batchYieldQty}
                  onChange={(e) =>
                    setBatchYieldQty(parseFloat(e.target.value) || 1)
                  }
                  className="w-28"
                />
                <Select value={batchYieldUnit} onValueChange={(v) => setBatchYieldUnit(v ?? "")}>
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
              <Label htmlFor="security-margin">Margin %</Label>
              <Input
                id="security-margin"
                type="number"
                min={0}
                max={100}
                step="0.5"
                value={securityMarginPercent}
                onChange={(e) =>
                  setSecurityMarginPercent(parseFloat(e.target.value) || 0)
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

        {/* Right side: batch cost and nutrition panels */}
        <div className="w-full space-y-4 lg:w-80 lg:sticky lg:top-4 lg:self-start">
          <BatchCostPanel
            lines={lines}
            batchYieldQty={batchYieldQty}
            batchYieldUnit={batchYieldUnit}
            securityMarginPercent={securityMarginPercent}
          />
          <NutritionPanel
            lines={lines}
            portions={1}
            per100g
            batchQty={batchYieldQty}
          />
        </div>
      </div>
    </div>
  );
}
