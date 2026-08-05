// ---------------------------------------------------------------------------
// Who sells this, and for how much
// ---------------------------------------------------------------------------
// A kitchen buys the same thing from whoever has it. The point of keeping three
// vendors for one ingredient is that on the morning one is out of stock, or has
// put its price up, there is somewhere else to go — and that only helps if the
// alternatives, and their prices, are written down before the morning it
// matters.
//
// The column that earns this screen is cost per unit. Two suppliers quoting for
// "butter" may mean a 250 g block and a 5 kg box, and comparing pack prices
// across those is comparing nothing. The database derives the per-unit figure
// on write, so the ranking here is not this component's opinion.
//
// Preference and price are kept apart on purpose. The cheapest is marked, and
// the chosen one is marked, and when they differ the screen says so rather than
// quietly reordering — a venue may buy from the dearer supplier because they
// deliver daily, or because the cheap one failed an audit, and a system that
// silently switched to the lowest price would be wrong about a decision it
// knows nothing about.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { Plus, Star, Trash2, TriangleAlert, Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { COST_DECIMALS } from "@/lib/constants";
import {
  fetchProductSuppliers, saveProductSupplier, setPreferredSupplier,
  removeProductSupplier, fetchSuppliers,
  type ProductSupplierOption, type Supplier,
} from "@/data/repository";
import { isSupabaseConfigured } from "@/lib/supabase";

