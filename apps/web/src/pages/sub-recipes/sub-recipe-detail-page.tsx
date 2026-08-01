import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Save } from "lucide-react";
import type { IngredientLine, RecipeStatus, Preparation } from "@ccos/shared";
import { EMPTY_PREPARATION } from "@ccos/shared";
import { useCatalogueLoaded } from "@/hooks/use-catalogue-loaded";
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
import { MethodEditor } from "@/components/recipes/method-editor";
import { BatchCostPanel } from "@/components/sub-recipes/batch-cost-panel";
import { WhereUsed } from "@/components/shared/where-used";
import { NutritionPanel } from "@/components/recipes/nutrition-panel";
import { AllergenPanel } from "@/components/recipes/allergen-panel";
import { AllergenReviewNotice } from "@/components/shared/allergen-review-notice";
import { useAllergenReviews } from "@/hooks/use-allergen-reviews";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import {
  updateSubRecipeAndCascade,
  describeCascade,
} from "@/stores/cascade-actions";
import { createSubRecipe as persistSubRecipe } from "@/stores/persistence";
import {
  RECIPE_STATUSES,
  UNITS,
  DEFAULT_SUB_RECIPE_WASTE_PERCENT,
  DEFAULT_SUB_RECIPE_INFLATION_PERCENT,
  DEFAULT_TAX_PERCENT,
} from "@/lib/constants";
import {
  calculateRecipeTotalCost,
  calculateTotalCog,
  calculateSubRecipeCostPerUnit,
} from "@/engine/cost-engine";
import {
  deriveSubRecipeNutrition,
  deriveAllergens,
} from "@/engine/nutrition-engine";
import { useProductStore } from "@/stores/product-store";

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

function SubRecipeDetailForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const getById = useSubRecipeStore((s) => s.getById);
  const getProduct = useProductStore((s) => s.getById);
  const updateSubRecipe = useSubRecipeStore((s) => s.update);

  const loaded = useCatalogueLoaded();
  const existing = id ? getById(id) : undefined;

  // Redirect if id provided but not found
  useEffect(() => {
    // Only once the catalogue has actually arrived. On a fresh page load the
    // stores are empty for a moment, and redirecting then made every deep link
    // bounce to the list.
    if (id && !existing && loaded) {
      navigate("/sub-recipes", { replace: true });
    }
  }, [id, existing, loaded, navigate]);

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
  const [wastePercent, setWastePercent] = useState(
    existing?.wastePercent ?? DEFAULT_SUB_RECIPE_WASTE_PERCENT,
  );
  const [inflationPercent, setInflationPercent] = useState(
    existing?.inflationPercent ?? DEFAULT_SUB_RECIPE_INFLATION_PERCENT,
  );
  const [taxPercent, setTaxPercent] = useState(
    existing?.taxPercent ?? DEFAULT_TAX_PERCENT,
  );
  const [lines, setLines] = useState<IngredientLine[]>(
    existing?.ingredientLines ?? [],
  );

  const allergenReviews = useAllergenReviews(lines);

  const [preparation, setPreparation] = useState<Preparation>(
    existing?.preparation ?? EMPTY_PREPARATION,
  );

  const isNew = !id;

  // Lookups the nutrition/allergen derivation needs.
  const sources = { getProduct, getSubRecipe: getById };

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Sub recipe name is required");
      return;
    }

    // Stored strings go straight in — the engine parses exact decimals.
    const totalCost = calculateRecipeTotalCost(lines);
    // Cost per unit is taken on cost plus buffers — that is what a dish using
    // this preparation actually consumes.
    const costWithBuffers = calculateTotalCog(
      totalCost,
      wastePercent,
      inflationPercent,
    );
    const costPerUnit = calculateSubRecipeCostPerUnit(
      costWithBuffers,
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
      wastePercent,
      inflationPercent,
      taxPercent,
      // Derived, not carried. Reusing the previous values here meant the panel
      // showed live figures while the old ones were saved.
      nutritionPer100g: deriveSubRecipeNutrition(lines, batchYieldQty, sources),
      allergens: deriveAllergens(lines, sources),
      preparation,
      version: existing ? existing.version + 1 : 1,
    };

    if (isNew) {
      try {
        await persistSubRecipe(subRecipeData);
        toast.success("Sub recipe created");
      } catch (err) {
        toast.error("Could not create sub recipe", {
          description: err instanceof Error ? err.message : String(err),
        });
        return;
      }
    } else {
      // Cascading update: recipes using this sub recipe re-cost on save.
      const affected = updateSubRecipeAndCascade(
        id!,
        subRecipeData,
        existing?.version, // reject the save if someone else wrote first
      );
      const cascadeNote = describeCascade(affected);
      toast.success("Sub recipe updated", {
        description: cascadeNote ?? undefined,
      });
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
                <SelectTrigger className="w-full" aria-label="Category">
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
              <Label htmlFor="waste-percent">Waste %</Label>
              <Input
                id="waste-percent"
                type="number"
                min={0}
                max={100}
                step="0.5"
                value={wastePercent}
                onChange={(e) => setWastePercent(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inflation-percent">Inflation %</Label>
              <Input
                id="inflation-percent"
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
              <Label htmlFor="tax-percent">Tax %</Label>
              <Input
                id="tax-percent"
                type="number"
                min={0}
                max={100}
                step="0.5"
                value={taxPercent}
                onChange={(e) => setTaxPercent(parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>

          {/* Ingredient lines */}
          <div>
            <h2 className="mb-3 text-sm font-medium">Ingredients</h2>
            <IngredientLinesTable lines={lines} onChange={setLines} />

          {/* Below the ingredients, because that is the order a sheet reads
              and the order someone writes a recipe in. */}
          <MethodEditor value={preparation} onChange={setPreparation} />
          </div>
        </div>

        {/* Right side: batch cost and nutrition panels */}
        <div className="w-full space-y-4 lg:w-80 lg:sticky lg:top-4 lg:self-start">
          <BatchCostPanel
            lines={lines}
            batchYieldQty={batchYieldQty}
            batchYieldUnit={batchYieldUnit}
            wastePercent={wastePercent}
            inflationPercent={inflationPercent}
          />
          <NutritionPanel
            lines={lines}
            portions={1}
            per100g
            batchQty={batchYieldQty}
          />
          <AllergenPanel lines={lines} />
          <AllergenReviewNotice reviews={allergenReviews} />
          {!isNew && id && <WhereUsed entityId={id} selfId={id} />}
        </div>
      </div>
    </div>
  );
}

/**
 * Waits for the catalogue before mounting the form.
 *
 * The form seeds its fields from the stored entity in `useState` initialisers,
 * which run once. On a deep link those ran while the stores were still empty,
 * so the editor opened blank on a recipe that exists — and saving it reported
 * "name is required" over the top of real data. Remounting on `loaded` is what
 * makes those initialisers see the entity.
 */
export function SubRecipeDetailPage() {
  const loaded = useCatalogueLoaded();
  const { id } = useParams<{ id: string }>();

  if (id && !loaded) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Loading sub recipe...
      </p>
    );
  }
  return <SubRecipeDetailForm key={id ?? "new"} />;
}
