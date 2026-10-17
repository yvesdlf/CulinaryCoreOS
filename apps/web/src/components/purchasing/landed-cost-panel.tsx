// ---------------------------------------------------------------------------
// What the delivery cost to get here
// ---------------------------------------------------------------------------
// A tab on Purchasing beside Receiving, because a freight invoice is about a
// delivery and arrives days after it — which is also why this is a screen at
// all rather than a field on the receiving dialog. The goods are booked in on
// Tuesday; the haulier bills on Friday.
//
// Three things this screen is deliberate about:
//
//   The supplier price and the charges are separate columns, and the uplift
//   is a percentage. "Landed at 5,600" is a number nobody can act on. "This
//   supplier's cheap price is 12% dearer by the time it is in the store" is
//   the sentence that changes where the venue buys.
//
//   Receipts that cannot be landed are listed as such, with the reason. A
//   landed cost report that silently omits what it could not compute reads as
//   though everything were accounted for — which is the most expensive kind
//   of wrong, because it survives a check against the venue's own accounts.
//
//   The database's refusals are reported in its own words. "Cannot spread
//   freight by weight: at least one line has no weight to spread it over" is
//   the most useful thing this form ever says, and paraphrasing it as "could
//   not save" would throw away the only part that tells somebody what to do.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { Truck, TriangleAlert, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { StatusChip } from "@/components/shared/status-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useCanWriteSection } from "@/stores/access-store";
import {
  fetchLandedReadiness, fetchLandedLines, fetchReceiptCharges,
  addReceiptCharge, removeReceiptCharge,
  type LandedReadiness, type LandedLine, type ReceiptCharge,
  type ChargeKind, type ChargeBasis,
} from "@/data/landed-cost";

function said(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^\w+(\([^)]*\))? failed: /, "");
}

const KINDS: { value: ChargeKind; label: string }[] = [
  { value: "FREIGHT", label: "Freight" },
  { value: "DUTY", label: "Duty" },
  { value: "CLEARANCE", label: "Clearance" },
  { value: "HANDLING", label: "Handling" },
  { value: "INSURANCE", label: "Insurance" },
  { value: "OTHER", label: "Other" },
];

/* The basis is asked outright, and each option says what it is for. Picking
   it wrong is how the saffron ends up paying to move the potatoes. */
const BASES: { value: ChargeBasis; label: string; because: string }[] = [
  { value: "VALUE", label: "By value", because: "Duty, insurance — anything charged on what the goods are worth." },
  { value: "WEIGHT", label: "By weight", because: "Freight and pallet charges. Every line needs a weight." },
  { value: "QUANTITY", label: "By quantity", because: "A flat fee per case or per unit." },
];

