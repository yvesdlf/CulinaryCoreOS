// ---------------------------------------------------------------------------
// Products list page
// ---------------------------------------------------------------------------

import { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import type { Product } from "@ccos/shared";

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
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/status-badge";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import {
  TablePagination,
  usePagination,
} from "@/components/shared/table-pagination";
import { useProductStore } from "@/stores/product-store";
import { PRODUCT_CATEGORIES, PRODUCT_STATUSES } from "@/lib/constants";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatPacking(p: Product["packing"]): string {
  return `${p.packQty} ${p.packUnit} × ${p.unitsPerPack.toLocaleString()} ${p.unitsPerPackUnit}`;
}

/**
 * Yield colouring via semantic tokens (Design Bible §3.1) — no palette classes
 * and no `dark:` variants, since the tokens re-derive per theme. The figure is
 * always written out, so colour stays supplementary (§4).
 */
function yieldColor(yieldPct: number): string {
  if (yieldPct < 80) return "text-status-danger";
  if (yieldPct < 90) return "text-status-warning";
  return "";
}

/**
 * Base UI's `Select.Value` renders the raw value unless the root is given an
 * `items` label map — without these the triggers would read "__all__".
 */
const CATEGORY_ITEMS: Record<string, string> = {
  __all__: "All Categories",
  ...Object.fromEntries(PRODUCT_CATEGORIES.map((c) => [c, c])),
};

const STATUS_ITEMS: Record<string, string> = {
  __all__: "All Statuses",
  ...Object.fromEntries(PRODUCT_STATUSES.map((s) => [s, s])),
};

// ── Component ────────────────────────────────────────────────────────────────

export function ProductsPage() {
  const products = useProductStore((s) => s.products);
  const navigate = useNavigate();

  // Filter state
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("__all__");
  const [status, setStatus] = useState<string>("__all__");

  // Filtered list
  const filtered = useMemo(() => {
    let result = products;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.brand && p.brand.toLowerCase().includes(q)) ||
          (p.supplier && p.supplier.toLowerCase().includes(q)),
      );
    }

    if (category !== "__all__") {
      result = result.filter((p) => p.category === category);
    }

    if (status !== "__all__") {
      result = result.filter((p) => p.status === status);
    }

    return result;
  }, [products, search, category, status]);

  const pagination = usePagination(filtered);

  return (
    <div>
      <PageHeader
        title="Products"
        description="Manage your ingredient catalog and supplier pricing"
      >
        <PermissionGate fallbackLabel="View only">
          <Button nativeButton={false} render={<Link to="/products/new" />}>
            <Plus className="mr-1 size-4" />
            New Product
          </Button>
        </PermissionGate>
      </PageHeader>

      {/* ── Filter bar ──────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        {/* Category filter */}
        <Select
          value={category}
          onValueChange={(val) => setCategory(val ?? "__all__")}
          items={CATEGORY_ITEMS}
        >
          <SelectTrigger className="w-[160px]" aria-label="Filter by category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Categories</SelectItem>
            {PRODUCT_CATEGORIES.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {cat}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Status filter */}
        <Select
          value={status}
          onValueChange={(val) => setStatus(val ?? "__all__")}
          items={STATUS_ITEMS}
        >
          <SelectTrigger className="w-[140px]" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Statuses</SelectItem>
            {PRODUCT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Count */}
        <span className="ml-auto text-sm text-muted-foreground">
          {filtered.length} product{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead>Pack</TableHead>
            <TableHead className="text-right">Unit Cost</TableHead>
            <TableHead className="text-right">Yield %</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={7}
                className="h-24 text-center text-muted-foreground"
              >
                No products found.
              </TableCell>
            </TableRow>
          ) : (
            pagination.pageItems.map((product) => (
              <TableRow
                key={product.id}
                className="cursor-pointer"
                onClick={() => navigate(`/products/${product.id}`)}
              >
                {/* Name + brand */}
                <TableCell>
                  <div>
                    <span className="font-medium">{product.name}</span>
                    {product.brand && (
                      <span className="block text-xs text-muted-foreground">
                        {product.brand}
                      </span>
                    )}
                  </div>
                </TableCell>

                {/* Category */}
                <TableCell>
                  <Badge variant="secondary">{product.category}</Badge>
                </TableCell>

                {/* Supplier */}
                <TableCell>{product.supplier ?? "--"}</TableCell>

                {/* Pack */}
                <TableCell className="tabular-nums">
                  {formatPacking(product.packing)}
                </TableCell>

                {/* Unit Cost */}
                <TableCell className="text-right">
                  <CurrencyDisplay
                    value={product.cost.nettPricePerUnit}
                    decimals={4}
                  />
                </TableCell>

                {/* Yield % */}
                <TableCell
                  className={cn(
                    "text-right tabular-nums font-medium",
                    yieldColor(product.yield_.yieldPercent),
                  )}
                >
                  {formatPercent(product.yield_.yieldPercent)}
                </TableCell>

                {/* Status */}
                <TableCell>
                  <StatusBadge status={product.status} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <TablePagination
        page={pagination.page}
        pageCount={pagination.pageCount}
        from={pagination.from}
        to={pagination.to}
        total={pagination.total}
        noun="products"
        onPageChange={pagination.setPage}
      />
    </div>
  );
}
