// ---------------------------------------------------------------------------
// Purchasing — requisitions, approvals and purchase orders
// ---------------------------------------------------------------------------
// The loop is: someone asks, someone else approves, an order goes to a
// supplier. The middle step is the one the module exists for, so the page is
// built around explaining it rather than around the forms.
//
// Every approval control says what the rule is before it is pressed — who has
// to approve this amount, and whether you are disqualified because you raised
// it. The database enforces both regardless; a screen that only reported the
// refusal afterwards would teach people that the system is arbitrary.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import {
  ClipboardList,
  FileText,
  Plus,
  Check,
  X,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { PermissionGate } from "@/components/shared/permission-gate";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  canApprove,
  requiredRoleFor,
  draftOrdersFrom,
  nextReference,
  type PurchaseStatus,
} from "@/engine/purchasing";
import {
  fetchRequisitions,
  fetchPurchaseOrders,
  fetchCostCentres,
  fetchApprovalPolicies,
  fetchSuppliers,
  fetchMyRole,
  createRequisition,
  createPurchaseOrder,
  setRequisitionStatus,
  setPurchaseOrderStatus,
  recordApproval,
  type Requisition,
  type PurchaseOrder,
  type CostCentre,
  type Supplier,
} from "@/data/repository";
import type { ApprovalPolicy, OrgRole } from "@/engine/purchasing";
import { isSupabaseConfigured } from "@/lib/supabase";
import { DEFAULT_TAX_PERCENT } from "@/lib/constants";
import {
  ReceivingTab,
  InvoicesTab,
  BudgetsTab,
  AnalyticsTab,
} from "@/components/purchasing/finance-tabs";
import {
  fetchGoodsReceipts,
  fetchSupplierInvoices,
  fetchBudgetPositions,
  fetchTolerances,
  type GoodsReceiptRow,
  type SupplierInvoice,
} from "@/data/repository";
import type { BudgetPosition, Tolerances } from "@/engine/invoice-matching";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  SUBMITTED: "bg-status-warning-soft text-status-warning",
  APPROVED: "bg-status-success-soft text-status-success",
  REJECTED: "bg-status-danger-soft text-status-danger",
  CANCELLED: "bg-muted text-muted-foreground",
  ORDERED: "bg-status-info-soft text-status-info",
  PARTIALLY_RECEIVED: "bg-status-info-soft text-status-info",
  RECEIVED: "bg-status-success-soft text-status-success",
  CLOSED: "bg-muted text-muted-foreground",
};

