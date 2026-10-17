// ---------------------------------------------------------------------------
// What a supplier has charged over time
// ---------------------------------------------------------------------------
// Before 0094, `product_suppliers` held one price and overwrote it, so there
// was no answer to "what did this cost in March" and nothing could notice a
// price had moved — by the time anything looked, the old figure was gone.
//
// The step between each price is the column people read, and it is computed
// from the row before rather than stored, so loading last year's prices
// recomputes the neighbours instead of leaving a figure that was true when
// it was written.
//
// A move past the venue's threshold notifies the kitchen when it is
// recorded. This is where somebody comes to see why.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { fetchPriceHistory, type PriceHistoryRow } from "@/data/repository";

function said(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^\w+(\([^)]*\))? failed: /, "");
}

export function PriceHistoryPanel() {
  const [rows, setRows] = useState<PriceHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      setRows(await fetchPriceHistory());
    } catch (err) {
      toast.error("Could not load price history", { description: said(err) });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.productName ?? "").toLowerCase().includes(q) ||
        (r.supplierName ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (rows.length === 0) {
    return (
      <EmptyState icon={TrendingUp} title="No price history yet">
        Every price a supplier charges is kept from now on, so a product's
        cost over time can be read rather than guessed. Prices recorded
        before this was built are not here — only the current one survived.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      <Input
        className="max-w-sm"
        placeholder="Search product or supplier"
        aria-label="Search price history"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead>From</TableHead>
            <TableHead className="text-right">Per pack</TableHead>
            <TableHead className="text-right">Per unit</TableHead>
            <TableHead className="text-right">Move</TableHead>
            <TableHead>Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((r) => (
            <TableRow key={r.priceId}>
              <TableCell className="font-medium">{r.productName ?? "—"}</TableCell>
              <TableCell>{r.supplierName ?? "—"}</TableCell>
              <TableCell className="whitespace-nowrap">
                {new Date(r.validFrom).toLocaleDateString()}
              </TableCell>
              <TableCell className="text-right">
                <CurrencyDisplay value={r.packPrice} />
              </TableCell>
              <TableCell className="text-right">
                {r.pricePerUnit === null ? "—" : (
                  <CurrencyDisplay value={r.pricePerUnit} decimals={4} />
                )}
              </TableCell>
              <TableCell className="text-right">
                {r.movedPercent === null ? (
                  <span className="text-sm text-muted-foreground">first price</span>
                ) : (
                  <span
                    className={`inline-flex items-center gap-1 tabular-nums ${
                      r.movedPercent > 0 ? "text-status-danger" : "text-status-success"
                    }`}
                  >
                    {r.movedPercent > 0 ? (
                      <TrendingUp className="size-3.5" aria-hidden="true" />
                    ) : (
                      <TrendingDown className="size-3.5" aria-hidden="true" />
                    )}
                    {r.movedPercent > 0 ? "+" : ""}{r.movedPercent}%
                  </span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant="outline">{r.source}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
