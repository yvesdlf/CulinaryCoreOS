// ---------------------------------------------------------------------------
// "What is this made of?"
// ---------------------------------------------------------------------------
// Offered as soon as a product has a name, because that is the moment somebody
// is about to leave nine nutrition fields at zero and move on.
//
// Two things it is careful about.
//
// It shows what it matched, not just what it found. "Matched Butter" beside
// the numbers is the difference between a suggestion a person can check in a
// second and a black box that silently filled in a form. A wrong match is
// obvious when it is named; it is invisible when it is not.
//
// It separates the two halves of the answer. Nutrition can be taken on its own
// — a roughly right calorie figure beats the zero that is there now. Allergens
// arrive flagged, always, and the panel says so in the same breath as it offers
// them: this is a prompt to read the label on the box, not a substitute for it.
// Under Regulation 1169/2011 that declaration is a legal statement, and nothing
// here is qualified to make one.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { Sparkles, TriangleAlert, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AllergenBadges } from "@/components/shared/allergen-badges";
import { findFoodMatches, type FoodMatch } from "@/engine/food-lookup";
import type { NutritionPer100g } from "@ccos/shared";

export function FoodLookupPanel({
  productName,
  hasNutrition,
  onApplyNutrition,
  onApplyAllergens,
  onApplyRefPercent,
}: {
  productName: string;
  /** Whether the form already has figures worth keeping. */
  hasNutrition: boolean;
  onApplyNutrition: (nutrition: NutritionPer100g) => void;
  onApplyAllergens: (allergens: string[]) => void;
  onApplyRefPercent: (percent: number) => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [applied, setApplied] = useState<string[]>([]);

  const matches = useMemo(
    () => findFoodMatches(productName, 4),
    [productName],
  );

  // Whichever the person picked, or the strongest one.
  const match: FoodMatch | undefined =
    matches.find((m) => m.food.name === chosen) ?? matches[0];

  if (matches.length === 0) return null;

  const food = match!.food;
  const confident = match!.score >= 0.7;

  function apply(what: string, fn: () => void) {
    fn();
    setApplied((a) => (a.includes(what) ? a : [...a, what]));
  }

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <h3 className="text-sm font-medium">
              This looks like {food.name}
            </h3>
            <p className="text-xs text-muted-foreground">
              Matched on “{match!.matchedOn}” · {food.group}
              {!confident && " · not a close match, check it"}
            </p>
          </div>
        </div>

        {matches.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {matches.map((m) => (
              <Button
                key={m.food.name}
                size="xs"
                variant={m.food.name === food.name ? "secondary" : "ghost"}
                onClick={() => { setChosen(m.food.name); setApplied([]); }}
              >
                {m.food.name}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {/* ── Nutrition ─────────────────────────────────────────────────── */}
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="text-xs font-medium">Nutrition per 100 g</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {food.nutrition.kcal} kcal · {food.nutrition.proteinG} g protein ·{" "}
            {food.nutrition.fatG} g fat · {food.nutrition.carbsG} g carbs
          </p>
          <Button
            size="xs"
            variant="outline"
            className="mt-2"
            disabled={applied.includes("nutrition")}
            onClick={() => apply("nutrition", () => onApplyNutrition({ ...food.nutrition }))}
          >
            {applied.includes("nutrition")
              ? <><Check aria-hidden="true" /> Filled in</>
              : hasNutrition ? "Replace the figures" : "Use these figures"}
          </Button>
          {food.refPercent != null && (
            <Button
              size="xs"
              variant="ghost"
              className="mt-2 ml-1"
              disabled={applied.includes("ref")}
              onClick={() => apply("ref", () => onApplyRefPercent(food.refPercent!))}
            >
              {applied.includes("ref")
                ? <><Check aria-hidden="true" /> Trim set</>
                : `Typical trim ${food.refPercent}%`}
            </Button>
          )}
        </div>

        {/* ── Allergens ─────────────────────────────────────────────────── */}
        <div className="rounded-lg border border-status-warning/40 bg-status-warning-soft p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-status-warning">
            <TriangleAlert aria-hidden="true" className="size-3.5" />
            Allergens — to check, not to trust
          </p>

          {food.allergens.length === 0 ? (
            <p className="mt-1 text-xs">
              Nothing inherent to {food.name}.{" "}
              <span className="text-muted-foreground">
                That is not a free-from claim — the label on the box is what
                decides, and it may say “may contain”.
              </span>
            </p>
          ) : (
            <>
              <div className="mt-2">
                <AllergenBadges allergens={food.allergens} variant="full" />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Inherent to the food. Whether this brand also carries others is
                a question only its label answers, so accepting these leaves the
                product marked unverified.
              </p>
              <Button
                size="xs"
                variant="outline"
                className="mt-2"
                disabled={applied.includes("allergens")}
                onClick={() =>
                  apply("allergens", () => onApplyAllergens([...food.allergens]))
                }
              >
                {applied.includes("allergens")
                  ? <><Check aria-hidden="true" /> Added, unverified</>
                  : "Add these to check"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
