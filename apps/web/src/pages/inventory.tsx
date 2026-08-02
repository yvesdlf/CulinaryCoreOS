// ---------------------------------------------------------------------------
// Inventory — SRS 4.10
// ---------------------------------------------------------------------------
// Two jobs, deliberately on one page: what is on the shelf right now, and
// what to do about it. Splitting them would mean a chef checks a list, walks
// to another screen and re-finds the same product to record the delivery.
//
// Everything written here is a movement on an append-only ledger. Nothing
// edits a stock number, because a number that can be typed over cannot answer
// "why is this four kilos short" a week later.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import {
  Warehouse,
  TruckIcon,
  Trash2,
  ClipboardList,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { PermissionGate } from "@/components/shared/permission-gate";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProductStore } from "@/stores/product-store";
import {
  buildStockLines,
  countVariances,
  stockValue,
  wasteValue,
  PAR_ORDER,
  type MovementKind,
  type ParStatus,
  type StockLine,
  type StockMovement,
} from "@/engine/inventory";
import {
  fetchStockLevels,
  fetchMovements,
  recordMovements,
  fetchSuppliers,
  createLot,
  type NewMovement,
  type Supplier,
} from "@/data/repository";
import { isSupabaseConfigured } from "@/lib/supabase";

const STATUS: Record<ParStatus, { label: string; className: string }> = {
  out: { label: "Out of stock", className: "bg-status-danger-soft text-status-danger" },
  reorder: { label: "Reorder", className: "bg-status-warning-soft text-status-warning" },
  low: { label: "Low", className: "bg-status-info-soft text-status-info" },
  ok: { label: "In stock", className: "bg-status-success-soft text-status-success" },
  unmanaged: { label: "Not tracked", className: "bg-muted text-muted-foreground" },
};

/** Waste reasons the kitchen actually gives — SRS INV-FUNC-003 AC2. */
const WASTE_REASONS = [
  "Spoiled",
  "Expired",
  "Prep trim",
  "Cooking error",
  "Dropped",
  "Customer return",
  "Staff meal",
];

function stockUnitOf(line: StockLine) {
  return line.product.stockUnit ?? line.product.packing.totalUnit;
}

