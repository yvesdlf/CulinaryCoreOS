import { useMemo } from "react";
import type { IngredientLine } from "@ccos/shared";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { AllergenPanelList } from "@/components/shared/allergen-badges";
import { deriveAllergens } from "@/engine/nutrition-engine";
import { useProductStore } from "@/stores/product-store";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import { TriangleAlert } from "lucide-react";

/**
 * Allergens inherited from the ingredients currently on the editor.
 *
 * Derived from the live lines rather than the saved record, so adding an
 * ingredient surfaces its allergens immediately — the same derivation the save
 * handler uses, so what is shown is what will be stored.
 */
export function AllergenPanel({ lines }: { lines: IngredientLine[] }) {
  const getProduct = useProductStore((s) => s.getById);
  const getSubRecipe = useSubRecipeStore((s) => s.getById);

  const allergens = useMemo(
    () => deriveAllergens(lines, { getProduct, getSubRecipe }),
    [lines, getProduct, getSubRecipe],
  );

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TriangleAlert className="size-4" />
          Allergens
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <AllergenPanelList allergens={allergens} />
        <p className="text-xs text-muted-foreground">
          Inherited from the ingredients and any nested sub-recipe, under the
          EU/UK 14 profile. Declarations follow the source ingredients — review
          them before publishing anything a guest will read.
        </p>
      </CardContent>
    </Card>
  );
}