function StatusBadge({ status }: { status: PurchaseStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status] ?? ""}`}
    >
      {status.toLowerCase().replace("_", " ")}
    </span>
  );
}

export function PurchasingPage() {
  const products = useProductStore((s) => s.products);
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [costCentres, setCostCentres] = useState<CostCentre[]>([]);
  const [policies, setPolicies] = useState<ApprovalPolicy[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [receipts, setReceipts] = useState<GoodsReceiptRow[]>([]);
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [budgets, setBudgets] = useState<BudgetPosition[]>([]);
  const [tolerances, setTolerances] = useState<Tolerances | null>(null);
  const [me, setMe] = useState<{ email: string | null; role: OrgRole } | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<Requisition | null>(null);
  const [ordering, setOrdering] = useState<Requisition | null>(null);

  async function load() {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [r, o, c, p, s, role, gr, inv, bud, tol] = await Promise.all([
        fetchRequisitions(),
        fetchPurchaseOrders(),
        fetchCostCentres(),
        fetchApprovalPolicies(),
        fetchSuppliers(),
        fetchMyRole(),
        fetchGoodsReceipts(),
        fetchSupplierInvoices(),
        fetchBudgetPositions(),
        fetchTolerances(),
      ]);
      setRequisitions(r);
      setOrders(o);
      setCostCentres(c);
      setPolicies(p);
      setSuppliers(s);
      setReceipts(gr);
      setInvoices(inv);
      setBudgets(bud);
      setTolerances(tol);
      const { data } = await (
        await import("@/lib/supabase")
      ).supabase!.auth.getUser();
      setMe({ email: data.user?.email ?? null, role: role ?? "VIEWER" });
    } catch (err) {
      toast.error("Could not load purchasing", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const awaiting = requisitions.filter((r) => r.status === "SUBMITTED");

  return (
    <div>
      <PageHeader
        title="Purchasing"
        description="What has been asked for, who approved it, and what was ordered. The person who raises a request cannot approve it."
      >
        <PermissionGate>
          <Button onClick={() => setCreating(true)}>
            <Plus />
            New requisition
          </Button>
        </PermissionGate>
      </PageHeader>

      {me && (
        <p className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="size-4" />
          Signed in as {me.email} with the {me.role} role.
          {awaiting.length > 0 && ` ${awaiting.length} awaiting approval.`}
        </p>
      )}

      <Tabs defaultValue="requisitions">
        <TabsList>
          <TabsTrigger value="requisitions">
            <ClipboardList className="size-4" />
            Requisitions ({requisitions.length})
          </TabsTrigger>
          <TabsTrigger value="orders">
            <FileText className="size-4" />
            Purchase orders ({orders.length})
          </TabsTrigger>
          <TabsTrigger value="receiving">
            Receiving ({receipts.length})
          </TabsTrigger>
          <TabsTrigger value="invoices">
            Invoices ({invoices.length})
          </TabsTrigger>
          <TabsTrigger value="budgets">Budgets</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="requisitions" className="mt-4">
          {loading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
          ) : requisitions.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nothing requested yet. A requisition is how a kitchen asks for
              something; it becomes a purchase order once approved.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Raised by</TableHead>
                    <TableHead>Needed by</TableHead>
                    <TableHead>Lines</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Needs</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-px" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requisitions.map((r) => {
                    const needs = requiredRoleFor(r.totalAmount, "REQUISITION", policies);
                    const verdict = me
                      ? canApprove(
                          {
                            status: r.status,
                            totalAmount: r.totalAmount,
                            requestedById: r.requestedById,
                            requestedByEmail: r.requestedByEmail,
                          },
                          { id: null, email: me.email, role: me.role },
                          "REQUISITION",
                          policies,
                        )
                      : null;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.reference}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.requestedByEmail ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.neededBy ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.lines.length}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <CurrencyDisplay value={r.totalAmount} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {needs ?? "—"}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={r.status} />
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <PermissionGate>
                              {r.status === "DRAFT" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={async () => {
                                    await setRequisitionStatus(r.id, "SUBMITTED");
                                    await recordApproval("REQUISITION", r.id, "SUBMITTED", null);
                                    toast.success(`${r.reference} submitted`);
                                    await load();
                                  }}
                                >
                                  <Send className="size-4" />
                                  <span className="sr-only">Submit {r.reference}</span>
                                </Button>
                              )}
                              {r.status === "SUBMITTED" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={!verdict?.allowed}
                                  title={verdict?.reason ?? undefined}
                                  onClick={() => setDeciding(r)}
                                >
                                  <Check className="size-4" />
                                  <span className="sr-only">
                                    Decide on {r.reference}
                                  </span>
                                </Button>
                              )}
                              {r.status === "APPROVED" && (
                                <Button size="sm" variant="ghost" onClick={() => setOrdering(r)}>
                                  <FileText className="size-4" />
                                  <span className="sr-only">
                                    Raise orders for {r.reference}
                                  </span>
                                </Button>
                              )}
                            </PermissionGate>
                          </div>
                          {r.status === "SUBMITTED" && verdict && !verdict.allowed && (
                            <p className="mt-1 max-w-xs whitespace-normal text-right text-xs text-muted-foreground">
                              {verdict.reason}
                            </p>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="orders" className="mt-4">
          {orders.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No purchase orders yet. They are raised from an approved
              requisition, one per supplier.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Expected</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead className="text-right">VAT</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-px" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono text-xs">{o.reference}</TableCell>
                      <TableCell className="font-medium">
                        {o.supplierName ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {o.expectedOn ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <CurrencyDisplay value={o.subtotal} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        <CurrencyDisplay value={o.taxAmount} />
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        <CurrencyDisplay value={o.totalAmount} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={o.status} />
                      </TableCell>
                      <TableCell>
                        <PermissionGate>
                          {o.status === "DRAFT" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={async () => {
                                await setPurchaseOrderStatus(o.id, "ORDERED");
                                toast.success(`${o.reference} marked as ordered`, {
                                  description:
                                    "Sending it to the supplier is not automated yet.",
                                });
                                await load();
                              }}
                            >
                              <Send className="size-4" />
                              <span className="sr-only">Mark {o.reference} ordered</span>
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
        </TabsContent>

        <TabsContent value="receiving" className="mt-4">
          <ReceivingTab orders={orders} receipts={receipts} onDone={load} />
        </TabsContent>

        <TabsContent value="invoices" className="mt-4">
          <InvoicesTab
            invoices={invoices}
            orders={orders}
            suppliers={suppliers}
            tolerances={tolerances}
            onDone={load}
          />
        </TabsContent>

        <TabsContent value="budgets" className="mt-4">
          <BudgetsTab positions={budgets} />
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <AnalyticsTab orders={orders} invoices={invoices} />
        </TabsContent>
      </Tabs>

      {creating && (
        <NewRequisitionDialog
          products={products}
          suppliers={suppliers}
          costCentres={costCentres}
          existingReferences={requisitions.map((r) => r.reference)}
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await load();
          }}
        />
      )}

      {deciding && me && (
        <DecideDialog
          requisition={deciding}
          policies={policies}
          me={me}
          onClose={() => setDeciding(null)}
          onDone={async () => {
            setDeciding(null);
            await load();
          }}
        />
      )}

      {ordering && (
        <RaiseOrdersDialog
          requisition={ordering}
          suppliers={suppliers}
          existingReferences={orders.map((o) => o.reference)}
          onClose={() => setOrdering(null)}
          onDone={async () => {
            setOrdering(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function NewRequisitionDialog({
  products,
  suppliers,
  costCentres,
  existingReferences,
  onClose,
  onCreated,
}: {
  products: ReturnType<typeof useProductStore.getState>["products"];
  suppliers: Supplier[];
  costCentres: CostCentre[];
  existingReferences: string[];
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [costCentreId, setCostCentreId] = useState(costCentres[0]?.id ?? "");
  const [neededBy, setNeededBy] = useState("");
  const [justification, setJustification] = useState("");
  const [rows, setRows] = useState<
    { productId: string; quantity: string; unit: string; price: string }[]
  >([{ productId: "", quantity: "", unit: "KG", price: "" }]);
  const [busy, setBusy] = useState(false);

  const reference = useMemo(
    () => nextReference("REQ", existingReferences),
    [existingReferences],
  );

  const valid = rows.some(
    (r) => r.productId && Number(r.quantity) > 0,
  );

  const total = rows.reduce(
    (n, r) => n + (Number(r.quantity) || 0) * (Number(r.price) || 0),
    0,
  );

  function setRow(i: number, patch: Partial<(typeof rows)[number]>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function submit() {
    setBusy(true);
    try {
      await createRequisition({
        reference,
        costCentreId: costCentreId || null,
        neededBy: neededBy || null,
        justification: justification.trim() || null,
        lines: rows
          .filter((r) => r.productId && Number(r.quantity) > 0)
          .map((r, i) => {
            const product = products.find((p) => p.id === r.productId);
            return {
              productId: r.productId,
              description: product?.name ?? null,
              quantity: Number(r.quantity),
              unit: r.unit,
              estimatedUnitPrice: r.price || product?.cost.grossPricePerUnit || "0",
              suggestedSupplierId: product?.supplierId ?? null,
              lineNumber: i + 1,
            };
          }),
      });
      toast.success(`${reference} created as a draft`);
      await onCreated();
    } catch (err) {
      toast.error("Could not create the requisition", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      {/* The dialog sets sm:max-w-sm itself, so the override needs the same breakpoint. */}
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New requisition {reference}</DialogTitle>
          <DialogDescription>
            What the kitchen needs and why. It goes to someone else for approval
            once submitted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="req-cc">Cost centre</Label>
              <select
                id="req-cc"
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                value={costCentreId}
                onChange={(e) => setCostCentreId(e.target.value)}
              >
                {costCentres.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="req-needed">Needed by</Label>
              <Input
                id="req-needed"
                type="date"
                value={neededBy}
                onChange={(e) => setNeededBy(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Lines</Label>
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_5rem_4rem_7rem_2rem] gap-2">
                  <select
                    className="h-9 rounded-md border bg-transparent px-2 text-sm"
                    aria-label={`Ingredient on line ${i + 1}`}
                    value={r.productId}
                    onChange={(e) => {
                      const p = products.find((x) => x.id === e.target.value);
                      setRow(i, {
                        productId: e.target.value,
                        unit: p?.packing.totalUnit ?? r.unit,
                        price: p?.cost.grossPricePerUnit ?? r.price,
                      });
                    }}
                  >
                    <option value="">Choose an ingredient</option>
                    {/*
                      * Every active ingredient, not a slice of them. A native
                      * select handles a thousand options and supports
                      * type-ahead; truncating the list silently would mean an
                      * ingredient simply cannot be requested.
                      */}
                    {products
                      .filter((p) => p.status === "ACTIVE")
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    aria-label={`Quantity on line ${i + 1}`}
                    value={r.quantity}
                    onChange={(e) => setRow(i, { quantity: e.target.value })}
                  />
                  <Input
                    aria-label={`Unit on line ${i + 1}`}
                    value={r.unit}
                    onChange={(e) => setRow(i, { unit: e.target.value })}
                  />
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    aria-label={`Estimated price on line ${i + 1}`}
                    value={r.price}
                    onChange={(e) => setRow(i, { price: e.target.value })}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove line ${i + 1}`}
                    onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setRows((rs) => [...rs, { productId: "", quantity: "", unit: "KG", price: "" }])
              }
            >
              <Plus className="size-4" />
              Add a line
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="req-why">Justification</Label>
            <Textarea
              id="req-why"
              rows={2}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Why this is needed"
            />
          </div>

          <p className="text-sm text-muted-foreground">
            Estimated total <CurrencyDisplay value={total.toFixed(2)} />
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!valid || busy}>
            Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DecideDialog({
  requisition,
  policies,
  me,
  onClose,
  onDone,
}: {
  requisition: Requisition;
  policies: ApprovalPolicy[];
  me: { email: string | null; role: OrgRole };
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const verdict = canApprove(
    {
      status: requisition.status,
      totalAmount: requisition.totalAmount,
      requestedById: requisition.requestedById,
      requestedByEmail: requisition.requestedByEmail,
    },
    { id: null, email: me.email, role: me.role },
    "REQUISITION",
    policies,
  );

  async function decide(action: "APPROVED" | "REJECTED") {
    setBusy(true);
    try {
      await recordApproval("REQUISITION", requisition.id, action, comment.trim() || null);
      await setRequisitionStatus(
        requisition.id,
        action === "APPROVED" ? "APPROVED" : "REJECTED",
      );
      toast.success(
        `${requisition.reference} ${action === "APPROVED" ? "approved" : "rejected"}`,
      );
      await onDone();
    } catch (err) {
      // The database speaks policy here; show it as written.
      toast.error("Refused", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{requisition.reference}</DialogTitle>
          <DialogDescription>
            Raised by {requisition.requestedByEmail ?? "someone"} for{" "}
            <CurrencyDisplay value={requisition.totalAmount} />
            {verdict.requiredRole && `, needing the ${verdict.requiredRole} role`}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {requisition.justification && (
            <p className="text-sm text-muted-foreground">
              {requisition.justification}
            </p>
          )}
          <div className="max-h-48 overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Est. total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requisition.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.description ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.quantity} {l.unit}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <CurrencyDisplay value={l.lineTotal} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {!verdict.allowed && (
            <p className="rounded-lg border border-status-warning bg-status-warning-soft p-3 text-sm">
              {verdict.reason}
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="decide-comment">Comment</Label>
            <Textarea
              id="decide-comment"
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Required when rejecting"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => void decide("REJECTED")}
            disabled={busy || comment.trim() === ""}
          >
            <X className="size-4" />
            Reject
          </Button>
          <Button
            onClick={() => void decide("APPROVED")}
            disabled={busy || !verdict.allowed}
          >
            <Check className="size-4" />
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RaiseOrdersDialog({
  requisition,
  suppliers,
  existingReferences,
  onClose,
  onDone,
}: {
  requisition: Requisition;
  suppliers: Supplier[];
  existingReferences: string[];
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const drafts = useMemo(
    () =>
      draftOrdersFrom(
        requisition.lines.map((l) => ({
          id: l.id,
          productId: l.productId,
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          estimatedUnitPrice: l.estimatedUnitPrice,
          suggestedSupplierId: l.suggestedSupplierId,
        })),
      ),
    [requisition],
  );

  const orderable = drafts.filter((d) => d.supplierId !== null);
  const unassigned = drafts.find((d) => d.supplierId === null);

  async function raise() {
    setBusy(true);
    try {
      let refs = [...existingReferences];
      for (const draft of orderable) {
        const reference = nextReference("PO", refs);
        refs = [...refs, reference];
        await createPurchaseOrder({
          reference,
          supplierId: draft.supplierId!,
          requisitionId: requisition.id,
          costCentreId: requisition.costCentreId,
          expectedOn: requisition.neededBy,
          taxPercent: DEFAULT_TAX_PERCENT,
          lines: draft.lines.map((l) => ({
            productId: l.productId,
            description: l.description,
            quantity: l.quantity,
            unit: l.unit,
            unitPrice: l.estimatedUnitPrice,
          })),
        });
      }
      await setRequisitionStatus(requisition.id, "ORDERED");
      toast.success(
        `${orderable.length} purchase order${orderable.length === 1 ? "" : "s"} raised`,
      );
      await onDone();
    } catch (err) {
      toast.error("Could not raise the orders", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Raise orders for {requisition.reference}</DialogTitle>
          <DialogDescription>
            A requisition is a list of what is needed; an order is a contract
            with one company, so it splits by supplier.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {orderable.map((d) => (
            <div
              key={d.supplierId}
              className="flex items-center justify-between rounded-lg border p-3 text-sm"
            >
              <span className="font-medium">
                {suppliers.find((s) => s.id === d.supplierId)?.name ?? "Unknown"}
              </span>
              <span className="text-muted-foreground">
                {d.lines.length} line{d.lines.length === 1 ? "" : "s"},{" "}
                <CurrencyDisplay value={d.subtotal} /> net
              </span>
            </div>
          ))}

          {unassigned && (
            <div className="rounded-lg border border-status-warning bg-status-warning-soft p-3 text-sm">
              {unassigned.lines.length} line
              {unassigned.lines.length === 1 ? "" : "s"} have no supplier and will
              not be ordered. Set a supplier on those ingredients first.
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            VAT is applied at {DEFAULT_TAX_PERCENT}%. Most EU member states
            reduce the rate on food, so check this before sending.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void raise()}
            disabled={busy || orderable.length === 0}
          >
            Raise {orderable.length} order{orderable.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
