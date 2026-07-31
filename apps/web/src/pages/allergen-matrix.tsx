// ---------------------------------------------------------------------------
// Allergen matrix
// ---------------------------------------------------------------------------
// The dish-by-allergen grid a venue has to be able to produce: every menu item
// down the side, the regulated fourteen across the top, and a mark where they
// meet. This is the artifact that gets printed and pinned up, and the one a
// server reaches for when a guest asks.
//
// Two rules from the Platform Standards Manual, Appendix G, shape it:
//
//   * A code never replaces the written name. The column headers carry codes
//     because a fourteen-column grid has no room for "Cereals containing
//     gluten", so every header states its full name to assistive technology
//     and the page prints a key underneath.
//   * A cell is not blank because we checked and found nothing. It is blank
//     because nothing was declared, which is a different claim. Dishes
//     depending on an unverified ingredient are marked as such rather than
//     being allowed to read as safe.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Printer, Download, TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { useRecipeStore } from "@/stores/recipe-store";
import { useProductStore } from "@/stores/product-store";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import { findUnverifiedAllergens } from "@/engine/allergen-review";
import { EU14_ALLERGENS, resolveAllergens } from "@/lib/allergens";
import { toCsv, downloadCsv, datedFilename } from "@/lib/csv";

export function AllergenMatrixPage() {
  const recipes = useRecipeStore((s) => s.recipes);
  const products = useProductStore((s) => s.products);
  const subRecipes = useSubRecipeStore((s) => s.subRecipes);
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return recipes
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q))
      .map((recipe) => {
        // Resolved rather than compared raw: a product declaring "dairy" and
        // one declaring EU14_MILK must land in the same column.
        const resolved = resolveAllergens(recipe.allergens);
        return {
          recipe,
          ids: new Set(resolved.filter((r) => r.known).map((r) => r.definition.id)),
          // Kept visible rather than dropped — an allergen we cannot map is
          // still an allergen, and it has no column to sit in.
          unmapped: resolved.filter((r) => !r.known).map((r) => r.raw),
          unverified: findUnverifiedAllergens(recipe.ingredientLines, {
            products,
            subRecipes,
          }).length,
        };
      })
      .sort(
        (a, b) =>
          a.recipe.category.localeCompare(b.recipe.category) ||
          a.recipe.name.localeCompare(b.recipe.name),
      );
  }, [recipes, products, subRecipes, search]);

  const unverifiedTotal = rows.filter((r) => r.unverified > 0).length;

  /*
   * The grid, as a grid. Columns carry the full allergen name rather than the
   * code, because a spreadsheet has no tooltip to hold the legal wording and
   * Appendix G does not let a code stand alone.
   *
   * "Yes"/"" rather than the on-screen bullet: a dot is a rendering choice,
   * and this file will be filtered and sorted by someone who needs the cells
   * to mean something to Excel.
   */
  function exportCsv() {
    downloadCsv(
      datedFilename("ccos-allergen-matrix"),
      toCsv(
        ["Dish", "Category", ...EU14_ALLERGENS.map((a) => a.name),
         "Also declared", "Ingredients to verify"],
        rows.map(({ recipe, ids, unmapped, unverified }) => [
          recipe.name,
          recipe.category,
          ...EU14_ALLERGENS.map((a) => (ids.has(a.id) ? "Yes" : "")),
          unmapped.join("; "),
          unverified,
        ]),
      ),
    );
  }

  return (
    <div>
      <PageHeader
        title="Allergen matrix"
        description={`${rows.length} dishes against the regulated fourteen (EU FIC 1169/2011)`}
      >
        <Button
          variant="outline"
          onClick={exportCsv}
          disabled={rows.length === 0}
        >
          <Download className="mr-1 size-4" aria-hidden="true" />
          Export CSV
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="mr-1 size-4" aria-hidden="true" />
          Print
        </Button>
      </PageHeader>

      {unverifiedTotal > 0 && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-3 rounded-lg border border-status-warning/40 bg-status-warning-soft p-4 print:hidden"
        >
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0 text-status-warning"
            aria-hidden="true"
          />
          <p className="text-sm">
            <span className="font-medium text-status-warning">
              {unverifiedTotal} {unverifiedTotal === 1 ? "dish depends" : "dishes depend"} on
              an ingredient whose allergens nobody has verified.
            </span>{" "}
            <span className="text-foreground/80">
              Those rows are marked below. This matrix is not a compliance
              record until they are checked —{" "}
              <Link to="/products?review=1" className="underline underline-offset-4">
                review them
              </Link>
              .
            </span>
          </p>
        </div>
      )}

      <div className="mb-4 max-w-xs print:hidden">
        <Input
          placeholder="Search dishes or categories..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search the matrix"
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[14rem]">Dish</TableHead>
            <TableHead>Category</TableHead>
            {EU14_ALLERGENS.map((a) => (
              <TableHead key={a.id} className="text-center">
                {/*
                  The code is what fits; the name is what counts. Visible text
                  stays abbreviated and the accessible name is spelled out, so
                  a screen reader announces "Cereals containing gluten" rather
                  than the letters G, L, U.
                */}
                <abbr title={a.name} className="no-underline">
                  <span aria-hidden="true">{a.code}</span>
                  <span className="sr-only">{a.name}</span>
                </abbr>
              </TableHead>
            ))}
            <TableHead>Notes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableCell colSpan={EU14_ALLERGENS.length + 3} className="h-24 text-center text-muted-foreground">
              No dishes match.
            </TableCell>
          ) : (
            rows.map(({ recipe, ids, unmapped, unverified }) => (
              <TableRow key={recipe.id}>
                <TableCell className="font-medium">
                  <Link
                    to={`/recipes/${recipe.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {recipe.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {recipe.category}
                </TableCell>

                {EU14_ALLERGENS.map((a) => {
                  const present = ids.has(a.id);
                  return (
                    <TableCell key={a.id} className="text-center">
                      {/*
                        Text, not a coloured dot. A printed grid is often
                        photocopied in black and white, and §4 forbids meaning
                        carried by colour in any case. Absence is announced too
                        — a screen reader reading a row of silence cannot tell
                        an empty cell from one it skipped.
                      */}
                      <span aria-hidden="true">{present ? "●" : "–"}</span>
                      <span className="sr-only">
                        {present ? `Contains ${a.name}` : `No ${a.name} declared`}
                      </span>
                    </TableCell>
                  );
                })}

                <TableCell className="text-xs">
                  {unverified > 0 && (
                    <span className="mr-2 font-medium text-status-warning">
                      {unverified} to verify
                    </span>
                  )}
                  {unmapped.length > 0 && (
                    <span className="text-muted-foreground">
                      Also declared: {unmapped.join(", ")}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {/* The key. Appendix G requires the full name to be reachable in the
          same view as the code — including on paper, where a tooltip is not. */}
      <section className="mt-6" aria-labelledby="allergen-key">
        <h2 id="allergen-key" className="mb-2 text-sm font-medium">
          Key
        </h2>
        <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {EU14_ALLERGENS.map((a) => (
            <div key={a.id} className="flex gap-2">
              <dt className="w-10 shrink-0 font-medium">{a.code}</dt>
              <dd className="text-muted-foreground">
                {a.name}
                {a.note && <span className="block">{a.note}</span>}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">
          ● contains · – not declared. Allergens are inherited from ingredients
          and preparations. A blank cell means nothing was declared, which is
          not the same as having been checked.
        </p>
      </section>
    </div>
  );
}
