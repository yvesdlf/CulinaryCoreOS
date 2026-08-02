import { useState, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Search, Download } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { PermissionGate } from "@/components/shared/permission-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/shared/status-badge";
import { FoodCostIndicator } from "@/components/shared/food-cost-indicator";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { AllergenBadges } from "@/components/shared/allergen-badges";
import { AllergenReviewFlag } from "@/components/shared/allergen-review-notice";
import { findUnverifiedAllergens } from "@/engine/allergen-review";
import { toCsv, downloadCsv, datedFilename } from "@/lib/csv";
import { RecipeImportDialog } from "@/components/recipes/recipe-import-dialog";
import { allergenNames } from "@/lib/allergens";
import { useRecipeStore } from "@/stores/recipe-store";
import { useProductStore } from "@/stores/product-store";
import {
  TablePagination,
  usePagination,
} from "@/components/shared/table-pagination";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import { RECIPE_CATEGORIES, RECIPE_STATUSES } from "@/lib/constants";

/**
 * Base UI's `Select.Value` renders the raw value unless the root is given an
 * `items` label map — without these the triggers would read "all".
 */
const CATEGORY_ITEMS: Record<string, string> = {
  all: "All Categories",
  ...Object.fromEntries(RECIPE_CATEGORIES.map((c) => [c.value, c.label])),
};

const STATUS_ITEMS: Record<string, string> = {
  all: "All Statuses",
  ...Object.fromEntries(RECIPE_STATUSES.map((s) => [s, s])),
};

export function RecipesPage() {
  const navigate = useNavigate();
  const recipes = useRecipeStore((s) => s.recipes);
  const products = useProductStore((s) => s.products);
  const subRecipes = useSubRecipeStore((s) => s.subRecipes);

  // Computed once for the whole list rather than per row: the walk is cheap
  // but it crosses every sub-recipe, and doing it inside 115 rows on every
  // keystroke in the search box is not.
  const reviewCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of recipes) {
      map.set(
        r.id,
        findUnverifiedAllergens(r.ingredientLines, { products, subRecipes })
          .length,
      );
    }
    return map;
  }, [recipes, products, subRecipes]);

  const [searchQuery, setSearchQuery] = useState("");
  // Seeded from the URL so the dashboard's menu-section rows can link
  // straight to their dishes, the same way products takes ?review=1.
  const [params] = useSearchParams();
  const [categoryFilter, setCategoryFilter] = useState<string>(
    () => params.get("category") ?? "all",
  );
  const [statusFilter, setStatusFilter] = useState<string>("all");
  // SRS RCP-FUNC-006 AC5: hidden by default, reachable on request.
  const [showArchived, setShowArchived] = useState(false);

  const filtered = useMemo(() => {
    return recipes.filter((r) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !q ||
        r.name.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q);
      const matchesCategory =
        categoryFilter === "all" || r.category === categoryFilter;
      const matchesStatus = statusFilter === "all" || r.status === statusFilter;
      const visible =
        showArchived || statusFilter === "DISCONTINUED" || r.status !== "DISCONTINUED";
      return matchesSearch && matchesCategory && matchesStatus && visible;
    });
  }, [recipes, searchQuery, categoryFilter, statusFilter, showArchived]);

  const pagination = usePagination(filtered);

  /*
   * Exports what is on screen, filters and all — not the whole catalogue.
   * Someone who has narrowed to one menu section and then gets a file of all
   * 115 dishes has to redo the filtering in Excel, which is the work they
   * came here to avoid.
   */
  function exportCsv() {
    downloadCsv(
      datedFilename("ccos-costings"),
      toCsv(
        [
          "Dish", "Category", "Status", "Ingredient cost", "Waste", "Inflation",
          "Total cost", "Menu price (excl. tax)", "Guest price (incl. tax)",
          "Food cost %", "Gross profit", "Allergens", "Allergens to verify",
        ],
        filtered.map((r) => [
          r.name,
          r.category,
          r.status,
          r.pricing.totalCost,
          r.pricing.wasteAmount,
          r.pricing.inflationAmount,
          r.pricing.totalCog,
          r.pricing.menuPrice,
          r.pricing.priceInclTax,
          r.pricing.foodCostPercent,
          r.pricing.grossProfit,
          // Full names, not codes: a spreadsheet has no tooltip to hold the
          // legal wording, and Appendix G does not let a code stand alone.
          allergenNames(r.allergens).join("; "),
          reviewCounts.get(r.id) ?? 0,
        ]),
      ),
    );
  }

  return (
    <div>
      <PageHeader
        title="Recipes"
        description="Manage your menu recipes and food cost analysis"
      >
        {/* Outside the permission gate: exporting is a read, and a view-only
            user is exactly the person most likely to want the figures in a
            spreadsheet rather than in the app. */}
        <Button
          variant="outline"
          onClick={exportCsv}
          disabled={filtered.length === 0}
        >
          <Download className="mr-1 size-4" aria-hidden="true" />
          Export CSV
        </Button>
        <PermissionGate fallbackLabel="View only">
          <RecipeImportDialog />
          <Button nativeButton={false} render={<Link to="/recipes/new" />}>
            <Plus className="mr-1 size-4" />
            New Recipe
          </Button>
        </PermissionGate>
      </PageHeader>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 pb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search recipes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select
          value={categoryFilter}
          onValueChange={(v) => setCategoryFilter(v ?? "all")}
          items={CATEGORY_ITEMS}
        >
          <SelectTrigger aria-label="Filter by category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {RECIPE_CATEGORIES.map((cat) => (
              <SelectItem key={cat.value} value={cat.value}>
                {cat.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v ?? "all")}
          items={STATUS_ITEMS}
        >
          <SelectTrigger aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {RECIPE_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>

      {/* Recipe table */}
      {filtered.length === 0 ? (
        <div className="flex min-h-[300px] items-center justify-center rounded-lg border border-dashed">
          <p className="text-sm text-muted-foreground">
            {recipes.length === 0
              ? "No recipes yet. Create your first recipe to get started."
              : "No recipes match your filters."}
          </p>
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Allergens</TableHead>
                <TableHead className="text-right">Selling Price</TableHead>
                <TableHead className="text-right">Food Cost %</TableHead>
                <TableHead className="text-right">Ingredients</TableHead>
                <TableHead className="text-right">Portions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagination.pageItems.map((recipe) => (
                <TableRow
                  key={recipe.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/recipes/${recipe.id}`)}
                >
                  <TableCell className="font-medium">{recipe.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {recipe.category}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={recipe.status} />
                  </TableCell>
                  <TableCell>
                    {/* Inherited from the ingredients and any nested sub-recipe. */}
                    <div className="flex flex-wrap items-center gap-1">
                      <AllergenBadges allergens={recipe.allergens} max={4} />
                      {/* Beside the badges, because it is a caveat on them: the
                        list is only as good as the labels behind it. */}
                      <AllergenReviewFlag
                        count={reviewCounts.get(recipe.id) ?? 0}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <CurrencyDisplay
                      value={recipe.pricing.priceInclTax}
                      currency={recipe.pricing.currency}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <FoodCostIndicator value={recipe.pricing.foodCostPercent} />
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {recipe.ingredientLines.length}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {recipe.portion.yieldQty}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <TablePagination
            page={pagination.page}
            pageCount={pagination.pageCount}
            from={pagination.from}
            to={pagination.to}
            total={pagination.total}
            noun="recipes"
            onPageChange={pagination.setPage}
          />
        </>
      )}
    </div>
  );
}