export function ProductSuppliersPanel({
  productId,
  defaultPackUnit,
}: {
  /** Null while a product is still being created — nothing to link to yet. */
  productId: string | null;
  defaultPackUnit: string;
}) {
  const [options, setOptions] = useState<ProductSupplierOption[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ProductSupplierOption | "new" | null>(null);

  const load = useCallback(async () => {
    if (!productId || !isSupabaseConfigured) { setLoading(false); return; }
    setLoading(true);
    try {
      const [o, s] = await Promise.all([
        fetchProductSuppliers(productId), fetchSuppliers(),
      ]);
      setOptions(o); setSuppliers(s);
    } catch (err) {
      toast.error("Could not load the suppliers", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally { setLoading(false); }
  }, [productId]);

  useEffect(() => { void load(); }, [load]);

  if (!productId) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        Save the product first, then add the suppliers it can be bought from.
      </p>
    );
  }

  const preferred = options.find((o) => o.isPreferred);
  const cheapest = options.find((o) => o.priceRank === 1 && o.pricePerUnit != null);
  const payingMore =
    preferred && cheapest && preferred.id !== cheapest.id &&
    preferred.pricePerUnit != null && cheapest.pricePerUnit != null;

  async function makePreferred(id: string) {
    try {
      await setPreferredSupplier(id);
      await load();
    } catch (err) {
      toast.error("Could not change the supplier", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function remove(option: ProductSupplierOption) {
    try {
      await removeProductSupplier(option.id);
      toast.success(`${option.supplierName} removed`);
      await load();
    } catch (err) {
      toast.error("Could not remove it", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {options.length === 0
            ? "Nobody is linked yet. Add the suppliers this can be bought from and their prices."
            : `${options.length} supplier${options.length === 1 ? "" : "s"}. Orders go to the one marked preferred.`}
        </p>
        <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
          <Plus aria-hidden="true" /> Add a supplier
        </Button>
      </div>

      {payingMore && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-status-warning/40 bg-status-warning-soft p-3 text-sm"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-warning" />
          <p>
            Ordering from {preferred!.supplierName} at{" "}
            <CurrencyDisplay value={preferred!.pricePerUnit!} decimals={COST_DECIMALS} />{" "}
            per {preferred!.packUnit ?? "unit"}, while {cheapest!.supplierName} is{" "}
            <CurrencyDisplay value={cheapest!.pricePerUnit!} decimals={COST_DECIMALS} />.{" "}
            <span className="text-muted-foreground">
              That may be deliberate — delivery days and reliability are not in
              this table.
            </span>
          </p>
        </div>
      )}

      {loading ? (
        <p className="py-6 text-sm text-muted-foreground">Loading…</p>
      ) : options.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead>Their code</TableHead>
                <TableHead>Pack</TableHead>
                <TableHead className="text-right">Pack price</TableHead>
                <TableHead className="text-right">Per unit</TableHead>
                <TableHead>Lead</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {options.map((o) => (
                <TableRow key={o.id} className={o.isPreferred ? "bg-muted/40" : undefined}>
                  <TableCell className="font-medium">
                    {o.supplierName}
                    {o.isPreferred && (
                      <Badge variant="default" className="ml-2">preferred</Badge>
                    )}
                    {o.priceRank === 1 && o.pricePerUnit != null && !o.isPreferred && (
                      <Badge variant="outline" className="ml-2">cheapest</Badge>
                    )}
                    {!o.active && (
                      <Badge variant="outline" className="ml-2">not ordering</Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {o.supplierSku ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {o.packQty != null ? `${o.packQty} ${o.packUnit ?? ""}`.trim() : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {o.packPrice != null
                      ? <CurrencyDisplay value={o.packPrice} />
                      : <span className="text-muted-foreground">not priced</span>}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {o.pricePerUnit != null
                      ? <CurrencyDisplay value={o.pricePerUnit} decimals={COST_DECIMALS} />
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {o.leadTimeDays != null ? `${o.leadTimeDays} d` : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {!o.isPreferred && (
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Order from ${o.supplierName}`}
                          title={`Order from ${o.supplierName}`}
                          onClick={() => void makePreferred(o.id)}
                        >
                          <Star aria-hidden="true" />
                        </Button>
                      )}
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Edit ${o.supplierName}`}
                        onClick={() => setEditing(o)}
                      >
                        <Check aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Remove ${o.supplierName}`}
                        onClick={() => void remove(o)}
                      >
                        <Trash2 aria-hidden="true" className="text-muted-foreground" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {editing && (
        <SupplierLinkDialog
          productId={productId}
          option={editing === "new" ? null : editing}
          suppliers={suppliers}
          alreadyLinked={options.map((o) => o.supplierId)}
          defaultPackUnit={defaultPackUnit}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}
    </div>
  );
}

function SupplierLinkDialog({
  productId, option, suppliers, alreadyLinked, defaultPackUnit, onClose, onSaved,
}: {
  productId: string;
  option: ProductSupplierOption | null;
  suppliers: Supplier[];
  alreadyLinked: string[];
  defaultPackUnit: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [supplierId, setSupplierId] = useState(option?.supplierId ?? "");
  const [sku, setSku] = useState(option?.supplierSku ?? "");
  const [packQty, setPackQty] = useState(option?.packQty?.toString() ?? "");
  const [packUnit, setPackUnit] = useState(option?.packUnit ?? defaultPackUnit);
  const [packPrice, setPackPrice] = useState(option?.packPrice?.toString() ?? "");
  const [leadTime, setLeadTime] = useState(option?.leadTimeDays?.toString() ?? "");
  const [minimum, setMinimum] = useState(option?.minimumOrderQty?.toString() ?? "");
  const [note, setNote] = useState(option?.note ?? "");
  const [busy, setBusy] = useState(false);

  // Editing keeps its own supplier in the list; adding excludes the ones
  // already linked, since the same supplier twice is not a thing.
  const choosable = suppliers.filter(
    (s) => s.id === option?.supplierId || !alreadyLinked.includes(s.id),
  );

  // Shown live, because it is the number the buyer is really entering.
  const perUnit =
    Number(packQty) > 0 && Number(packPrice) > 0
      ? Number(packPrice) / Number(packQty)
      : null;

  async function save() {
    setBusy(true);
    try {
      await saveProductSupplier({
        id: option?.id,
        productId,
        supplierId,
        supplierSku: sku.trim() || null,
        packQty: packQty ? Number(packQty) : null,
        packUnit: packUnit.trim() || null,
        packPrice: packPrice ? Number(packPrice) : null,
        leadTimeDays: leadTime ? Number(leadTime) : null,
        minimumOrderQty: minimum ? Number(minimum) : null,
        note: note.trim() || null,
      });
      toast.success(option ? "Supplier updated" : "Supplier linked");
      await onSaved();
    } catch (err) {
      toast.error("Could not save it", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {option ? `Edit ${option.supplierName}` : "Add a supplier"}
          </DialogTitle>
          <DialogDescription>
            Their code, their pack size and their price. The cost per unit is
            worked out from the last two, and it is what the suppliers get
            compared on.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="ps-supplier">Supplier</Label>
            <select
              id="ps-supplier"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={supplierId}
              disabled={Boolean(option)}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">Choose</option>
              {choosable.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="ps-sku">Their code for it</Label>
            <Input id="ps-sku" value={sku} placeholder="MSY-114"
              onChange={(e) => setSku(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ps-lead">Lead time in days</Label>
            <Input id="ps-lead" type="number" min="0" value={leadTime}
              onChange={(e) => setLeadTime(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="ps-qty">Pack size</Label>
            <div className="flex gap-2">
              <Input id="ps-qty" type="number" min="0" step="any" value={packQty}
                onChange={(e) => setPackQty(e.target.value)} />
              <Input aria-label="Pack unit" className="w-20" value={packUnit}
                onChange={(e) => setPackUnit(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ps-price">Price for one pack</Label>
            <Input id="ps-price" type="number" min="0" step="any" value={packPrice}
              onChange={(e) => setPackPrice(e.target.value)} />
          </div>

          <div className="sm:col-span-2">
            {perUnit != null ? (
              <p className="text-sm">
                That is{" "}
                <span className="font-medium">
                  <CurrencyDisplay value={perUnit} decimals={COST_DECIMALS} />
                </span>{" "}
                per {packUnit || "unit"}.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Enter a pack size and a price to see the cost per unit.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="ps-min">Minimum order</Label>
            <Input id="ps-min" type="number" min="0" step="any" value={minimum}
              onChange={(e) => setMinimum(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ps-note">Note</Label>
            <Input id="ps-note" value={note} placeholder="Delivers Tue and Fri"
              onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !supplierId} onClick={() => void save()}>
            {option ? "Save" : "Link supplier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
