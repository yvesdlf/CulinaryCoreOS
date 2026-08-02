// ---------------------------------------------------------------------------
// Receiving, invoices and budgets
// ---------------------------------------------------------------------------
// The half of purchasing that happens after the order goes out. Receiving
// turns an order into stock and a traceable lot in one act; invoices are
// checked against both before anything can be paid; budgets count committed
// money, not just invoiced money.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { PackageCheck, FileWarning, Wallet, TriangleAlert, Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { PermissionGate } from "@/components/shared/permission-gate";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  matchInvoice, exceptionValue, checkBudget,
  type MatchException, type Tolerances, type BudgetPosition,
} from "@/engine/invoice-matching";
import { nextReference } from "@/engine/purchasing";
import {
  recordGoodsReceipt, createSupplierInvoice, setInvoiceStatus,
  type PurchaseOrder, type GoodsReceiptRow, type SupplierInvoice, type Supplier,
} from "@/data/repository";
import { DEFAULT_TAX_PERCENT } from "@/lib/constants";

// ── Receiving ───────────────────────────────────────────────────────────────

export function ReceivingTab({
  orders, receipts, onDone,
}: {
  orders: PurchaseOrder[];
  receipts: GoodsReceiptRow[];
  onDone: () => void | Promise<void>;
}) {
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);

  // Anything ordered and not yet fully in.
  const open = orders.filter(
    (o) => ["ORDERED", "PARTIALLY_RECEIVED"].includes(o.status),
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-2 text-sm font-medium">Awaiting delivery ({open.length})</h2>
        {open.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nothing is out for delivery. Mark a purchase order as ordered first.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead className="text-right">Outstanding lines</TableHead>
                  <TableHead className="w-px" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {open.map((o) => {
                  const outstanding = o.lines.filter(
                    (l) => l.quantityReceived < l.quantity,
                  ).length;
                  return (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono text-xs">{o.reference}</TableCell>
                      <TableCell className="font-medium">{o.supplierName ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {o.expectedOn ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{outstanding}</TableCell>
                      <TableCell>
                        <PermissionGate>
                          <Button size="sm" variant="ghost" onClick={() => setReceiving(o)}>
                            <PackageCheck className="size-4" />
                            Receive
                          </Button>
                        </PermissionGate>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Recent deliveries</h2>
        {receipts.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No deliveries booked in yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Delivery note</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead>Issues</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipts.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.reference}</TableCell>
                    <TableCell className="text-muted-foreground">{r.receivedOn}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.deliveryNote ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.receivedByEmail ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.lineCount}</TableCell>
                    <TableCell>
                      {r.rejectedCount > 0 ? (
                        <span className="text-status-warning">
                          {r.rejectedCount} rejected
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {receiving && (
        <ReceiveDialog
          order={receiving}
          existingReferences={receipts.map((r) => r.reference)}
          onClose={() => setReceiving(null)}
          onDone={async () => { setReceiving(null); await onDone(); }}
        />
      )}
    </div>
  );
}

function ReceiveDialog({
  order, existingReferences, onClose, onDone,
}: {
  order: PurchaseOrder;
  existingReferences: string[];
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const reference = useMemo(
    () => nextReference("GRN", existingReferences), [existingReferences],
  );
  const [deliveryNote, setDeliveryNote] = useState("");
  const [temperature, setTemperature] = useState("");
  const [rows, setRows] = useState(
    order.lines.map((l) => ({
      lineId: l.id,
      productId: l.productId,
      description: l.description,
      unit: l.unit,
      outstanding: l.quantity - l.quantityReceived,
      received: String(Math.max(0, l.quantity - l.quantityReceived)),
      rejected: "",
      rejectionReason: "",
      lotCode: "",
      expiresOn: "",
      expiryKind: "" as "" | "USE_BY" | "BEST_BEFORE",
    })),
  );
  const [busy, setBusy] = useState(false);

  const active = rows.filter((r) => Number(r.received) > 0);
  // A date without a kind cannot be judged later, so the pair goes together.
  const datesOk = active.every((r) => r.expiresOn === "" || r.expiryKind !== "");
  const valid = active.length > 0 && datesOk;

  function setRow(i: number, patch: Partial<(typeof rows)[number]>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function submit() {
    setBusy(true);
    try {
      await recordGoodsReceipt({
        reference,
        purchaseOrderId: order.id,
        supplierId: order.supplierId,
        deliveryNote: deliveryNote.trim() || null,
        vehicleTemperatureC: temperature.trim() === "" ? null : Number(temperature),
        lines: active.map((r) => ({
          purchaseOrderLineId: r.lineId,
          productId: r.productId,
          quantityReceived: Number(r.received),
          unit: r.unit,
          quantityRejected: Number(r.rejected) || 0,
          rejectionReason: r.rejectionReason.trim() || null,
          conditionNote: null,
          lot: r.lotCode.trim() && r.productId
            ? {
                productId: r.productId,
                lotCode: r.lotCode.trim(),
                supplierId: order.supplierId,
                deliveryReference: deliveryNote.trim() || reference,
                receivedOn: new Date().toISOString().slice(0, 10),
                expiresOn: r.expiresOn || null,
                expiryKind: r.expiryKind || null,
                receiptTemperatureC: temperature.trim() === "" ? null : Number(temperature),
              }
            : null,
        })),
      });
      toast.success(`${reference} booked in`, {
        description: "Stock and lots updated, and the order's progress with it.",
      });
      await onDone();
    } catch (err) {
      toast.error("Could not book the delivery in", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Receive {order.reference} — {reference}</DialogTitle>
          <DialogDescription>
            What actually arrived. Only accepted quantities become stock;
            rejected goods stay owed by the supplier.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="grn-note">Delivery note</Label>
              <Input id="grn-note" value={deliveryNote}
                onChange={(e) => setDeliveryNote(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="grn-temp">Vehicle temperature (°C)</Label>
              <Input id="grn-temp" type="number" step="any" value={temperature}
                placeholder="Chilled and frozen deliveries"
                onChange={(e) => setTemperature(e.target.value)} />
            </div>
          </div>

          <div className="max-h-80 space-y-3 overflow-y-auto">
            {rows.map((r, i) => (
              <div key={r.lineId} className="rounded-lg border p-3">
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-sm font-medium">{r.description ?? "Line"}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.outstanding} {r.unit} outstanding
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <div>
                    <Label className="text-xs" htmlFor={`rc-${i}`}>Received</Label>
                    <Input id={`rc-${i}`} type="number" min="0" step="any" value={r.received}
                      onChange={(e) => setRow(i, { received: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs" htmlFor={`rj-${i}`}>Rejected</Label>
                    <Input id={`rj-${i}`} type="number" min="0" step="any" value={r.rejected}
                      onChange={(e) => setRow(i, { rejected: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs" htmlFor={`lc-${i}`}>Lot code</Label>
                    <Input id={`lc-${i}`} value={r.lotCode}
                      onChange={(e) => setRow(i, { lotCode: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs" htmlFor={`ex-${i}`}>Date on pack</Label>
                    <Input id={`ex-${i}`} type="date" value={r.expiresOn}
                      onChange={(e) => setRow(i, { expiresOn: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs" htmlFor={`ek-${i}`}>Which date</Label>
                    <select id={`ek-${i}`}
                      className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                      value={r.expiryKind}
                      onChange={(e) => setRow(i, {
                        expiryKind: e.target.value as "" | "USE_BY" | "BEST_BEFORE",
                      })}>
                      <option value="">—</option>
                      <option value="USE_BY">Use by</option>
                      <option value="BEST_BEFORE">Best before</option>
                    </select>
                  </div>
                </div>
                {Number(r.rejected) > 0 && (
                  <div className="mt-2">
                    <Label className="text-xs" htmlFor={`rr-${i}`}>Why rejected</Label>
                    <Input id={`rr-${i}`} value={r.rejectionReason}
                      placeholder="Damaged, short, wrong item, temperature"
                      onChange={(e) => setRow(i, { rejectionReason: e.target.value })} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {!datesOk && (
            <p className="text-sm text-status-danger">
              Say whether each date is a use-by or a best-before. Past a use-by
              the food is unsafe; past a best-before it is still legal to use.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={!valid || busy}>Book in</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Invoices ────────────────────────────────────────────────────────────────

export function InvoicesTab({
  invoices, orders, suppliers, tolerances, onDone,
}: {
  invoices: SupplierInvoice[];
  orders: PurchaseOrder[];
  suppliers: Supplier[];
  tolerances: Tolerances | null;
  onDone: () => void | Promise<void>;
}) {
  const [entering, setEntering] = useState(false);

  const held = invoices.filter((i) => i.exceptions.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {invoices.length} invoice{invoices.length === 1 ? "" : "s"}
          {held.length > 0 && (
            <span className="ml-2 font-medium text-status-warning">
              {held.length} held with exceptions
            </span>
          )}
        </p>
        <PermissionGate>
          <Button variant="outline" onClick={() => setEntering(true)}>
            Enter an invoice
          </Button>
        </PermissionGate>
      </div>

      {invoices.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No invoices yet. An invoice is checked against its order and against
          what was actually received before it can be approved for payment.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Exceptions</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono text-xs">{inv.invoiceNumber}</TableCell>
                  <TableCell className="font-medium">{inv.supplierName ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{inv.invoiceDate}</TableCell>
                  <TableCell className="text-muted-foreground">{inv.dueDate ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <CurrencyDisplay value={inv.totalAmount} />
                  </TableCell>
                  <TableCell>
                    <span className="text-xs">{inv.status.toLowerCase().replace(/_/g, " ")}</span>
                  </TableCell>
                  <TableCell className="max-w-md whitespace-normal">
                    {inv.exceptions.length === 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs text-status-success">
                        <Check className="size-3" /> matched
                      </span>
                    ) : (
                      <ul className="space-y-0.5 text-xs text-status-warning">
                        {inv.exceptions.slice(0, 3).map((e, i) => (
                          <li key={i}>{e.description}</li>
                        ))}
                        {inv.exceptions.length > 3 && (
                          <li>and {inv.exceptions.length - 3} more</li>
                        )}
                      </ul>
                    )}
                  </TableCell>
                  <TableCell>
                    <PermissionGate>
                      {inv.exceptions.length === 0 && inv.status !== "APPROVED_FOR_PAYMENT" && (
                        <Button size="sm" variant="ghost"
                          onClick={async () => {
                            try {
                              await setInvoiceStatus(inv.id, "APPROVED_FOR_PAYMENT");
                              toast.success(`${inv.invoiceNumber} approved for payment`, {
                                description: "Payment itself is executed by your AP provider.",
                              });
                              await onDone();
                            } catch (err) {
                              toast.error("Refused", {
                                description: err instanceof Error ? err.message : String(err),
                              });
                            }
                          }}>
                          Approve
                        </Button>
                      )}
                      {inv.exceptions.length > 0 && inv.status !== "DISPUTED" && (
                        <Button size="sm" variant="ghost"
                          onClick={async () => {
                            await setInvoiceStatus(inv.id, "DISPUTED");
                            toast.success(`${inv.invoiceNumber} marked disputed`);
                            await onDone();
                          }}>
                          Dispute
                        </Button>
                      )}
                    </PermissionGate>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {entering && (
        <EnterInvoiceDialog
          orders={orders}
          suppliers={suppliers}
          invoices={invoices}
          tolerances={tolerances}
          onClose={() => setEntering(false)}
          onDone={async () => { setEntering(false); await onDone(); }}
        />
      )}
    </div>
  );
}

function EnterInvoiceDialog({
  orders, suppliers, invoices, tolerances, onClose, onDone,
}: {
  orders: PurchaseOrder[];
  suppliers: Supplier[];
  invoices: SupplierInvoice[];
  tolerances: Tolerances | null;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const receivable = orders.filter((o) =>
    ["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(o.status),
  );
  const [orderId, setOrderId] = useState(receivable[0]?.id ?? "");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Record<string, { qty: string; price: string }>>({});
  const [busy, setBusy] = useState(false);

  const order = receivable.find((o) => o.id === orderId) ?? null;
  const supplier = suppliers.find((s) => s.id === order?.supplierId) ?? null;

  // Default the invoice to exactly what was ordered — the common case, and it
  // makes any deviation something the person typing had to do deliberately.
  const lines = useMemo(
    () =>
      (order?.lines ?? []).map((l) => ({
        lineNumber: l.lineNumber,
        purchaseOrderLineId: l.id,
        productId: l.productId,
        description: l.description,
        unit: l.unit,
        quantity: Number(rows[l.id]?.qty ?? l.quantity),
        unitPrice: rows[l.id]?.price ?? l.unitPrice,
        taxPercent: l.taxPercent,
        lineTotal: String(
          Number(rows[l.id]?.qty ?? l.quantity) * Number(rows[l.id]?.price ?? l.unitPrice),
        ),
      })),
    [order, rows],
  );

  const total = lines.reduce((n, l) => n + Number(l.lineTotal), 0);

  const exceptions: MatchException[] = useMemo(() => {
    if (!order) return [];
    return matchInvoice({
      invoiceNumber: invoiceNumber || "—",
      supplierId: order.supplierId,
      orderLines: order.lines.map((l) => ({
        id: l.id,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        quantityReceived: l.quantityReceived,
      })),
      invoiceLines: lines,
      invoiceTotal: String(total),
      existingInvoiceNumbers: invoices
        .filter((i) => i.supplierId === order.supplierId)
        .map((i) => i.invoiceNumber),
      tolerances: tolerances ?? undefined,
    });
  }, [order, lines, total, invoiceNumber, invoices, tolerances]);

  const dueDate = useMemo(() => {
    if (!supplier?.paymentTermsDays) return null;
    const d = new Date(invoiceDate);
    d.setDate(d.getDate() + supplier.paymentTermsDays);
    return d.toISOString().slice(0, 10);
  }, [supplier, invoiceDate]);

  async function submit() {
    if (!order) return;
    setBusy(true);
    try {
      await createSupplierInvoice({
        invoiceNumber: invoiceNumber.trim(),
        supplierId: order.supplierId,
        purchaseOrderId: order.id,
        invoiceDate,
        dueDate,
        paymentTermsDays: supplier?.paymentTermsDays ?? null,
        status: exceptions.length > 0 ? "EXCEPTION" : "MATCHING",
        exceptions,
        lines: lines.map((l) => ({
          purchaseOrderLineId: l.purchaseOrderLineId,
          productId: l.productId,
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: l.unitPrice,
          taxPercent: l.taxPercent,
        })),
      });
      toast.success(
        exceptions.length === 0
          ? `${invoiceNumber} matched cleanly`
          : `${invoiceNumber} held with ${exceptions.length} exception${exceptions.length === 1 ? "" : "s"}`,
      );
      await onDone();
    } catch (err) {
      toast.error("Could not record the invoice", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Enter a supplier invoice</DialogTitle>
          <DialogDescription>
            Checked against the order and against what was received, before it
            can be approved for payment.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="inv-order">Purchase order</Label>
              <select id="inv-order"
                className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                value={orderId} onChange={(e) => { setOrderId(e.target.value); setRows({}); }}>
                {receivable.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.reference} — {o.supplierName}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-number">Invoice number</Label>
              <Input id="inv-number" value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-date">Invoice date</Label>
              <Input id="inv-date" type="date" value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
          </div>

          {dueDate && (
            <p className="text-xs text-muted-foreground">
              Due {dueDate} on {supplier?.paymentTermsDays}-day terms.
            </p>
          )}

          <div className="max-h-64 overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Line</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="w-24">Invoiced qty</TableHead>
                  <TableHead className="w-32">Unit price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(order?.lines ?? []).map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-sm">{l.description ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {l.quantity}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {l.quantityReceived}
                    </TableCell>
                    <TableCell>
                      <Input type="number" min="0" step="any"
                        aria-label={`Invoiced quantity for ${l.description ?? "line"}`}
                        value={rows[l.id]?.qty ?? String(l.quantity)}
                        onChange={(e) => setRows((r) => ({
                          ...r, [l.id]: { qty: e.target.value, price: r[l.id]?.price ?? l.unitPrice },
                        }))} />
                    </TableCell>
                    <TableCell>
                      <Input type="number" min="0" step="any"
                        aria-label={`Invoiced price for ${l.description ?? "line"}`}
                        value={rows[l.id]?.price ?? l.unitPrice}
                        onChange={(e) => setRows((r) => ({
                          ...r, [l.id]: { qty: r[l.id]?.qty ?? String(l.quantity), price: e.target.value },
                        }))} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className="text-sm">
            Net <CurrencyDisplay value={total.toFixed(2)} />
          </p>

          {exceptions.length > 0 && (
            <div className="rounded-lg border border-status-warning bg-status-warning-soft p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-status-warning">
                <TriangleAlert className="size-4" />
                {exceptions.length} exception{exceptions.length === 1 ? "" : "s"},{" "}
                <CurrencyDisplay value={exceptionValue(exceptions)} /> at risk
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {exceptions.map((e, i) => <li key={i}>{e.description}</li>)}
              </ul>
              <p className="mt-2 text-xs">
                It can still be recorded — it will be held rather than approved
                for payment.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()}
            disabled={busy || !order || invoiceNumber.trim() === ""}>
            Record invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Budgets ─────────────────────────────────────────────────────────────────

export function BudgetsTab({ positions }: { positions: BudgetPosition[] }) {
  if (positions.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No budgets set. A budget is per cost centre and period, and counts both
        committed and invoiced spend.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {positions.map((p) => {
          const v = checkBudget(p, "0");
          const pct = Math.min(100, Math.max(0, v.usedPercent));
          return (
            <Card key={p.budgetId}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <Wallet className="size-4" />
                  {p.name}
                  {p.hardStop && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                      hard stop
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-2xl font-semibold">
                  <CurrencyDisplay value={v.remaining} />
                </div>
                <p className="text-xs text-muted-foreground">
                  left of <CurrencyDisplay value={p.amount} />
                </p>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full ${
                      v.state === "over" ? "bg-status-danger"
                      : v.state === "warning" ? "bg-status-warning"
                      : "bg-status-success"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <dl className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                  <dt>Committed</dt>
                  <dd className="text-right tabular-nums">
                    <CurrencyDisplay value={p.committed} />
                  </dd>
                  <dt>Invoiced</dt>
                  <dd className="text-right tabular-nums">
                    <CurrencyDisplay value={p.actual} />
                  </dd>
                </dl>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Committed is money promised on approved orders but not yet invoiced. A
        budget that counted only invoices would say a kitchen can afford what it
        has already ordered.
      </p>
    </div>
  );
}
