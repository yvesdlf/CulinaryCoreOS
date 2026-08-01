// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------
// Two rows for one ingredient means two prices to keep current, and whichever
// a recipe happens to point at is the one it costs from. This finds them and
// offers to merge, which is repointing every line onto one row and removing
// the others.
//
// Nothing merges without a click, and each group states why it was grouped.
// The grades matter: "identical" is safe, "review" usually is not — two rows
// with the same name and different prices are more often two pack sizes than
// one mistake, and merging those destroys a real distinction.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Merge, TriangleAlert, Check } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { PermissionGate } from "@/components/shared/permission-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { useProductStore } from "@/stores/product-store";
import { useRecipeStore } from "@/stores/recipe-store";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import {
  findDuplicateProducts,
  findDuplicateSuppliers,
  type Confidence,
} from "@/engine/duplicates";
import { mergeProducts, mergeSupplierNames } from "@/data/repository";
import { isSupabaseConfigured } from "@/lib/supabase";

const GRADE: Record<Confidence, { label: string; className: string }> = {
  identical: {
    label: "Same price and supplier",
    className: "bg-status-success-soft text-status-success",
  },
  likely: {
    label: "Same price",
    className: "bg-status-info-soft text-status-info",
  },
  review: {
    label: "Needs a decision",
    className: "bg-status-warning-soft text-status-warning",
  },
};

