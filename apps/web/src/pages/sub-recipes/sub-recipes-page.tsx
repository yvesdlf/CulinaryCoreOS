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
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import { RECIPE_STATUSES } from "@/lib/constants";
import { formatWeight } from "@/lib/format";

/**
 * Base UI's `Select.Value` renders the raw value unless the root is given an
 * `items` label map — without this the trigger would read "all".
 */
const STATUS_ITEMS: Record<string, string> = {
  all: "All Statuses",
  ...Object.fromEntries(RECIPE_STATUSES.map((s) => [s, s])),
};

export function SubRecipesPage() {
  const navigate = useNavigate();
  const subRecipes = useSubRecipeStore((s) => s.subRecipes);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Derive unique categories from data
  const categories = useMemo(() => {
    const cats = new Set(subRecipes.map((s) => s.category));
    return Array.from(cats).sort();
  }, [subRecipes]);

  const CATEGORY_ITEMS = useMemo<Record<string, string>>(
    () => ({
      all: "All Categories",
      ...Object.fromEntries(categories.map((c) => [c, c])),
    }),
    [categories],
  );

  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    return subRecipes.filter((s) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q);
      const matchesCategory =
        categoryFilter === "all" || s.category === categoryFilter;
      const matchesStatus =
        statusFilter === "all" || s.status === statusFilter;
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [subRecipes, searchQuery, categoryFilter, statusFilter]);

  return (
    <div>
      <PageHeader
        title="Sub Recipes"
        description="Manage reusable preparations and base components"
      >
        <PermissionGate fallbackLabel="View only">
          <Button nativeButton={false} render={<Link to="/sub-recipes/new" />}>
            <Plus className="mr-1 size-4" />
            New Sub Recipe
          </Button>
        </PermissionGate>
      </PageHeader>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 pb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search sub recipes..."
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
            {categories.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {cat}
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

      {/* Sub-recipe table */}
      {filtered.length === 0 ? (
        <div className="flex min-h-[300px] items-center justify-center rounded-lg border border-dashed">
          <p className="text-sm text-muted-foreground">
            {subRecipes.length === 0
              ? "No sub recipes yet. Create your first sub recipe to get started."
              : "No sub recipes match your filters."}
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Batch Yield</TableHead>
              <TableHead className="text-right">Total Cost</TableHead>
              <TableHead className="text-right">Cost/Unit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((sub) => (
              <TableRow
                key={sub.id}
                className="cursor-pointer"
                onClick={() => navigate(`/sub-recipes/${sub.id}`)}
              >
                <TableCell className="font-medium">{sub.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {sub.category}
                </TableCell>
                <TableCell>
                  <StatusBadge status={sub.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatWeight(sub.batchYield.qty, sub.batchYield.unit)}
                </TableCell>
                <TableCell className="text-right">
                  <CurrencyDisplay value={sub.totalCost} />
                </TableCell>
                <TableCell className="text-right">
                  <CurrencyDisplay value={sub.costPerUnit} decimals={4} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
