// ---------------------------------------------------------------------------
// Where the stock actually is, and moving it between places
// ---------------------------------------------------------------------------
// A tab on Inventory rather than a page of its own. The sidebar is already
// twenty-six items and the UI review's first complaint was flat navigation;
// "how much is there" and "where is it" are the same question asked twice,
// and they belong on one screen.
//
// Two things worth being careful about on screen:
//
//   Stock with no place is shown as such. Every movement written before
//   0096 has no location, and folding those into whichever room sorts first
//   would invent a fact. They are a row called "Not assigned to a place",
//   which is also the honest prompt to go and assign them.
//
//   A transfer is one action, not two. The database writes both legs in a
//   single statement (`transfer_stock`) so there is no window where the wine
//   has left the cellar and not arrived at the bar; this form posts once and
//   reports what the database said, including its refusals — moving more
//   than is there names the figure rather than silently allowing it.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Warehouse } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useCanWriteSection } from "@/stores/access-store";
import { useProductStore } from "@/stores/product-store";
import {
  fetchStockPlaces, fetchStockByPlace, transferStock,
  type StockPlace, type StockAtPlace,
} from "@/data/repository";

function said(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^\w+(\([^)]*\))? failed: /, "");
}

const UNPLACED = "__none__";

export function StockByPlace() {
  const canWrite = useCanWriteSection("INVENTORY");
  // The unit the stock is held in. A transfer relocates, it does not convert,
  // so it must post in the same unit the ledger already uses for the product.
  const products = useProductStore((s) => s.products);
  const [places, setPlaces] = useState<StockPlace[]>([]);
  const [rows, setRows] = useState<StockAtPlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [product, setProduct] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([fetchStockPlaces(), fetchStockByPlace()]);
      setPlaces(p);
      setRows(r);
    } catch (err) {
      toast.error("Could not load stock by place", { description: said(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** Grouped by place, with the unplaced stock kept visible as its own group. */
  const grouped = useMemo(() => {
    const byPlace = new Map<string, { name: string; rows: StockAtPlace[] }>();
    for (const r of rows) {
      const key = r.locationId ?? UNPLACED;
      const name = r.locationName ?? "Not assigned to a place";
      const g = byPlace.get(key) ?? { name, rows: [] };
      g.rows.push(r);
      byPlace.set(key, g);
    }
    return [...byPlace.entries()].sort((a, b) =>
      a[0] === UNPLACED ? 1 : b[0] === UNPLACED ? -1 : a[1].name.localeCompare(b[1].name),
    );
  }, [rows]);

  /** Only what the chosen place actually holds, so a transfer cannot invent stock. */
  const productsHere = useMemo(
    () => rows.filter((r) => (r.locationId ?? UNPLACED) === from && r.onHand > 0),
    [rows, from],
  );

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (places.length === 0) {
    return (
      <EmptyState icon={Warehouse} title="No storerooms set up">
        Stock can be tracked per walk-in, freezer, dry store or bar store. Add
        those as locations and movements can be filed against them.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          What each place holds. A transfer moves stock between them as one
          action, so nothing is ever in neither.
        </p>
        {canWrite && (
          <Button variant="outline" onClick={() => setOpen(true)}>
            <ArrowRightLeft aria-hidden="true" />
            Move stock
          </Button>
        )}
      </div>

      {grouped.length === 0 ? (
        <EmptyState icon={Warehouse} title="Nothing is in a place yet">
          Movements written before places existed have none, and new ones get
          a place when a delivery or a count names one.
        </EmptyState>
      ) : (
        grouped.map(([key, g]) => (
          <section key={key} className="rounded-lg border">
            <h3 className="flex items-center gap-2 border-b px-4 py-3 font-medium">
              {g.name}
              {key === UNPLACED && (
                <Badge variant="outline">written before places existed</Badge>
              )}
              <span className="ml-auto text-sm font-normal text-muted-foreground">
                {g.rows.length} product{g.rows.length === 1 ? "" : "s"}
              </span>
            </h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...g.rows]
                  .sort((a, b) => a.productName.localeCompare(b.productName))
                  .map((r) => (
                    <TableRow key={`${r.productId}-${key}`}>
                      <TableCell className="font-medium">{r.productName}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.onHand.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </section>
        ))
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move stock</DialogTitle>
            <DialogDescription>
              Both halves are written together. The venue's total does not
              change; only where the stock is.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tr-from">From</Label>
              <select
                id="tr-from"
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                value={from}
                onChange={(e) => { setFrom(e.target.value); setProduct(""); }}
              >
                <option value="">Choose a place</option>
                {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tr-product">Product</Label>
              <select
                id="tr-product"
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                value={product}
                disabled={from === ""}
                onChange={(e) => setProduct(e.target.value)}
              >
                <option value="">
                  {from === "" ? "Choose a place first" : "Choose a product"}
                </option>
                {productsHere.map((r) => (
                  <option key={r.productId} value={r.productId}>
                    {r.productName} — {r.onHand} there
                  </option>
                ))}
              </select>
              {from !== "" && productsHere.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  That place holds nothing at the moment.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="tr-to">To</Label>
              <select
                id="tr-to"
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              >
                <option value="">Choose a place</option>
                {places.filter((p) => p.id !== from).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tr-qty">How much</Label>
              <Input
                id="tr-qty"
                inputMode="decimal"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tr-note">Note</Label>
              <Input
                id="tr-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="For the weekend"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={busy || !product || !from || !to || qty.trim() === ""}
              onClick={async () => {
                // Guard: the product must actually be in the place chosen.
                const here = rows.some(
                  (r) => r.productId === product && (r.locationId ?? UNPLACED) === from,
                );
                if (!here) return;
                setBusy(true);
                try {
                  const p = products.find((x) => x.id === product);
                  const unit = p?.stockUnit ?? p?.packing?.totalUnit ?? p?.packing?.packUnit;
                  if (!unit) {
                    toast.error("Not moved", {
                      description:
                        "This product has no stock unit, and a movement must have one.",
                    });
                    setBusy(false);
                    return;
                  }
                  await transferStock({
                    productId: product,
                    fromId: from,
                    toId: to,
                    quantity: Number(qty),
                    unit,
                    note: note.trim() || null,
                  });
                  toast.success("Moved");
                  setOpen(false);
                  setQty(""); setNote(""); setProduct("");
                  await load();
                } catch (err) {
                  // Including the database's own refusals — "only 36 there to
                  // move, not 500" is the most useful thing this form says.
                  toast.error("Not moved", { description: said(err) });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