export function InventoryPage() {
  const products = useProductStore((s) => s.products);
  const [levels, setLevels] = useState<
    Map<string, { onHand: number; lastMovementAt: string | null }>
  >(new Map());
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  async function load() {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [lv, mv, sup] = await Promise.all([
        fetchStockLevels(),
        fetchMovements(),
        fetchSuppliers(),
      ]);
      setLevels(lv);
      setMovements(mv);
      setSuppliers(sup);
    } catch (err) {
      toast.error("Could not load stock", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Loaded once on mount; every write reloads through `load` itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lines = useMemo(
    () => buildStockLines(products.filter((p) => p.status === "ACTIVE"), levels),
    [products, levels],
  );

  /*
   * Untracked ingredients are hidden until searched for.
   *
   * The catalogue is 1.100 lines and a dozen of them are stock-managed, so
   * listing everything buries the page it exists to be. Searching still
   * reaches the rest, which is what receiving a delivery of something not yet
   * tracked needs.
   */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lines.filter((l) => l.status !== "unmanaged");
    return lines.filter(
      (l) =>
        l.product.name.toLowerCase().includes(q) ||
        (l.product.supplier ?? "").toLowerCase().includes(q),
    );
  }, [lines, query]);

  const tracked = useMemo(
    () => lines.filter((l) => l.status !== "unmanaged"),
    [lines],
  );
  const needing = useMemo(
    () => tracked.filter((l) => PAR_ORDER[l.status] <= PAR_ORDER.reorder),
    [tracked],
  );

  async function write(items: NewMovement[], message: string) {
    try {
      await recordMovements(items);
      toast.success(message);
      await load();
    } catch (err) {
      toast.error("Could not record that", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="What is on the shelf, and what to order. Every change is recorded as a movement, so a shortfall stays explainable."
      >
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : undefined} />
          Refresh
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          title="Stock on hand"
          value={<CurrencyDisplay value={stockValue(tracked)} />}
          hint={`${tracked.length} tracked ingredient${tracked.length === 1 ? "" : "s"}`}
        />
        <SummaryCard
          title="Needs ordering"
          value={<span className="text-2xl font-semibold">{needing.length}</span>}
          hint={
            needing.length === 0
              ? "Nothing at or below its reorder point"
              : "At or below the reorder point"
          }
        />
        <SummaryCard
          title="Waste recorded"
          value={<CurrencyDisplay value={wasteValue(movements)} />}
          hint="Valued at the price when it happened"
        />
      </div>

      <Tabs defaultValue="stock" className="mt-6">
        <TabsList>
          <TabsTrigger value="stock">
            <Warehouse className="size-4" />
            Stock
          </TabsTrigger>
          <TabsTrigger value="count">
            <ClipboardList className="size-4" />
            Stock count
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="mt-4 space-y-4">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search all ingredients"
              aria-label="Search stock"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {query.trim()
              ? `${visible.length} matching, including ingredients that are not stock-tracked.`
              : "Stock-tracked ingredients only. Search to find any other ingredient."}
          </p>
          <StockTable
            lines={visible}
            loading={loading}
            suppliers={suppliers}
            emptyMessage={
              query.trim()
                ? "No ingredients match that search."
                : "No ingredients are stock-tracked yet. Set a par level on a product to track it here."
            }
            onWrite={write}
          />
        </TabsContent>

        <TabsContent value="count" className="mt-4">
          <CountSheet lines={tracked} products={products} levels={levels} onWrite={write} />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <MovementHistory movements={movements} lines={lines} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: React.ReactNode;
  hint: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: ParStatus }) {
  const s = STATUS[status];
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${s.className}`}
    >
      {s.label}
    </span>
  );
}

function StockTable({
  lines,
  loading,
  emptyMessage,
  suppliers,
  onWrite,
}: {
  lines: StockLine[];
  loading: boolean;
  emptyMessage: string;
  suppliers: Supplier[];
  onWrite: (items: NewMovement[], message: string) => Promise<void>;
}) {
  const [movement, setMovement] = useState<{
    line: StockLine;
    kind: MovementKind;
  } | null>(null);

  if (loading) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Loading stock…</p>;
  }
  if (lines.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ingredient</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Par</TableHead>
              <TableHead className="text-right">Order</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="w-px" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.product.id}>
                <TableCell>
                  <div className="font-medium">{line.product.name}</div>
                  {line.product.supplier && (
                    <div className="text-xs text-muted-foreground">
                      {line.product.supplier}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge status={line.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {line.onHand} {stockUnitOf(line)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {line.product.parLevel ?? "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {line.suggestedOrder > 0 ? line.suggestedOrder : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <CurrencyDisplay value={line.value} />
                </TableCell>
                <TableCell>
                  <PermissionGate>
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setMovement({ line, kind: "RECEIPT" })}
                      >
                        <TruckIcon className="size-4" />
                        <span className="sr-only">
                          Receive stock for {line.product.name}
                        </span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setMovement({ line, kind: "WASTE" })}
                      >
                        <Trash2 className="size-4" />
                        <span className="sr-only">
                          Record waste for {line.product.name}
                        </span>
                      </Button>
                    </div>
                  </PermissionGate>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {movement && (
        <MovementDialog
          line={movement.line}
          kind={movement.kind}
          suppliers={suppliers}
          onClose={() => setMovement(null)}
          onWrite={onWrite}
        />
      )}
    </>
  );
}

function MovementDialog({
  line,
  kind,
  suppliers,
  onClose,
  onWrite,
}: {
  line: StockLine;
  kind: MovementKind;
  suppliers: Supplier[];
  onClose: () => void;
  onWrite: (items: NewMovement[], message: string) => Promise<void>;
}) {
  const receipt = kind === "RECEIPT";
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState(WASTE_REASONS[0]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  /*
   * Delivery details, for a receipt only.
   *
   * A lot code is what a recall notice quotes and what Article 18 traceability
   * is answered with, so a delivery recorded without one is a gap in the
   * record rather than a tidier form.
   */
  const [lotCode, setLotCode] = useState("");
  const [supplierId, setSupplierId] = useState(line.product.supplierId ?? "");
  const [deliveryRef, setDeliveryRef] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [expiryKind, setExpiryKind] = useState<"USE_BY" | "BEST_BEFORE" | "">("");
  const [temperature, setTemperature] = useState("");

  const amount = Number(qty);
  const quantityValid = qty.trim() !== "" && Number.isFinite(amount) && amount > 0;
  // A date without a kind cannot be judged later, so the pair goes together.
  const dateValid = expiresOn === "" || expiryKind !== "";
  const valid = quantityValid && (!receipt || (lotCode.trim() !== "" && dateValid));
  const unit = stockUnitOf(line);

  async function submit() {
    if (!valid) return;
    setBusy(true);
    let lotId: string | null = null;
    if (receipt) {
      try {
        const lot = await createLot({
          productId: line.product.id,
          lotCode: lotCode.trim(),
          supplierId: supplierId || null,
          deliveryReference: deliveryRef.trim() || null,
          receivedOn: new Date().toISOString().slice(0, 10),
          expiresOn: expiresOn || null,
          expiryKind: expiryKind || null,
          receiptTemperatureC:
            temperature.trim() === "" ? null : Number(temperature),
        });
        lotId = lot.id;
      } catch (err) {
        // The movement is not written without its lot: stock that appears with
        // no traceable delivery behind it is exactly what Article 18 forbids.
        toast.error("Could not record the delivery", {
          description: err instanceof Error ? err.message : String(err),
        });
        setBusy(false);
        return;
      }
    }

    await onWrite(
      [
        {
          productId: line.product.id,
          kind,
          // The dialog decides direction; a receipt adds, waste removes. The
          // ledger stores what it is told and never re-interprets the sign.
          quantity: receipt ? amount : -amount,
          unit,
          unitCost: line.product.cost.grossPricePerUnit,
          reason: receipt ? null : reason,
          note: note.trim() || null,
          lotId,
        },
      ],
      receipt
        ? `Received ${amount} ${unit} of ${line.product.name}, lot ${lotCode.trim()}`
        : `Recorded ${amount} ${unit} of ${line.product.name} as waste`,
    );
    setBusy(false);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {receipt ? "Receive stock" : "Record waste"} — {line.product.name}
          </DialogTitle>
          <DialogDescription>
            {line.onHand} {unit} on hand.{" "}
            {receipt
              ? "Recorded against today's price."
              : "Valued at today's price, and it stays at that price in later reports."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="movement-qty">Quantity ({unit})</Label>
            <Input
              id="movement-qty"
              type="number"
              min="0"
              step="any"
              autoFocus
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>

          {receipt && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="lot-code">Lot / batch code</Label>
                  <Input
                    id="lot-code"
                    value={lotCode}
                    onChange={(e) => setLotCode(e.target.value)}
                    placeholder="As printed on the box"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lot-supplier">Supplier</Label>
                  <select
                    id="lot-supplier"
                    className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                  >
                    <option value="">Not recorded</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lot-delivery">Delivery note</Label>
                  <Input
                    id="lot-delivery"
                    value={deliveryRef}
                    onChange={(e) => setDeliveryRef(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lot-temp">Temperature on arrival (°C)</Label>
                  <Input
                    id="lot-temp"
                    type="number"
                    step="any"
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                    placeholder="Chilled and frozen goods"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lot-expiry">Date on the pack</Label>
                  <Input
                    id="lot-expiry"
                    type="date"
                    value={expiresOn}
                    onChange={(e) => setExpiresOn(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lot-expiry-kind">Which date is it?</Label>
                  <select
                    id="lot-expiry-kind"
                    className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                    value={expiryKind}
                    onChange={(e) =>
                      setExpiryKind(e.target.value as "USE_BY" | "BEST_BEFORE" | "")
                    }
                  >
                    <option value="">—</option>
                    <option value="USE_BY">Use by (safety)</option>
                    <option value="BEST_BEFORE">Best before (quality)</option>
                  </select>
                </div>
              </div>
              {expiresOn !== "" && expiryKind === "" && (
                <p className="text-sm text-status-danger">
                  Say which date this is. Past a use-by date the food is unsafe
                  and must be thrown away; past a best-before it is still legal
                  to use. Guessing later costs either safety or good food.
                </p>
              )}
            </>
          )}

          {!receipt && (
            <div className="space-y-2">
              <Label htmlFor="movement-reason">Reason</Label>
              <select
                id="movement-reason"
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              >
                {WASTE_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="movement-note">Note (optional)</Label>
            <Textarea
              id="movement-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={receipt ? "Delivery note number" : "What happened"}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!valid || busy}>
            {receipt ? "Receive" : "Record waste"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Count sheet — SRS INV-FUNC-002.
 *
 * Counts are typed against the books but the books are not shown until the
 * sheet is reviewed: a chef who can see "expected 4" will write 4. The
 * variance appears after entry, which is when it is useful.
 */
function CountSheet({
  lines,
  products,
  levels,
  onWrite,
}: {
  lines: StockLine[];
  products: ReturnType<typeof useProductStore.getState>["products"];
  levels: Map<string, { onHand: number }>;
  onWrite: (items: NewMovement[], message: string) => Promise<void>;
}) {
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);

  const entered = useMemo(
    () =>
      Object.entries(counts)
        .filter(([, v]) => v.trim() !== "" && Number.isFinite(Number(v)))
        .map(([productId, v]) => ({ productId, counted: Number(v) })),
    [counts],
  );

  const variances = useMemo(
    () => countVariances(entered, products, levels),
    [entered, products, levels],
  );

  async function apply() {
    setBusy(true);
    // A count is recorded as the correction it implies, so the ledger still
    // sums to the counted figure without anything overwriting history.
    await onWrite(
      variances.map((v) => ({
        productId: v.product.id,
        kind: "COUNT" as const,
        quantity: v.variance,
        unit: v.product.stockUnit ?? v.product.packing.totalUnit,
        unitCost: v.product.cost.grossPricePerUnit,
        reason: "Stock count",
        note: `Counted ${v.counted}, books said ${v.expected}`,
      })),
      `Applied ${variances.length} correction${variances.length === 1 ? "" : "s"}`,
    );
    setBusy(false);
    setCounts({});
    setReview(false);
  }

  if (lines.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No ingredients are stock-tracked yet. Set a par level on a product to
        start counting it.
      </p>
    );
  }

  if (review) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">
            {variances.length === 0
              ? "The count agrees with the books"
              : `${variances.length} line${variances.length === 1 ? " disagrees" : "s disagree"}`}
          </h2>
          <p className="text-sm text-muted-foreground">
            {entered.length} counted. Lines that matched are not shown.
          </p>
        </div>

        {variances.length > 0 && (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ingredient</TableHead>
                  <TableHead className="text-right">Books</TableHead>
                  <TableHead className="text-right">Counted</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variances.map((v) => (
                  <TableRow key={v.product.id}>
                    <TableCell className="font-medium">{v.product.name}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {v.expected}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{v.counted}</TableCell>
                    <TableCell
                      className={`text-right tabular-nums font-medium ${
                        v.variance < 0 ? "text-status-danger" : "text-status-success"
                      }`}
                    >
                      {v.variance > 0 ? "+" : ""}
                      {v.variance}
                      {v.percent !== 0 && (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          ({v.percent > 0 ? "+" : ""}
                          {v.percent.toFixed(0)}%)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <CurrencyDisplay value={v.valueDelta} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setReview(false)} disabled={busy}>
            Back to the sheet
          </Button>
          <PermissionGate>
            <Button
              onClick={() => void apply()}
              disabled={busy || variances.length === 0}
            >
              Apply {variances.length} correction{variances.length === 1 ? "" : "s"}
            </Button>
          </PermissionGate>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Enter what is actually on the shelf. Leave a line blank to skip it —
        only what you count is compared.
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ingredient</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="w-40 text-right">Counted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.product.id}>
                <TableCell className="font-medium">{line.product.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {stockUnitOf(line)}
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    className="ml-auto w-32 text-right"
                    aria-label={`Counted quantity for ${line.product.name}`}
                    value={counts[line.product.id] ?? ""}
                    onChange={(e) =>
                      setCounts((c) => ({ ...c, [line.product.id]: e.target.value }))
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Button onClick={() => setReview(true)} disabled={entered.length === 0}>
        Review {entered.length} counted line{entered.length === 1 ? "" : "s"}
      </Button>
    </div>
  );
}

function MovementHistory({
  movements,
  lines,
}: {
  movements: StockMovement[];
  lines: StockLine[];
}) {
  const names = useMemo(
    () => new Map(lines.map((l) => [l.product.id, l.product.name])),
    [lines],
  );

  if (movements.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Nothing recorded yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Ingredient</TableHead>
            <TableHead>Movement</TableHead>
            <TableHead className="text-right">Quantity</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>By</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {movements.map((m) => (
            <TableRow key={m.id}>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {m.occurredAt ? new Date(m.occurredAt).toLocaleString() : "—"}
              </TableCell>
              <TableCell className="font-medium">
                {names.get(m.productId) ?? "Unknown ingredient"}
              </TableCell>
              <TableCell className="capitalize">{m.kind.toLowerCase()}</TableCell>
              <TableCell
                className={`text-right tabular-nums ${
                  m.quantity < 0 ? "text-status-danger" : ""
                }`}
              >
                {m.quantity > 0 ? "+" : ""}
                {m.quantity} {m.unit}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {m.reason ?? m.note ?? "—"}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {m.actorEmail ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
