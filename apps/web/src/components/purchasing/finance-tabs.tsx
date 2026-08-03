// ---------------------------------------------------------------------------
// Receiving, invoices and budgets
// ---------------------------------------------------------------------------
// The half of purchasing that happens after the order goes out. Receiving
// turns an order into stock and a traceable lot in one act; invoices are
// checked against both before anything can be paid; budgets count committed
// money, not just invoiced money.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { PackageCheck, FileWarning, Wallet, TriangleAlert, Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

// ── Analytics ───────────────────────────────────────────────────────────────

import {
  spendBySupplier, invoiceAgeing, matchRate, deliveryPerformance,
} from "@/engine/procurement-analytics";

/**
 * What purchasing already knows, aggregated.
 *
 * Nothing here is a new fact: every figure traces to an order, a receipt or
 * an invoice, which is what makes it arguable with rather than impressive.
 */
export function AnalyticsTab({
  orders, invoices,
}: {
  orders: PurchaseOrder[];
  invoices: SupplierInvoice[];
}) {
  const today = useMemo(() => new Date(), []);

  const summaries = useMemo(
    () =>
      orders.map((o) => ({
        id: o.id, reference: o.reference, supplierId: o.supplierId,
        supplierName: o.supplierName, costCentreId: o.costCentreId,
        status: o.status, orderedOn: o.orderedOn, expectedOn: o.expectedOn,
        totalAmount: o.totalAmount,
        // Fully received orders are treated as delivered on their last update.
        receivedOn: o.status === "RECEIVED" ? o.orderedOn : null,
      })),
    [orders],
  );

  const invoiceSummaries = useMemo(
    () =>
      invoices.map((i) => ({
        id: i.id, supplierId: i.supplierId, supplierName: i.supplierName,
        invoiceDate: i.invoiceDate, dueDate: i.dueDate,
        totalAmount: i.totalAmount, status: i.status,
        exceptionCount: i.exceptions.length,
      })),
    [invoices],
  );

  const bySupplier = spendBySupplier(summaries);
  const ageing = invoiceAgeing(invoiceSummaries, today);
  const match = matchRate(invoiceSummaries);
  const delivery = deliveryPerformance(summaries);
  const concentrated = bySupplier[0];

  if (orders.length === 0 && invoices.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Nothing to report yet. These figures come from orders, deliveries and
        invoices as they are recorded.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Invoices matched cleanly
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {match.total === 0 ? "—" : `${match.straightThroughPercent.toFixed(0)}%`}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {match.held} held, <CurrencyDisplay value={match.valueHeld} /> at risk
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Largest supplier share
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {concentrated ? `${concentrated.sharePercent.toFixed(0)}%` : "—"}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {concentrated?.supplierName ?? "No committed spend yet"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Overdue invoices
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {ageing.slice(1).reduce((n, b) => n + b.count, 0)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Past their due date</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-medium">Committed spend by supplier</h2>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Committed</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bySupplier.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No committed spend yet.
                    </TableCell>
                  </TableRow>
                ) : bySupplier.map((s) => (
                  <TableRow key={s.supplierId}>
                    <TableCell className="font-medium">{s.supplierName}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.orders}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <CurrencyDisplay value={s.committed} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.sharePercent.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {concentrated && concentrated.sharePercent > 50 && (
            <p className="mt-2 flex gap-2 text-xs text-status-warning">
              <FileWarning className="size-4 shrink-0" />
              {concentrated.sharePercent.toFixed(0)}% of committed spend goes
              through {concentrated.supplierName}. That is a service risk the
              day they have one.
            </p>
          )}
        </div>

        <div className="space-y-6">
          <div>
            <h2 className="mb-2 text-sm font-medium">Invoice ageing</h2>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bucket</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ageing.map((b) => (
                    <TableRow key={b.label}>
                      <TableCell>{b.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.count}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <CurrencyDisplay value={b.amount} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-medium">On-time delivery</h2>
            {delivery.length === 0 ? (
              <p className="rounded-lg border p-4 text-sm text-muted-foreground">
                No order has both an expected and a received date yet. Scoring
                undated orders would flatter the figure.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Supplier</TableHead>
                      <TableHead className="text-right">Scored</TableHead>
                      <TableHead className="text-right">On time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {delivery.map((d) => (
                      <TableRow key={d.supplierName}>
                        <TableCell className="font-medium">{d.supplierName}</TableCell>
                        <TableCell className="text-right tabular-nums">{d.ordersScored}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {d.onTimePercent.toFixed(0)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Contracts ───────────────────────────────────────────────────────────────

import { FileSignature, CalendarClock } from "lucide-react";
import {
  fetchContractPrices, addContractPrice, saveContract, refreshContractStatuses,
  type Contract, type ContractPrice,
} from "@/data/repository";

/**
 * Supplier agreements.
 *
 * Two dates and they are not the same one. `ends_on` is when the agreement
 * stops; `notice_by` is the last day to say you are not renewing, usually
 * months earlier. A list that only shows the end date lets a contract renew
 * itself while everybody is still deciding, which is why notice leads here.
 */
export function ContractsTab({
  contracts, attention, suppliers, products, onDone,
}: {
  contracts: Contract[];
  attention: {
    id: string; reference: string; title: string; supplierName: string;
    endsOn: string | null; noticeBy: string | null;
    daysToEnd: number | null; daysToNotice: number | null; autoRenews: boolean;
  }[];
  suppliers: Supplier[];
  products: { id: string; name: string; packing: { totalUnit: string } }[];
  onDone: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState<Contract | "new" | null>(null);
  const [pricesFor, setPricesFor] = useState<Contract | null>(null);
  const supplierName = useMemo(
    () => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers],
  );

  const noticeDue = attention.filter(
    (a) => a.daysToNotice !== null && a.daysToNotice <= 30,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {contracts.length} agreement{contracts.length === 1 ? "" : "s"}
        </p>
        <PermissionGate>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={async () => {
              await refreshContractStatuses();
              toast.success("Statuses brought up to date");
              await onDone();
            }}>Refresh statuses</Button>
            <Button size="sm" onClick={() => setEditing("new")}>New contract</Button>
          </div>
        </PermissionGate>
      </div>

      {noticeDue.length > 0 && (
        <div className="rounded-lg border border-status-warning bg-status-warning-soft p-4">
          <div className="flex items-center gap-2 font-medium text-status-warning">
            <CalendarClock className="size-4" />
            Notice falls due on {noticeDue.length} contract
            {noticeDue.length === 1 ? "" : "s"}
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {noticeDue.map((a) => (
              <li key={a.id}>
                <span className="font-medium">{a.supplierName}</span> — {a.title}:
                {" "}
                {a.daysToNotice! < 0
                  ? `notice date passed ${Math.abs(a.daysToNotice!)} days ago`
                  : `${a.daysToNotice} days to give notice`}
                {a.autoRenews && ". It renews automatically."}
              </li>
            ))}
          </ul>
        </div>
      )}

      {contracts.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No contracts recorded. An agreement here is checked against what
          suppliers actually invoice — that is the point of holding it.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Runs to</TableHead>
                <TableHead>Notice by</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {contracts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs">{c.reference}</TableCell>
                  <TableCell className="font-medium">
                    {supplierName.get(c.supplierId) ?? "—"}
                  </TableCell>
                  <TableCell>{c.title}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.endsOn ?? "open-ended"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.noticeBy ?? "—"}
                    {c.autoRenews && (
                      <span className="ml-1 text-xs">(auto-renews)</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{c.status.toLowerCase()}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setPricesFor(c)}>
                        Prices
                      </Button>
                      <PermissionGate>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                          Edit
                        </Button>
                      </PermissionGate>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {editing && (
        <ContractDialog contract={editing === "new" ? null : editing}
          suppliers={suppliers} onClose={() => setEditing(null)}
          onDone={async () => { setEditing(null); await onDone(); }} />
      )}
      {pricesFor && (
        <ContractPricesDialog contract={pricesFor} products={products}
          onClose={() => setPricesFor(null)} />
      )}
    </div>
  );
}

function ContractDialog({ contract, suppliers, onClose, onDone }: {
  contract: Contract | null; suppliers: Supplier[];
  onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const [f, setF] = useState({
    supplierId: contract?.supplierId ?? suppliers[0]?.id ?? "",
    reference: contract?.reference ?? `CTR-${new Date().getFullYear()}-001`,
    title: contract?.title ?? "",
    startsOn: contract?.startsOn ?? new Date().toISOString().slice(0, 10),
    endsOn: contract?.endsOn ?? "",
    noticeBy: contract?.noticeBy ?? "",
    autoRenews: contract?.autoRenews ?? false,
    leadTimeDays: contract?.leadTimeDays?.toString() ?? "",
    deliveryDays: contract?.deliveryDays ?? "",
    serviceTerms: contract?.serviceTerms ?? "",
  });
  const [busy, setBusy] = useState(false);
  const valid = f.supplierId && f.reference.trim() && f.title.trim() && f.startsOn;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{contract ? "Edit contract" : "New contract"}</DialogTitle>
          <DialogDescription>
            The notice date is the last day to say you are not renewing. It is
            usually well before the end date, and missing it is how an
            agreement renews itself.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="c-sup">Supplier</Label>
            <select id="c-sup" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
              value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-ref">Reference</Label>
            <Input id="c-ref" value={f.reference}
              onChange={(e) => setF({ ...f, reference: e.target.value })} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="c-title">Title</Label>
            <Input id="c-title" value={f.title} placeholder="Annual produce supply"
              onChange={(e) => setF({ ...f, title: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-from">Starts</Label>
            <Input id="c-from" type="date" value={f.startsOn}
              onChange={(e) => setF({ ...f, startsOn: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-to">Ends</Label>
            <Input id="c-to" type="date" value={f.endsOn}
              onChange={(e) => setF({ ...f, endsOn: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-notice">Notice by</Label>
            <Input id="c-notice" type="date" value={f.noticeBy}
              onChange={(e) => setF({ ...f, noticeBy: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-lead">Lead time (days)</Label>
            <Input id="c-lead" type="number" min="0" value={f.leadTimeDays}
              onChange={(e) => setF({ ...f, leadTimeDays: e.target.value })} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.autoRenews}
                onChange={(e) => setF({ ...f, autoRenews: e.target.checked })} />
              Renews automatically unless notice is given
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button disabled={!valid || busy} onClick={async () => {
            setBusy(true);
            try {
              await saveContract({
                id: contract?.id, supplierId: f.supplierId,
                reference: f.reference.trim(), title: f.title.trim(),
                startsOn: f.startsOn, endsOn: f.endsOn || null,
                noticeBy: f.noticeBy || null, autoRenews: f.autoRenews,
                leadTimeDays: f.leadTimeDays === "" ? null : Number(f.leadTimeDays),
                deliveryDays: f.deliveryDays || null,
                serviceTerms: f.serviceTerms || null,
              });
              toast.success("Contract saved");
              await onDone();
            } catch (err) {
              toast.error("Could not save", {
                description: err instanceof Error ? err.message : String(err),
              });
            } finally { setBusy(false); }
          }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContractPricesDialog({ contract, products, onClose }: {
  contract: Contract;
  products: { id: string; name: string; packing: { totalUnit: string } }[];
  onClose: () => void;
}) {
  const [prices, setPrices] = useState<ContractPrice[]>([]);
  const [productId, setProductId] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [from, setFrom] = useState(contract.startsOn);
  const [busy, setBusy] = useState(false);

  const load = () => void fetchContractPrices(contract.id).then(setPrices).catch(() => setPrices([]));
  useState(() => { load(); return undefined; });

  const productName = useMemo(
    () => new Map(products.map((p) => [p.id, p.name])), [products],
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Agreed prices — {contract.title}</DialogTitle>
          <DialogDescription>
            Effective-dated, so an old invoice can be checked against what was
            agreed then rather than against what is agreed now. An invoice
            charging above these is held.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="max-h-48 overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No prices agreed yet.
                    </TableCell>
                  </TableRow>
                ) : prices.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      {p.productId ? productName.get(p.productId) ?? "—" : p.description}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <CurrencyDisplay value={p.unitPrice} /> / {p.unit}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.effectiveFrom}</TableCell>
                    <TableCell className="text-muted-foreground">{p.effectiveTo ?? "open"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <PermissionGate>
            <div className="grid grid-cols-[1fr_8rem_9rem_auto] gap-2">
              <select className="h-9 rounded-md border bg-transparent px-2 text-sm"
                aria-label="Ingredient" value={productId}
                onChange={(e) => setProductId(e.target.value)}>
                <option value="">Choose an ingredient</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <Input type="number" min="0" step="any" placeholder="Price"
                aria-label="Agreed price" value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)} />
              <Input type="date" aria-label="Effective from" value={from}
                onChange={(e) => setFrom(e.target.value)} />
              <Button size="sm" disabled={busy || !productId || !unitPrice}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const p = products.find((x) => x.id === productId);
                    await addContractPrice({
                      contractId: contract.id, productId,
                      description: p?.name ?? null,
                      unit: p?.packing.totalUnit ?? "KG",
                      unitPrice, effectiveFrom: from, effectiveTo: null,
                    });
                    toast.success("Price agreed");
                    setProductId(""); setUnitPrice("");
                    load();
                  } catch (err) {
                    toast.error("Could not add", {
                      description: err instanceof Error ? err.message : String(err),
                    });
                  } finally { setBusy(false); }
                }}>Add</Button>
            </div>
          </PermissionGate>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Sourcing ────────────────────────────────────────────────────────────────

import { Gavel, Send as SendIcon } from "lucide-react";
import {
  fetchRfqComparison, createRfq, sendRfq, awardQuote,
  type Rfq, type QuoteRow,
} from "@/data/repository";

/**
 * Requests for quotation.
 *
 * The comparison is the point. Quotes are sealed until they arrive — a
 * supplier never sees another's — and then a buyer sees them side by side and
 * has to say why they chose one, because the cheapest is not automatically
 * the right one.
 */
export function SourcingTab({
  rfqs, suppliers, products, onDone,
}: {
  rfqs: Rfq[];
  suppliers: Supplier[];
  products: { id: string; name: string; packing: { totalUnit: string } }[];
  onDone: () => void | Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [comparing, setComparing] = useState<Rfq | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {rfqs.length} request{rfqs.length === 1 ? "" : "s"}. Suppliers quote
          through the portal and never see each other's prices.
        </p>
        <PermissionGate>
          <Button size="sm" onClick={() => setCreating(true)}>New request</Button>
        </PermissionGate>
      </div>

      {rfqs.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Nothing out for quotation. A request asks several suppliers the same
          question so the answers can be compared.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Needed by</TableHead>
                <TableHead>Closes</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rfqs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.reference}</TableCell>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell className="text-muted-foreground">{r.neededBy ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.closesAt ? r.closesAt.slice(0, 10) : "—"}
                  </TableCell>
                  <TableCell className="text-sm">{r.status.toLowerCase()}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {r.status === "DRAFT" && (
                        <PermissionGate>
                          <Button size="sm" variant="ghost" onClick={async () => {
                            await sendRfq(r.id);
                            toast.success(`${r.reference} sent`, {
                              description: "Suppliers can now quote in the portal.",
                            });
                            await onDone();
                          }}>
                            <SendIcon className="size-4" />Send
                          </Button>
                        </PermissionGate>
                      )}
                      {r.status !== "DRAFT" && (
                        <Button size="sm" variant="ghost" onClick={() => setComparing(r)}>
                          <Gavel className="size-4" />Compare
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {creating && (
        <NewRfqDialog suppliers={suppliers} products={products}
          existing={rfqs.map((r) => r.reference)}
          onClose={() => setCreating(false)}
          onDone={async () => { setCreating(false); await onDone(); }} />
      )}
      {comparing && (
        <CompareDialog rfq={comparing} onClose={() => setComparing(null)}
          onDone={async () => { await onDone(); }} />
      )}
    </div>
  );
}

function NewRfqDialog({ suppliers, products, existing, onClose, onDone }: {
  suppliers: Supplier[];
  products: { id: string; name: string; packing: { totalUnit: string } }[];
  existing: string[]; onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const reference = useMemo(() => nextReference("RFQ", existing), [existing]);
  const [title, setTitle] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [rows, setRows] = useState([{ productId: "", quantity: "", unit: "KG" }]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const valid = title.trim() && rows.some((r) => r.productId && Number(r.quantity) > 0)
    && chosen.length > 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New request {reference}</DialogTitle>
          <DialogDescription>
            The same question to several suppliers. They answer in the portal
            and cannot see each other's prices.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-3">
              <Label htmlFor="rfq-title">Title</Label>
              <Input id="rfq-title" value={title} placeholder="Charcuterie for Q4"
                onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rfq-needed">Needed by</Label>
              <Input id="rfq-needed" type="date" value={neededBy}
                onChange={(e) => setNeededBy(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rfq-closes">Quotes close</Label>
              <Input id="rfq-closes" type="date" value={closesAt}
                onChange={(e) => setClosesAt(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>What you need</Label>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_6rem_5rem_2rem] gap-2">
                <select className="h-9 rounded-md border bg-transparent px-2 text-sm"
                  aria-label={`Ingredient on line ${i + 1}`}
                  value={r.productId}
                  onChange={(e) => {
                    const p = products.find((x) => x.id === e.target.value);
                    setRows((rs) => rs.map((x, j) => j === i
                      ? { ...x, productId: e.target.value, unit: p?.packing.totalUnit ?? x.unit }
                      : x));
                  }}>
                  <option value="">Choose an ingredient</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <Input type="number" min="0" step="any" placeholder="Qty"
                  aria-label={`Quantity on line ${i + 1}`} value={r.quantity}
                  onChange={(e) => setRows((rs) => rs.map((x, j) =>
                    j === i ? { ...x, quantity: e.target.value } : x))} />
                <Input aria-label={`Unit on line ${i + 1}`} value={r.unit}
                  onChange={(e) => setRows((rs) => rs.map((x, j) =>
                    j === i ? { ...x, unit: e.target.value } : x))} />
                <Button size="sm" variant="ghost" aria-label={`Remove line ${i + 1}`}
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>×</Button>
              </div>
            ))}
            <Button size="sm" variant="outline"
              onClick={() => setRows((rs) => [...rs, { productId: "", quantity: "", unit: "KG" }])}>
              Add a line
            </Button>
          </div>

          <div className="space-y-2">
            <Label>Ask which suppliers</Label>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
              {suppliers.slice(0, 60).map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={chosen.includes(s.id)}
                    onChange={(e) => setChosen((c) =>
                      e.target.checked ? [...c, s.id] : c.filter((x) => x !== s.id))} />
                  {s.name}
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button disabled={!valid || busy} onClick={async () => {
            setBusy(true);
            try {
              await createRfq({
                reference, title: title.trim(),
                neededBy: neededBy || null,
                closesAt: closesAt ? `${closesAt}T23:59:59Z` : null,
                lines: rows.filter((r) => r.productId && Number(r.quantity) > 0)
                  .map((r) => ({
                    productId: r.productId,
                    description: products.find((p) => p.id === r.productId)?.name ?? null,
                    quantity: Number(r.quantity), unit: r.unit,
                  })),
                supplierIds: chosen,
              });
              toast.success(`${reference} created as a draft`);
              await onDone();
            } catch (err) {
              toast.error("Could not create it", {
                description: err instanceof Error ? err.message : String(err),
              });
            } finally { setBusy(false); }
          }}>Create draft</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompareDialog({ rfq, onClose, onDone }: {
  rfq: Rfq; onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const [rows, setRows] = useState<QuoteRow[]>([]);
  const [awarding, setAwarding] = useState<QuoteRow | null>(null);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => void fetchRfqComparison(rfq.id).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [rfq.id]);

  // Grouped by line, cheapest first — which is the order a buyer reads them in.
  const byLine = useMemo(() => {
    const m = new Map<string, QuoteRow[]>();
    for (const r of rows) m.set(r.rfqLineId, [...(m.get(r.rfqLineId) ?? []), r]);
    for (const [, list] of m) {
      list.sort((a, b) => Number(a.unitPrice ?? Infinity) - Number(b.unitPrice ?? Infinity));
    }
    return m;
  }, [rows]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{rfq.reference} — {rfq.title}</DialogTitle>
          <DialogDescription>
            Quotes side by side. Awarding asks why, because the cheapest is not
            automatically the right one.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-96 space-y-4 overflow-y-auto">
          {[...byLine.entries()].map(([lineId, list]) => {
            const first = list[0];
            const quotes = list.filter((q) => q.quoteId);
            return (
              <div key={lineId} className="rounded-lg border p-3">
                <div className="mb-2 text-sm font-medium">
                  {first.description} — {first.quantity} {first.unit}
                </div>
                {quotes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No quotes yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Supplier</TableHead>
                        <TableHead className="text-right">Unit</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Lead</TableHead>
                        <TableHead className="w-px" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {quotes.map((q, i) => (
                        <TableRow key={q.quoteId}>
                          <TableCell className="font-medium">
                            {q.supplierName}
                            {i === 0 && (
                              <span className="ml-2 text-xs text-status-success">cheapest</span>
                            )}
                            {q.isLate && (
                              <span className="ml-2 text-xs text-status-warning">late</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <CurrencyDisplay value={q.unitPrice ?? "0"} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <CurrencyDisplay value={q.lineTotal ?? "0"} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {q.leadTimeDays === null ? "—" : `${q.leadTimeDays}d`}
                          </TableCell>
                          <TableCell>
                            {q.awarded ? (
                              <span className="text-xs text-status-success">awarded</span>
                            ) : (
                              <PermissionGate>
                                <Button size="sm" variant="ghost"
                                  onClick={() => { setAwarding(q); setRationale(""); }}>
                                  Award
                                </Button>
                              </PermissionGate>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            );
          })}
        </div>

        {awarding && (
          <div className="space-y-2 rounded-lg border border-status-info bg-status-info-soft p-3">
            <Label htmlFor="award-why">
              Why {awarding.supplierName}?
            </Label>
            <Textarea id="award-why" rows={2} value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Cheapest, or: shorter lead time, better record, minimum order suits us" />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setAwarding(null)}>
                Cancel
              </Button>
              <Button size="sm" disabled={busy || rationale.trim() === ""}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await awardQuote({
                      rfqId: rfq.id, rfqLineId: awarding.rfqLineId,
                      supplierId: awarding.supplierId!, quoteId: awarding.quoteId,
                      rationale: rationale.trim(),
                    });
                    toast.success(`Awarded to ${awarding.supplierName}`);
                    setAwarding(null); load(); await onDone();
                  } catch (err) {
                    toast.error("Could not award", {
                      description: err instanceof Error ? err.message : String(err),
                    });
                  } finally { setBusy(false); }
                }}>Confirm award</Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
