// ---------------------------------------------------------------------------
// Where used
// ---------------------------------------------------------------------------
// Before changing a preparation, you want to know what it feeds. Editing a
// sub-recipe here is not a local act: the yield, the buffers and the cost per
// unit all flow into every dish above it, and deleting one breaks them
// silently.
//
// `getDependents` already walks that graph and is already tested for cycles
// and depth. It had no UI, so the information existed and nobody could see it.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Network } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDependents } from "@/engine/cascade";
import { formatPercent } from "@/lib/format";
import { useRecipeStore } from "@/stores/recipe-store";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";

interface Props {
  /** The product or sub-recipe being inspected. */
  entityId: string;
  /** Excluded from its own dependents list. */
  selfId?: string;
}

export function WhereUsed({ entityId, selfId }: Props) {
  const recipes = useRecipeStore((s) => s.recipes);
  const subRecipes = useSubRecipeStore((s) => s.subRecipes);

  const used = useMemo(() => {
    const dependents = getDependents(entityId, { subRecipes, recipes });
    const byId = new Map(subRecipes.map((s) => [s.id, s]));
    return {
      subRecipes: dependents.subRecipeIds
        .filter((id) => id !== selfId)
        .map((id) => byId.get(id))
        .filter((s): s is NonNullable<typeof s> => Boolean(s))
        .sort((a, b) => a.name.localeCompare(b.name)),
      recipes: dependents.recipeIds
        .map((id) => recipes.find((r) => r.id === id))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [entityId, selfId, recipes, subRecipes]);

  const total = used.subRecipes.length + used.recipes.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Network className="size-4" aria-hidden="true" />
          Where this is used
        </CardTitle>
        <CardDescription>
          {total === 0
            ? "Nothing depends on this yet, so changing it affects no dish."
            : `Changing this re-costs ${total} ${total === 1 ? "item" : "items"}, including everything nested above it.`}
        </CardDescription>
      </CardHeader>

      {total > 0 && (
        <CardContent className="space-y-4">
          {used.subRecipes.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Preparations ({used.subRecipes.length})
              </h3>
              <ul className="space-y-1 text-sm">
                {used.subRecipes.map((s) => (
                  <li key={s.id}>
                    <Link
                      to={`/sub-recipes/${s.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {s.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {used.recipes.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Dishes ({used.recipes.length})
              </h3>
              <ul className="space-y-1 text-sm">
                {used.recipes.map((r) => (
                  <li key={r.id} className="flex items-baseline justify-between gap-3">
                    <Link
                      to={`/recipes/${r.id}`}
                      className="min-w-0 truncate underline-offset-4 hover:underline"
                    >
                      {r.name}
                    </Link>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatPercent(r.pricing.foodCostPercent)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
