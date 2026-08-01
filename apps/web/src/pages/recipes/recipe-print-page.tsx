// ---------------------------------------------------------------------------
// Recipe viewer / print view — DOC4 §11.3
// ---------------------------------------------------------------------------
// The route and the controls. The sheet itself is a component, shared with the
// collection printer so twenty of them come out identical to one.
// ---------------------------------------------------------------------------

import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RecipeSheet } from "@/components/recipes/recipe-sheet";
import { useRecipeStore } from "@/stores/recipe-store";

export function RecipePrintPage() {
  const { id } = useParams<{ id: string }>();
  const recipe = useRecipeStore((s) => (id ? s.getById(id) : undefined));

  if (!recipe) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted-foreground">Recipe not found.</p>
        <Link to="/recipes" className="text-sm underline underline-offset-4">
          Back to recipes
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Not printed: the controls that put it on paper. */}
      <div className="mx-auto mb-6 flex max-w-3xl items-center justify-between gap-3 print:hidden">
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link to={`/recipes/${recipe.id}`} />}
        >
          <ArrowLeft className="mr-1 size-4" aria-hidden="true" />
          Back to editor
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="mr-1 size-4" aria-hidden="true" />
          Print
        </Button>
      </div>

      <RecipeSheet recipe={recipe} />

      <footer className="mx-auto mt-8 max-w-3xl border-t pt-3 text-xs text-muted-foreground">
        {/* Printed sheets outlive the prices on them, so the sheet says when it
            was true rather than leaving someone to guess. */}
        CulinaryCoreOS · costs as at {new Date().toLocaleDateString("id-ID")}
      </footer>
    </div>
  );
}
