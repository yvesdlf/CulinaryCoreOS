import { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search } from "lucide-react";
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
import { useRecipeStore } from "@/stores/recipe-store";
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

  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    return recipes.filter((r) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !q || r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q);
      const matchesCategory =
        categoryFilter === "all" || r.category === categoryFilter;
      const matchesStatus =
        statusFilter === "all" || r.status === statusFilter;
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [recipes, searchQuery, categoryFilter, statusFilter]);

  return (
    <div>
      <PageHeader
        title="Recipes"
        description="Manage your menu recipes and food cost analysis"
      >
        <PermissionGate fallbackLabel="View only">
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
        <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v ?? "all")} items={CATEGORY_ITEMS}>
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
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")} items={STATUS_ITEMS}>
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
            {filtered.map((recipe) => (
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
                  <AllergenBadges allergens={recipe.allergens} max={4} />
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
      )}
    </div>
  );
}
