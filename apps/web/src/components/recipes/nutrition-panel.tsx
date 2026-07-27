import { useMemo } from "react";
import type { IngredientLine } from "@ccos/shared";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useProductStore } from "@/stores/product-store";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import {
  calculateLineNutrition,
  sumNutrition,
  calculatePerPortionNutrition,
  ZERO_NUTRITION,
} from "@/engine/nutrition-engine";
import type { NutritionPer100g } from "@/engine/nutrition-engine";
import { formatNumber } from "@/lib/format";
import { ChefHat } from "lucide-react";

interface NutritionPanelProps {
  lines: IngredientLine[];
  portions: number;
  /** If true, show "per 100g" instead of "per portion" — requires `batchQty`. */
  per100g?: boolean;
  /** Batch yield quantity (grams) — the basis for the per-100g calculation. */
  batchQty?: number;
}

export function NutritionPanel({
  lines,
  portions,
  per100g = false,
  batchQty,
}: NutritionPanelProps) {
  const getProduct = useProductStore((s) => s.getById);
  const getSubRecipe = useSubRecipeStore((s) => s.getById);

  const nutrition = useMemo(() => {
    const lineNutritions: NutritionPer100g[] = lines.map((line) => {
      let nutritionPer100g: NutritionPer100g = { ...ZERO_NUTRITION };

      if (line.productId) {
        const product = getProduct(line.productId);
        if (product?.nutrition) {
          nutritionPer100g = product.nutrition;
        }
      } else if (line.subRecipeId) {
        const subRecipe = getSubRecipe(line.subRecipeId);
        if (subRecipe?.nutritionPer100g) {
          nutritionPer100g = subRecipe.nutritionPer100g;
        }
      }

      return calculateLineNutrition(line.nettQty, nutritionPer100g);
    });

    const total = sumNutrition(lineNutritions);

    if (per100g) {
      // `total` is the nutrition of the whole batch. Scaling it to a 100 g
      // basis means dividing by however many 100 g units the batch yields.
      const hundredGramUnits = (batchQty ?? 0) / 100;
      return hundredGramUnits > 0
        ? calculatePerPortionNutrition(total, hundredGramUnits)
        : { ...ZERO_NUTRITION };
    }

    return portions > 0
      ? calculatePerPortionNutrition(total, portions)
      : total;
  }, [lines, portions, per100g, batchQty, getProduct, getSubRecipe]);

  const totalMacroG = nutrition.fatG + nutrition.carbsG + nutrition.proteinG;
  const fatPct = totalMacroG > 0 ? (nutrition.fatG / totalMacroG) * 100 : 0;
  const carbsPct =
    totalMacroG > 0 ? (nutrition.carbsG / totalMacroG) * 100 : 0;
  const proteinPct =
    totalMacroG > 0 ? (nutrition.proteinG / totalMacroG) * 100 : 0;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ChefHat className="size-4" />
          Nutrition {per100g ? "(per 100g)" : "(per portion)"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Calories highlight */}
        <div className="rounded-lg bg-muted/50 px-3 py-2 text-center">
          <div className="text-2xl font-bold tabular-nums">
            {Math.round(nutrition.kcal)}
          </div>
          <div className="text-xs text-muted-foreground">kcal</div>
        </div>

        {/* Macro bar */}
        <div className="space-y-1.5">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full">
            <div
              className="bg-amber-500 transition-all"
              style={{ width: `${fatPct}%` }}
            />
            <div
              className="bg-blue-500 transition-all"
              style={{ width: `${carbsPct}%` }}
            />
            <div
              className="bg-emerald-500 transition-all"
              style={{ width: `${proteinPct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block size-2 rounded-full bg-amber-500" />
              Fat
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block size-2 rounded-full bg-blue-500" />
              Carbs
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block size-2 rounded-full bg-emerald-500" />
              Protein
            </span>
          </div>
        </div>

        {/* Macros grid */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <MacroCell label="Fat" value={nutrition.fatG} unit="g" />
          <MacroCell label="Carbs" value={nutrition.carbsG} unit="g" />
          <MacroCell label="Protein" value={nutrition.proteinG} unit="g" />
        </div>

        {/* Micronutrients */}
        <div className="space-y-1 pt-1">
          <div className="text-xs font-medium text-muted-foreground">
            Vitamins & Minerals
          </div>
          <MicroRow label="Vitamin A" value={nutrition.vitAMg} unit="mg" />
          <MicroRow label="Vitamin C" value={nutrition.vitCMg} unit="mg" />
          <MicroRow label="Calcium" value={nutrition.calciumMg} unit="mg" />
          <MicroRow label="Iron" value={nutrition.ironMg} unit="mg" />
          <MicroRow label="Sodium" value={nutrition.sodiumMg} unit="mg" />
        </div>
      </CardContent>
    </Card>
  );
}

function MacroCell({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit: string;
}) {
  return (
    <div className="rounded-md bg-muted/30 px-2 py-1.5">
      <div className="text-sm font-semibold tabular-nums">
        {formatNumber(value, 1)}
        <span className="text-xs font-normal text-muted-foreground">
          {unit}
        </span>
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function MicroRow({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit: string;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">
        {formatNumber(value, 2)} {unit}
      </span>
    </div>
  );
}
