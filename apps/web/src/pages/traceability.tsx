// ---------------------------------------------------------------------------
// Traceability — EU food law
// ---------------------------------------------------------------------------
// Three jobs, all of them things an inspector or a recall notice will ask for:
//
//   What must not be used right now — expired, blocked or recalled lots.
//   Where a given lot came from — Regulation 178/2002 Article 18, one step
//   back: supplier, delivery, date and temperature on arrival.
//   Stopping a lot — Article 19. Blocking is a database state, not a screen
//   state: the ledger refuses to consume a lot that is not OK, so a withdrawal
//   holds even if this page is never opened again.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import {
  ShieldAlert,
  Search,
  Ban,
  CircleCheck,
  Thermometer,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { PermissionGate } from "@/components/shared/permission-gate";
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
  assessLot,
  lotsNeedingAttention,
  assessCertificate,
  traceBack,
  type StockLot,
  type DateMarkState,
} from "@/engine/traceability";
import {
  fetchStockLots,
  fetchSupplierCertificates,
  fetchSuppliers,
  setLotStatus,
  type Supplier,
  type SupplierCertificate,
} from "@/data/repository";
import { isSupabaseConfigured } from "@/lib/supabase";

const MARK: Record<DateMarkState, { label: string; className: string }> = {
  unsafe: {
    label: "Past use-by",
    className: "bg-status-danger-soft text-status-danger",
  },
  expiring: {
    label: "Expiring",
    className: "bg-status-warning-soft text-status-warning",
  },
  "past-best": {
    label: "Past best-before",
    className: "bg-status-info-soft text-status-info",
  },
  "unknown-kind": {
    label: "Date unmarked",
    className: "bg-status-warning-soft text-status-warning",
  },
  ok: { label: "In date", className: "bg-status-success-soft text-status-success" },
  none: { label: "No date", className: "bg-muted text-muted-foreground" },
};