export function DuplicatesPage() {
  const products = useProductStore((s) => s.products);
  const recipes = useRecipeStore((s) => s.recipes);
  const subRecipes = useSubRecipeStore((s) => s.subRecipes);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  /*
   * How many lines point at each product. The row recipes already use is the
   * one worth keeping — merging into the other means rewriting more lines for
   * no gain.
   */
  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    const bump = (id: string | null) => {
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    };
    for (const r of recipes) for (const l of r.ingredientLines) bump(l.productId);
    for (const s of subRecipes) for (const l of s.ingredientLines) bump(l.productId);
    return counts;
  }, [recipes, subRecipes]);

  const productGroups = useMemo(
    () => findDuplicateProducts(products, usage).filter((g) => !done.has(g.key)),
    [products, usage, done],
  );
  const supplierGroups = useMemo(
    () => findDuplicateSuppliers(products).filter((d) => !done.has(`sup:${d.key}`)),
    [products, done],
  );

  async function doMergeProducts(
    key: string,
    survivorId: string,
    loserIds: string[],
  ) {
    setBusy(key);
    try {
      const out = await mergeProducts(survivorId, loserIds);
      toast.success(`Merged ${out.removed + 1} rows into one`, {
        description: `${out.recipeLines + out.subRecipeLines} ingredient lines repointed. Reload to see the catalogue update.`,
      });
      setDone((d) => new Set(d).add(key));
    } catch (err) {
      toast.error("Merge failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  }

  async function doMergeSuppliers(key: string, survivor: string, losers: string[]) {
    setBusy(`sup:${key}`);
    try {
      const n = await mergeSupplierNames(survivor, losers);
      toast.success(`Standardised on "${survivor}"`, {
        description: `${n} ingredients updated. Reload to see the change.`,
      });
      setDone((d) => new Set(d).add(`sup:${key}`));
    } catch (err) {
      toast.error("Merge failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  }

  const total = productGroups.length + supplierGroups.length;

  return (
    <div>
      <PageHeader
        title="Duplicates"
        description="Ingredients and suppliers that look like the same thing recorded twice"
      />

      {!isSupabaseConfigured && (
        <p className="mb-4 rounded-lg border border-status-warning/40 bg-status-warning-soft p-3 text-sm text-foreground/80">
          Running on the mock catalogue, so merging is unavailable — there is
          nothing to write to.
        </p>
      )}

      {total === 0 ? (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed">
          <Check className="size-5 text-status-success" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            Nothing looks duplicated.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {productGroups.length > 0 && (
            <section aria-labelledby="dup-ingredients">
              <h2 id="dup-ingredients" className="mb-3 text-sm font-medium">
                Ingredients ({productGroups.length})
              </h2>
              <div className="space-y-3">
                {productGroups.map((g) => {
                  const losers = g.members.filter((m) => m.id !== g.suggestedSurvivor.id);
                  const grade = GRADE[g.confidence];
                  return (
                    <Card key={g.key}>
                      <CardHeader>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <CardTitle className="text-base">
                              {g.members.map((m) => m.name).join("  ·  ")}
                            </CardTitle>
                            <CardDescription className="mt-1 flex flex-wrap items-center gap-2">
                              <span
                                className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${grade.className}`}
                              >
                                {grade.label}
                              </span>
                              <span>{g.reason}</span>
                            </CardDescription>
                          </div>
                          <PermissionGate fallbackLabel="View only">
                            <Button
                              size="sm"
                              variant={g.confidence === "review" ? "outline" : "default"}
                              disabled={busy !== null || !isSupabaseConfigured}
                              onClick={() =>
                                void doMergeProducts(
                                  g.key,
                                  g.suggestedSurvivor.id,
                                  losers.map((l) => l.id),
                                )
                              }
                            >
                              <Merge className="mr-1 size-4" aria-hidden="true" />
                              {busy === g.key
                                ? "Merging..."
                                : `Keep "${g.suggestedSurvivor.name}"`}
                            </Button>
                          </PermissionGate>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-1 text-sm">
                          {g.members.map((m) => {
                            const keeping = m.id === g.suggestedSurvivor.id;
                            return (
                              <li
                                key={m.id}
                                className="flex flex-wrap items-baseline justify-between gap-2"
                              >
                                <span className="flex items-baseline gap-2">
                                  <Link
                                    to={`/products/${m.id}`}
                                    className="font-medium underline-offset-4 hover:underline"
                                  >
                                    {m.name}
                                  </Link>
                                  {/* Stated in words, not by colour alone. */}
                                  <span className="text-xs text-muted-foreground">
                                    {keeping ? "keep" : "merge away"}
                                  </span>
                                </span>
                                <span className="flex items-baseline gap-3 text-xs text-muted-foreground">
                                  <span>{m.supplier ?? "no supplier"}</span>
                                  <span>{usage.get(m.id) ?? 0} lines</span>
                                  <CurrencyDisplay
                                    value={m.cost.grossPricePerUnit}
                                    decimals={2}
                                  />
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}

          {supplierGroups.length > 0 && (
            <section aria-labelledby="dup-suppliers">
              <h2 id="dup-suppliers" className="mb-3 text-sm font-medium">
                Suppliers ({supplierGroups.length})
              </h2>
              <div className="space-y-3">
                {supplierGroups.map((d) => (
                  <Card key={d.key}>
                    <CardHeader>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-base">
                            {d.spellings.map((s) => s.name).join("  ·  ")}
                          </CardTitle>
                          <CardDescription className="mt-1">
                            Same name, different capitalisation — counted as
                            separate suppliers everywhere.
                          </CardDescription>
                        </div>
                        <PermissionGate fallbackLabel="View only">
                          <Button
                            size="sm"
                            disabled={busy !== null || !isSupabaseConfigured}
                            onClick={() =>
                              void doMergeSuppliers(
                                d.key,
                                d.suggestedSurvivor,
                                d.spellings
                                  .map((s) => s.name)
                                  .filter((n) => n !== d.suggestedSurvivor),
                              )
                            }
                          >
                            <Merge className="mr-1 size-4" aria-hidden="true" />
                            {busy === `sup:${d.key}`
                              ? "Merging..."
                              : `Use "${d.suggestedSurvivor}"`}
                          </Button>
                        </PermissionGate>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1 text-sm">
                        {d.spellings.map((s) => (
                          <li
                            key={s.name}
                            className="flex items-baseline justify-between gap-2"
                          >
                            <span>{s.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {s.items} ingredients
                            </span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {productGroups.some((g) => g.confidence === "review") && (
        <p className="mt-6 flex items-start gap-2 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Groups marked "needs a decision" differ in price or unit. Those are
          more often two pack sizes than one mistake — merging them keeps one
          price and discards the other.
        </p>
      )}
    </div>
  );
}