export function LandedCostPanel() {
  const canWrite = useCanWriteSection("PURCHASING");
  const [receipts, setReceipts] = useState<LandedReadiness[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [lines, setLines] = useState<LandedLine[]>([]);
  const [charges, setCharges] = useState<ReceiptCharge[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ChargeKind>("FREIGHT");
  const [basis, setBasis] = useState<ChargeBasis>("VALUE");
  const [amount, setAmount] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetchLandedReadiness();
      setReceipts(r);
      setSelected((s) => s ?? r[0]?.goodsReceiptId ?? null);
    } catch (err) {
      toast.error("Could not load deliveries", { description: said(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOne = useCallback(async (id: string) => {
    try {
      const [l, c] = await Promise.all([fetchLandedLines(id), fetchReceiptCharges(id)]);
      setLines(l);
      setCharges(c);
    } catch (err) {
      toast.error("Could not load the delivery", { description: said(err) });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (selected) void loadOne(selected); }, [selected, loadOne]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (receipts.length === 0) {
    return (
      <EmptyState icon={Truck} title="No deliveries booked in yet">
        Once goods are received, the freight and duty that came with them can
        be spread across the lines — so a product's cost is what it cost to
        get here, not what the supplier charged for it.
      </EmptyState>
    );
  }

  const here = receipts.find((r) => r.goodsReceiptId === selected) ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
      <nav aria-label="Deliveries" className="space-y-2">
        {receipts.map((r) => (
          <button
            key={r.goodsReceiptId}
            type="button"
            onClick={() => setSelected(r.goodsReceiptId)}
            aria-current={r.goodsReceiptId === selected ? "true" : undefined}
            className={`w-full rounded-lg border p-3 text-left transition-colors ${
              r.goodsReceiptId === selected
                ? "border-ring bg-accent"
                : "border-border hover:bg-accent/50"
            }`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="font-medium">{r.reference}</span>
              {r.chargeLines > 0 ? (
                <StatusChip tone="success">
                  {r.chargeLines} charge{r.chargeLines === 1 ? "" : "s"}
                </StatusChip>
              ) : (
                <StatusChip tone="neutral">no charges</StatusChip>
              )}
            </span>
            <span className="mt-1 block text-sm text-muted-foreground">
              {r.receivedOn} · {r.lines} line{r.lines === 1 ? "" : "s"}
            </span>
            {!r.canBeLanded && (
              <span className="mt-1 block text-sm text-muted-foreground">
                {r.linesWithoutAPrice} line
                {r.linesWithoutAPrice === 1 ? "" : "s"} with no price
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="space-y-6">
        {here && !here.canBeLanded && (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {here.linesWithoutAPrice} of {here.lines} lines on {here.reference}{" "}
              have no price, so this delivery cannot be fully landed. Those
              lines are shown without a cost rather than at nothing — a cost of
              none and a cost nobody recorded are different claims.
            </span>
          </p>
        )}

        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h3 className="font-medium">Charges on this delivery</h3>
              <p className="max-w-prose text-sm text-muted-foreground">
                Spread across the lines the moment they are recorded. The basis
                is per charge because duty follows value and a pallet charge
                follows weight.
              </p>
            </div>
            {canWrite && here && (
              <Button variant="outline" onClick={() => setOpen(true)}>
                <Plus aria-hidden="true" />
                Add a charge
              </Button>
            )}
          </div>

          {charges.length === 0 ? (
            <EmptyState icon={Truck} title="None recorded">
              Freight, duty, clearance — whatever was paid to get this
              delivery here.
            </EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Charge</TableHead>
                  <TableHead>Spread</TableHead>
                  <TableHead>Their reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {charges.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      {KINDS.find((k) => k.value === c.kind)?.label ?? c.kind}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {BASES.find((b) => b.value === c.basis)?.label ?? c.basis}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.invoiceReference ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <CurrencyDisplay value={c.amount} />
                    </TableCell>
                    <TableCell className="text-right">
                      {canWrite && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove the ${c.kind.toLowerCase()} charge`}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await removeReceiptCharge(c.id);
                              if (selected) await loadOne(selected);
                              await load();
                            } catch (err) {
                              toast.error("Not removed", { description: said(err) });
                            } finally { setBusy(false); }
                          }}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="font-medium">What each line landed at</h3>
            <p className="max-w-prose text-sm text-muted-foreground">
              The supplier's price and the charges are kept apart on purpose.
              The uplift is the figure worth reading — it is what makes one
              supplier dearer than another after the lorry is paid for.
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Supplier price</TableHead>
                <TableHead className="text-right">Charges</TableHead>
                <TableHead className="text-right">Landed per unit</TableHead>
                <TableHead className="text-right">Uplift</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.goodsReceiptLineId}>
                  <TableCell className="font-medium">
                    {l.productName ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {l.quantity} {l.unit}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {l.unitPrice === null
                      ? <Badge variant="outline">no price recorded</Badge>
                      : <CurrencyDisplay value={l.unitPrice} />}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <CurrencyDisplay value={l.charges} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {l.landedUnitCost === null
                      ? "—"
                      : <CurrencyDisplay value={l.landedUnitCost} />}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {/* Null where the line went back entirely: there is
                        nothing for the charge to be a percentage of, and an
                        uplift of none would be a different claim. */}
                    {l.upliftPercent === null
                      ? <span className="text-muted-foreground">—</span>
                      : `${l.upliftPercent.toFixed(2)}%`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a charge</DialogTitle>
            <DialogDescription>
              It is spread across the delivery's lines as soon as it is saved.
              If it cannot be spread honestly, nothing is saved and the reason
              is shown.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="lc-kind">What was charged</Label>
              <select
                id="lc-kind"
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                value={kind}
                onChange={(e) => setKind(e.target.value as ChargeKind)}
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lc-basis">How to spread it</Label>
              <select
                id="lc-basis"
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                value={basis}
                onChange={(e) => setBasis(e.target.value as ChargeBasis)}
              >
                {BASES.map((b) => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </select>
              <p className="text-sm text-muted-foreground">
                {BASES.find((b) => b.value === basis)?.because}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lc-amount">Amount</Label>
              <Input
                id="lc-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lc-ref">Their invoice reference</Label>
              <Input
                id="lc-ref"
                value={invoiceRef}
                onChange={(e) => setInvoiceRef(e.target.value)}
                placeholder="Haulier's invoice number"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={busy || !selected || amount.trim() === ""}
              onClick={async () => {
                if (!selected) return;
                setBusy(true);
                try {
                  await addReceiptCharge({
                    receiptId: selected,
                    kind,
                    basis,
                    amount: Number(amount),
                    invoiceReference: invoiceRef.trim() || null,
                    note: null,
                  });
                  toast.success("Recorded and spread");
                  setOpen(false);
                  setAmount(""); setInvoiceRef("");
                  await loadOne(selected);
                  await load();
                } catch (err) {
                  // The database's own words: they name the line and the
                  // missing figure, which is the only part that says what to
                  // do about it.
                  toast.error("Nothing was recorded", { description: said(err) });
                } finally { setBusy(false); }
              }}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
