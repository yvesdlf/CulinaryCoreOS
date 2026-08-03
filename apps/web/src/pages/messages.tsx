// ---------------------------------------------------------------------------
// Messages — the vendor portal, and the venue's inbox
// ---------------------------------------------------------------------------
// One page serving two audiences, because a person is one or the other. A
// supplier contact is deliberately not a member of the venue's organisation,
// so they see their own orders and nothing else; a member of the venue sees
// the notifications addressed to them.
//
// Which one you get is decided by the database, not by a flag in the browser:
// `auth_supplier_id()` returns a supplier for a contact and null for everybody
// else, and every view behind the portal scopes itself the same way.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { Inbox, PackageCheck, FileText, Check, Mail } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  fetchMySupplierId, fetchPortalOrders, fetchPortalOrderLines, fetchPortalInvoices,
  acknowledgeOrder, fetchNotifications, markNotificationRead,
  type PortalOrder, type Notification,
} from "@/data/repository";
import { isSupabaseConfigured } from "@/lib/supabase";

export function MessagesPage() {
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [orders, setOrders] = useState<PortalOrder[]>([]);
  const [invoices, setInvoices] = useState<
    Awaited<ReturnType<typeof fetchPortalInvoices>>
  >([]);
  const [acking, setAcking] = useState<PortalOrder | null>(null);

  async function load() {
    if (!isSupabaseConfigured) { setResolved(true); return; }
    try {
      const sup = await fetchMySupplierId();
      setSupplierId(sup);
      const [n, o, inv] = await Promise.all([
        fetchNotifications(),
        sup ? fetchPortalOrders() : Promise.resolve([]),
        sup ? fetchPortalInvoices() : Promise.resolve([]),
      ]);
      setNotifications(n); setOrders(o); setInvoices(inv);
    } catch (err) {
      toast.error("Could not load messages", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally { setResolved(true); }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const unread = notifications.filter((n) => !n.readAt);
  const awaitingAck = orders.filter((o) => !o.acknowledgedAt);

  if (!resolved) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div>
      <PageHeader
        title={supplierId ? "Your orders" : "Messages"}
        description={
          supplierId
            ? "Orders placed with you, what has been delivered, and where your invoices stand."
            : "What has happened that needs somebody. Nothing is emailed yet — a channel has not been chosen."
        }
      />

      <Tabs defaultValue={supplierId ? "orders" : "inbox"}>
        <TabsList>
          <TabsTrigger value="inbox">
            <Inbox className="size-4" />
            Inbox ({unread.length})
          </TabsTrigger>
          {supplierId && (
            <>
              <TabsTrigger value="orders">
                <PackageCheck className="size-4" />
                Orders ({orders.length})
              </TabsTrigger>
              <TabsTrigger value="invoices">
                <FileText className="size-4" />
                Invoices ({invoices.length})
              </TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="inbox" className="mt-4">
          {notifications.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nothing yet. Messages appear as requisitions are raised, orders
              go out, deliveries arrive and invoices are checked.
            </p>
          ) : (
            <ul className="space-y-2">
              {notifications.map((n) => (
                <li key={n.id}
                  className={`flex items-start justify-between gap-4 rounded-lg border p-3 ${
                    n.readAt ? "opacity-60" : "bg-muted/40"}`}>
                  <div>
                    <div className="text-sm font-medium">{n.subject}</div>
                    {n.body && (
                      <div className="text-sm text-muted-foreground">{n.body}</div>
                    )}
                    <div className="mt-1 text-xs text-muted-foreground">
                      {new Date(n.createdAt).toLocaleString("en-GB")}
                      {" · "}
                      {n.kind.toLowerCase().replace(/_/g, " ")}
                    </div>
                  </div>
                  {!n.readAt && (
                    <Button size="sm" variant="ghost"
                      onClick={async () => {
                        await markNotificationRead(n.id);
                        await load();
                      }}>
                      <Check className="size-4" />
                      <span className="sr-only">Mark read</span>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {supplierId && (
          <>
            <TabsContent value="orders" className="mt-4 space-y-3">
              {awaitingAck.length > 0 && (
                <p className="rounded-lg border border-status-info bg-status-info-soft p-3 text-sm">
                  {awaitingAck.length} order{awaitingAck.length === 1 ? "" : "s"}{" "}
                  waiting for you to confirm.
                </p>
              )}
              {orders.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  No orders yet.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order</TableHead>
                        <TableHead>From</TableHead>
                        <TableHead>Placed</TableHead>
                        <TableHead>Wanted by</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Confirmed</TableHead>
                        <TableHead className="w-px" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders.map((o) => (
                        <TableRow key={o.id}>
                          <TableCell className="font-mono text-xs">{o.reference}</TableCell>
                          <TableCell>{o.buyerName}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {o.orderedOn ?? "—"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {o.expectedOn ?? "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <CurrencyDisplay value={o.totalAmount} />
                          </TableCell>
                          <TableCell className="text-sm">
                            {o.acknowledgedAt ? (
                              <span className="text-status-success">
                                {o.supplierPromisedOn
                                  ? `for ${o.supplierPromisedOn}`
                                  : "confirmed"}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">not yet</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button size="sm" variant="ghost" onClick={() => setAcking(o)}>
                              {o.acknowledgedAt ? "View" : "Confirm"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="invoices" className="mt-4">
              {invoices.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  No invoices recorded against you yet.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Due</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.map((i) => (
                        <TableRow key={i.id}>
                          <TableCell className="font-mono text-xs">{i.invoiceNumber}</TableCell>
                          <TableCell className="text-muted-foreground">{i.invoiceDate}</TableCell>
                          <TableCell className="text-muted-foreground">{i.dueDate ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            <CurrencyDisplay value={i.totalAmount} />
                          </TableCell>
                          <TableCell className={i.hasQuery ? "text-status-warning" : ""}>
                            {i.status}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </>
        )}
      </Tabs>

      {acking && (
        <AcknowledgeDialog order={acking} onClose={() => setAcking(null)}
          onDone={async () => { setAcking(null); await load(); }} />
      )}
    </div>
  );
}

function AcknowledgeDialog({ order, onClose, onDone }: {
  order: PortalOrder; onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const [lines, setLines] = useState<
    Awaited<ReturnType<typeof fetchPortalOrderLines>>
  >([]);
  const [promisedOn, setPromisedOn] = useState(
    order.supplierPromisedOn ?? order.expectedOn ?? "",
  );
  const [note, setNote] = useState(order.supplierNote ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchPortalOrderLines(order.id).then(setLines).catch(() => setLines([]));
  }, [order.id]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{order.reference} from {order.buyerName}</DialogTitle>
          <DialogDescription>
            Confirm you can supply this, and tell them when.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="max-h-56 overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">Line</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.description ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.quantity} {l.unit}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <CurrencyDisplay value={l.unitPrice} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <CurrencyDisplay value={l.lineTotal} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ack-date">You can deliver on</Label>
              <Input id="ack-date" type="date" value={promisedOn}
                onChange={(e) => setPromisedOn(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ack-note">Anything to tell them</Label>
            <Textarea id="ack-note" rows={2} value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Substitutions, part shipments, price changes" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Close</Button>
          <Button disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              await acknowledgeOrder(order.id, promisedOn || null, note.trim() || null);
              toast.success("Confirmed", {
                description: "They have been told.",
              });
              await onDone();
            } catch (err) {
              toast.error("Could not confirm", {
                description: err instanceof Error ? err.message : String(err),
              });
            } finally { setBusy(false); }
          }}>
            <Mail className="size-4" />
            {order.acknowledgedAt ? "Update" : "Confirm order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
