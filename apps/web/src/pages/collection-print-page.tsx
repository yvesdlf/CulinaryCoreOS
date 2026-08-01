// ---------------------------------------------------------------------------
// Collection print view
// ---------------------------------------------------------------------------
// Every sheet in a collection as one document, each starting on a fresh page.
// This is the prep pack that goes on a section or into a briefing folder.
//
// A contents page first, because a stack of twenty sheets with no front page
// is a stack somebody has to leaf through, and it doubles as the record of
// what the pack contained on the day it was printed.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";
import type { Collection } from "@ccos/shared";

import { Button } from "@/components/ui/button";
import { RecipeSheet } from "@/components/recipes/recipe-sheet";
import { useRecipeStore } from "@/stores/recipe-store";
import { fetchCollections } from "@/data/repository";
import { isSupabaseConfigured } from "@/lib/supabase";
import { formatCurrency, formatPercent } from "@/lib/format";

export function CollectionPrintPage() {
  const { id } = useParams<{ id: string }>();
  const recipes = useRecipeStore((s) => s.recipes);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured || !id) {
      setLoading(false);
      return;
    }
    fetchCollections()
      .then((cs) => setCollection(cs.find((c) => c.id === id) ?? null))
      .finally(() => setLoading(false));
  }, [id]);

  const sheets = useMemo(() => {
    if (!collection) return [];
    const byId = new Map(recipes.map((r) => [r.id, r]));
    return collection.recipeIds
      .map((rid) => byId.get(rid))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
  }, [collection, recipes]);

  if (loading) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Loading...</p>;
  }

  if (!collection) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted-foreground">Collection not found.</p>
        <Link to="/collections" className="text-sm underline underline-offset-4">
          Back to collections
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mx-auto mb-6 flex max-w-3xl items-center justify-between gap-3 print:hidden">
        <Button variant="outline" nativeButton={false} render={<Link to="/collections" />}>
          <ArrowLeft className="mr-1 size-4" aria-hidden="true" />
          Back
        </Button>
        <Button onClick={() => window.print()} disabled={sheets.length === 0}>
          <Printer className="mr-1 size-4" aria-hidden="true" />
          Print {sheets.length} {sheets.length === 1 ? "sheet" : "sheets"}
        </Button>
      </div>

      {/* Contents, on its own page. */}
      <section className="mx-auto max-w-3xl break-after-page">
        <h1 className="text-3xl font-semibold">{collection.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {sheets.length} {sheets.length === 1 ? "recipe" : "recipes"} · printed{" "}
          {new Date().toLocaleDateString("id-ID")}
        </p>

        {sheets.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            This collection is empty.
          </p>
        ) : (
          <table className="mt-6 w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="py-1 font-medium">Dish</th>
                <th scope="col" className="py-1 font-medium">Category</th>
                <th scope="col" className="py-1 text-right font-medium">Menu price</th>
                <th scope="col" className="py-1 text-right font-medium">Food cost</th>
              </tr>
            </thead>
            <tbody>
              {sheets.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="py-1.5">{r.name}</td>
                  <td className="py-1.5 text-muted-foreground">{r.category}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatCurrency(r.pricing.menuPrice)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatPercent(r.pricing.foodCostPercent)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {sheets.map((r) => (
        <RecipeSheet key={r.id} recipe={r} />
      ))}

      <footer className="mx-auto mt-8 max-w-3xl border-t pt-3 text-xs text-muted-foreground">
        CulinaryCoreOS · {collection.name} · costs as at{" "}
        {new Date().toLocaleDateString("id-ID")}
      </footer>
    </div>
  );
}
