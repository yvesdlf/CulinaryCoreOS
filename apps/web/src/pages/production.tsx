// ---------------------------------------------------------------------------
// Production planning — SRS 4.11, PRO-FUNC-001
// ---------------------------------------------------------------------------
// A chef types expected covers per dish; the page answers with what to make
// and what to pull. Those are two sheets for two people — the prep cook works
// the first, whoever opens the store works the second — so they print apart.
//
// The plan is recomputed as you type rather than behind a "Calculate" button.
// Covers are a guess being adjusted, and seeing the shortfall move while you
// adjust it is the whole point.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { Factory, Printer, Search, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProductStore } from "@/stores/product-store";
import { useRecipeStore } from "@/stores/recipe-store";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import { planProduction } from "@/engine/production";
import { fetchStockLevels } from "@/data/repository";
import { isSupabaseConfigured } from "@/lib/supabase";

/** Covers survive a reload — a service plan is not worth retyping. */
const STORAGE_KEY = "ccos-production-covers";

function loadCovers(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function ProductionPage() {
  const products = useProductStore((s) => s.products);
  const recipes = useRecipeStore((s) => s.recipes);
  const subRecipes = useSubRecipeStore((s) => s.subRecipes);

  const [covers, setCovers] = useState<Record<string, number>>(loadCovers);
  const [query, setQuery] = useState("");
  const [levels, setLevels] = useState<Map<string, { onHand: number }>>(new Map());

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    fetchStockLevels()
      .then(setLevels)
      .catch((err) =>
        toast.error("Could not read stock levels", {
          description:
            err instanceof Error
              ? `${err.message}. The pull list will show what is needed, but not what is missing.`
              : String(err),
        }),
      );
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(covers));
    } catch {
      // A full or blocked store is not worth interrupting the plan for.
    }
  }, [covers]);

  const planned = useMemo(
    () =>
      Object.entries(covers)
        .filter(([, n]) => n > 0)
        .map(([recipeId, n]) => ({ recipeId, covers: n })),
    [covers],
  );

  const plan = useMemo(
    () => planProduction(planned, { products, subRecipes, recipes }, levels),
    [planned, products, subRecipes, recipes, levels],
  );

  const plannedRecipes = useMemo(
    () =>
      planned
        .map((p) => recipes.find((r) => r.id === p.recipeId))
        .filter((r): r is NonNullable<typeof r> => Boolean(r)),
    [planned, recipes],
  );

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return recipes
      .filter((r) => r.name.toLowerCase().includes(q) && !covers[r.id])
      .slice(0, 8);
  }, [query, recipes, covers]);

  const totalCovers = planned.reduce((n, p) => n + p.covers, 0);

  function setCover(id: string, value: number) {
    setCovers((c) => ({ ...c, [id]: value }));
  }

  function removeDish(id: string) {
    setCovers((c) => {
      const next = { ...c };
      delete next[id];
      return next;
    });
  }

  return (
    <div>
      <PageHeader
        title="Production"
        description="Expected covers in, prep list and pull list out. Preparations are made in whole batches, so the pull list covers the batches, not the exact need."
      >
        <Button
          variant="outline"
          onClick={() => window.print()}
          disabled={plan.prep.length === 0 && plan.pull.length === 0}
        >
          <Printer />
          Print
        </Button>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="text-base">Expected covers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Add a dish"
                aria-label="Add a dish to the plan"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            {searchResults.length > 0 && (
              <ul className="rounded-md border">
                {searchResults.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        setCover(r.id, 10);
                        setQuery("");
                      }}
                    >
                      {r.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {plannedRecipes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Search for a dish to start the plan.
              </p>
            ) : (
              <ul className="space-y-2">
                {plannedRecipes.map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    <span className="flex-1 truncate text-sm">{r.name}</span>
                    <Input
                      type="number"
                      min="0"
                      className="w-20 text-right"
                      aria-label={`Covers for ${r.name}`}
                      value={covers[r.id] ?? ""}
                      onChange={(e) => setCover(r.id, Number(e.target.value) || 0)}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeDish(r.id)}
                      aria-label={`Remove ${r.name} from the plan`}
                    >
                      <X className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {totalCovers > 0 && (
              <p className="border-t pt-3 text-sm text-muted-foreground">
                {totalCovers} covers across {plannedRecipes.length} dish
                {plannedRecipes.length === 1 ? "" : "es"}
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {plan.problems.length > 0 && (
            <div className="rounded-lg border border-status-warning bg-status-warning-soft p-4">
              <div className="flex items-center gap-2 font-medium text-status-warning">
                <TriangleAlert className="size-4" />
                The plan is incomplete
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {[...new Set(plan.problems)].map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}

          {totalCovers === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nothing planned yet.
            </p>
          ) : (
            <Tabs defaultValue="prep">
              <TabsList className="print:hidden">
                <TabsTrigger value="prep">
                  <Factory className="size-4" />
                  Prep list ({plan.prep.length})
                </TabsTrigger>
                <TabsTrigger value="pull">Pull list ({plan.pull.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="prep" className="mt-4">
                <PrepList plan={plan} />
              </TabsContent>

              <TabsContent value="pull" className="mt-4">
                <PullList plan={plan} />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}

function PrepList({ plan }: { plan: ReturnType<typeof planProduction> }) {
  if (plan.prep.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        None of these dishes need a preparation made.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground print:hidden">
        In order: anything a later preparation is built on comes first.
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <TableHead>Preparation</TableHead>
              <TableHead className="text-right">Needed</TableHead>
              <TableHead className="text-right">Batches</TableHead>
              <TableHead className="text-right">Making</TableHead>
              <TableHead>For</TableHead>
              <TableHead className="w-16 text-center print:table-cell">Done</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plan.prep.map((task, i) => (
              <TableRow key={task.subRecipe.id}>
                <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                <TableCell>
                  <div className="font-medium">{task.subRecipe.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {task.batchYield} {task.unit} per batch
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {task.quantityNeeded} {task.unit}
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {task.batches || "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {task.quantityMade} {task.unit}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {task.drivenBy.join(", ")}
                </TableCell>
                <TableCell className="text-center">
                  {/* A box to tick on the printed sheet — PRO-FUNC-001 AC6. */}
                  <span className="inline-block size-4 rounded border" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function PullList({ plan }: { plan: ReturnType<typeof planProduction> }) {
  const short = plan.pull.filter((l) => l.shortfall > 0);

  if (plan.pull.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Nothing to pull.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span className="text-muted-foreground">
          {plan.pull.length} ingredients,{" "}
          <span className="font-medium text-foreground">
            <CurrencyDisplay value={plan.totalCost} />
          </span>{" "}
          at current prices
        </span>
        {short.length > 0 && (
          <span className="font-medium text-status-warning">
            {short.length} short of what is on the shelf
          </span>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ingredient</TableHead>
              <TableHead className="text-right">Needed</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Short by</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plan.pull.map((l) => (
              <TableRow key={l.product.id}>
                <TableCell>
                  <div className="font-medium">{l.product.name}</div>
                  {l.product.supplier && (
                    <div className="text-xs text-muted-foreground">
                      {l.product.supplier}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {l.grossQty} {l.unit}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {l.onHand || "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {l.shortfall > 0 ? (
                    <span className="text-status-warning">
                      {l.shortfall} {l.unit}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <CurrencyDisplay value={l.estimatedCost} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