export function TraceabilityPage() {
  const products = useProductStore((s) => s.products);
  const [lots, setLots] = useState<StockLot[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [certificates, setCertificates] = useState<SupplierCertificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [tracing, setTracing] = useState<StockLot | null>(null);
  const [blocking, setBlocking] = useState<StockLot | null>(null);

  // Fixed for the render so every row is judged against the same date.
  const today = useMemo(() => new Date(), []);

  async function load() {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [l, s, c] = await Promise.all([
        fetchStockLots(),
        fetchSuppliers(),
        fetchSupplierCertificates(),
      ]);
      setLots(l);
      setSuppliers(s);
      setCertificates(c);
    } catch (err) {
      toast.error("Could not load lots", {
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

  const productName = useMemo(
    () => new Map(products.map((p) => [p.id, p.name])),
    [products],
  );

  const attention = useMemo(
    () => lotsNeedingAttention(lots, today),
    [lots, today],
  );

  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return lots.filter(
      (l) =>
        l.lotCode.toLowerCase().includes(q) ||
        (l.deliveryReference ?? "").toLowerCase().includes(q) ||
        (l.supplierName ?? "").toLowerCase().includes(q) ||
        (productName.get(l.productId) ?? "").toLowerCase().includes(q),
    );
  }, [lots, query, productName]);

  const certStates = useMemo(
    () =>
      certificates
        .map((c) => ({
          cert: c,
          supplier: suppliers.find((s) => s.id === c.supplierId),
          state: assessCertificate(c, today),
        }))
        .filter((c) => c.state.state === "expired" || c.state.state === "expiring"),
    [certificates, suppliers, today],
  );

  const unsafeCount = attention.filter((a) => !a.usable).length;

  return (
    <div>
      <PageHeader
        title="Traceability"
        description="Where every delivery came from, what must not be used, and how to stop a lot. Required by Regulation 178/2002."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          title="Must not be used"
          value={unsafeCount}
          hint={
            unsafeCount === 0
              ? "Nothing blocked, recalled or past a use-by date"
              : "Blocked, recalled or past a use-by date"
          }
          danger={unsafeCount > 0}
        />
        <SummaryCard
          title="Needing attention"
          value={attention.length}
          hint="Including dates coming up and unmarked dates"
        />
        <SummaryCard
          title="Certificates lapsing"
          value={certStates.length}
          hint="Supplier certificates expired or within 30 days"
          danger={certStates.some((c) => c.state.state === "expired")}
        />
      </div>

      <Tabs defaultValue="attention" className="mt-6">
        <TabsList>
          <TabsTrigger value="attention">
            <ShieldAlert className="size-4" />
            Attention ({attention.length})
          </TabsTrigger>
          <TabsTrigger value="trace">
            <Search className="size-4" />
            Trace a lot
          </TabsTrigger>
          <TabsTrigger value="certificates">
            Certificates ({certStates.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="attention" className="mt-4">
          {loading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Loading…
            </p>
          ) : attention.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nothing needs attention. Lots appear here as they approach a date,
              or when one is blocked or recalled.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ingredient</TableHead>
                    <TableHead>Lot</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>What to do</TableHead>
                    <TableHead className="w-px" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attention.map((a) => (
                    <TableRow key={a.lot.id}>
                      <TableCell className="font-medium">
                        {productName.get(a.lot.productId) ?? "Unknown"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {a.lot.lotCode}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {a.lot.supplierName ?? "—"}
                      </TableCell>
                      <TableCell>
                        {a.lot.status !== "OK" ? (
                          <span className="inline-flex rounded-full bg-status-danger-soft px-2 py-0.5 text-xs font-medium text-status-danger">
                            {a.lot.status === "RECALLED"
                              ? "Recalled"
                              : a.lot.status === "WITHDRAWN"
                                ? "Withdrawn"
                                : "On hold"}
                          </span>
                        ) : (
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${MARK[a.dateMark].className}`}
                          >
                            {MARK[a.dateMark].label}
                          </span>
                        )}
                      </TableCell>
                      {/* Table cells default to nowrap; this one is a sentence. */}
                      <TableCell className="max-w-md whitespace-normal text-sm text-muted-foreground">
                        {a.reason ??
                          (a.daysLeft !== null
                            ? `${a.daysLeft} day${a.daysLeft === 1 ? "" : "s"} left`
                            : "")}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setTracing(a.lot)}
                          >
                            Trace
                          </Button>
                          <PermissionGate>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setBlocking(a.lot)}
                            >
                              {a.lot.status === "OK" ? (
                                <Ban className="size-4" />
                              ) : (
                                <CircleCheck className="size-4" />
                              )}
                              <span className="sr-only">
                                {a.lot.status === "OK"
                                  ? `Block lot ${a.lot.lotCode}`
                                  : `Release lot ${a.lot.lotCode}`}
                              </span>
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
        </TabsContent>

        <TabsContent value="trace" className="mt-4 space-y-4">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Lot code, delivery note, supplier or ingredient"
              aria-label="Search lots"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            A recall notice quotes a lot code. Search it here to find every
            delivery it covers.
          </p>
          {query.trim() && (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ingredient</TableHead>
                    <TableHead>Lot</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Received</TableHead>
                    <TableHead>Date mark</TableHead>
                    <TableHead className="w-px" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {found.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        No lot matches that.
                      </TableCell>
                    </TableRow>
                  ) : (
                    found.map((l) => {
                      const a = assessLot(l, today);
                      return (
                        <TableRow key={l.id}>
                          <TableCell className="font-medium">
                            {productName.get(l.productId) ?? "Unknown"}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{l.lotCode}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {l.supplierName ?? "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {l.receivedOn}
                          </TableCell>
                          <TableCell>
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${MARK[a.dateMark].className}`}
                            >
                              {MARK[a.dateMark].label}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="ghost" onClick={() => setTracing(l)}>
                                Trace
                              </Button>
                              <PermissionGate>
                                <Button size="sm" variant="ghost" onClick={() => setBlocking(l)}>
                                  {l.status === "OK" ? (
                                    <Ban className="size-4" />
                                  ) : (
                                    <CircleCheck className="size-4" />
                                  )}
                                  <span className="sr-only">
                                    {l.status === "OK" ? "Block" : "Release"} lot {l.lotCode}
                                  </span>
                                </Button>
                              </PermissionGate>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="certificates" className="mt-4">
          {certStates.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No supplier certificate is expired or expiring within 30 days.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Certificate</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {certStates.map(({ cert, supplier, state }) => (
                    <TableRow key={cert.id}>
                      <TableCell className="font-medium">
                        {supplier?.name ?? "Unknown supplier"}
                      </TableCell>
                      <TableCell>{cert.kind}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {cert.reference ?? "—"}
                      </TableCell>
                      <TableCell>{cert.expiresOn}</TableCell>
                      <TableCell
                        className={`text-right tabular-nums font-medium ${
                          state.state === "expired" ? "text-status-danger" : "text-status-warning"
                        }`}
                      >
                        {state.daysLeft! < 0
                          ? `${Math.abs(state.daysLeft!)} overdue`
                          : state.daysLeft}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {tracing && (
        <TraceDialog
          lot={tracing}
          productName={productName.get(tracing.productId) ?? "Unknown"}
          onClose={() => setTracing(null)}
        />
      )}

      {blocking && (
        <BlockDialog
          lot={blocking}
          onClose={() => setBlocking(null)}
          onDone={async () => {
            setBlocking(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function SummaryCard({
  title,
  value,
  hint,
  danger,
}: {
  title: string;
  value: number;
  hint: string;
  danger?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={`text-2xl font-semibold ${danger ? "text-status-danger" : ""}`}
        >
          {value}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function TraceDialog({
  lot,
  productName,
  onClose,
}: {
  lot: StockLot;
  productName: string;
  onClose: () => void;
}) {
  const steps = traceBack(lot);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{productName}</DialogTitle>
          <DialogDescription>
            One step back, as Regulation 178/2002 Article 18 requires: who
            supplied this and against which delivery.
          </DialogDescription>
        </DialogHeader>
        <dl className="space-y-3">
          {steps.map((s) => (
            <div key={s.label} className="flex gap-4">
              <dt className="w-48 shrink-0 text-sm text-muted-foreground">
                {s.label}
              </dt>
              <dd
                className={`text-sm ${
                  /Not recorded|required for traceability/.test(s.detail)
                    ? "text-status-warning"
                    : ""
                }`}
              >
                {s.label === "Temperature on receipt" &&
                  lot.receiptTemperatureC !== null && (
                    <Thermometer className="mr-1 inline size-3.5" />
                  )}
                {s.detail}
              </dd>
            </div>
          ))}
        </dl>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BlockDialog({
  lot,
  onClose,
  onDone,
}: {
  lot: StockLot;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const releasing = lot.status !== "OK";
  const [status, setStatus] = useState<StockLot["status"]>(
    releasing ? "OK" : "RECALLED",
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await setLotStatus(lot.id, status, reason.trim() || null);
      toast.success(
        status === "OK"
          ? `Lot ${lot.lotCode} released`
          : `Lot ${lot.lotCode} marked ${status.toLowerCase()}`,
        {
          description:
            status === "OK"
              ? undefined
              : "It can no longer be used or transferred. Waste and returns are still allowed.",
        },
      );
      await onDone();
    } catch (err) {
      toast.error("Could not change the lot", {
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
          <DialogTitle>
            {releasing ? "Release" : "Stop"} lot {lot.lotCode}
          </DialogTitle>
          <DialogDescription>
            {releasing
              ? "Returning this lot to use."
              : "Stopping a lot prevents it being used or transferred anywhere in the system, not just on this screen."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="lot-status">Status</Label>
            <select
              id="lot-status"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value as StockLot["status"])}
            >
              <option value="OK">Usable</option>
              <option value="BLOCKED">On hold — pending a decision</option>
              <option value="RECALLED">Recalled — supplier or authority</option>
              <option value="WITHDRAWN">Withdrawn by us</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lot-reason">Reason</Label>
            <Textarea
              id="lot-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                status === "RECALLED" ? "Recall notice reference" : "What happened"
              }
            />
          </div>

          {status === "RECALLED" && (
            <div className="flex gap-2 rounded-lg border border-status-warning bg-status-warning-soft p-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-status-warning" />
              <span>
                Article 19 also requires the competent authority to be informed
                when food you have placed on the market may be unsafe. This
                system does not do that for you.
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {status === "OK" ? "Release" : "Stop this lot"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
