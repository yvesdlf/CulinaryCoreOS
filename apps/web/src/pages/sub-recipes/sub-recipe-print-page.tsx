// ---------------------------------------------------------------------------
// Sub-recipe print view
// ---------------------------------------------------------------------------
// The route and the controls; the sheet itself is a component, so a prep pack
// printing twenty preparations comes out identical to one.
// ---------------------------------------------------------------------------

import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SubRecipeSheet } from "@/components/sub-recipes/sub-recipe-sheet";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import { useCatalogueLoaded } from "@/hooks/use-catalogue-loaded";

export function SubRecipePrintPage() {
  const { id } = useParams<{ id: string }>();
  const loaded = useCatalogueLoaded();
  const subRecipe = useSubRecipeStore((s) => (id ? s.getById(id) : undefined));

  // Not "not found" until the catalogue has actually arrived — otherwise a
  // deep link reports a missing preparation that exists.
  if (!loaded) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Loading preparation...
      </p>
    );
  }

  if (!subRecipe) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted-foreground">Preparation not found.</p>
        <Link to="/sub-recipes" className="text-sm underline underline-offset-4">
          Back to sub recipes
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mx-auto mb-6 flex max-w-3xl items-center justify-between gap-3 print:hidden">
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link to={`/sub-recipes/${subRecipe.id}`} />}
        >
          <ArrowLeft className="mr-1 size-4" aria-hidden="true" />
          Back to editor
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="mr-1 size-4" aria-hidden="true" />
          Print
        </Button>
      </div>

      <SubRecipeSheet subRecipe={subRecipe} />

      <footer className="mx-auto mt-8 max-w-3xl border-t pt-3 text-xs text-muted-foreground">
        CulinaryCoreOS · costs as at {new Date().toLocaleDateString("id-ID")}
      </footer>
    </div>
  );
}
