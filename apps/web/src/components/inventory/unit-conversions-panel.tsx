// ---------------------------------------------------------------------------
// What a bunch weighs
// ---------------------------------------------------------------------------
// A tab on Inventory, because the question it answers — how much of this is
// that — is a question about quantities, and this is the screen quantities
// live on. Writing one needs Recipes access, because what a bunch weighs is
// a fact about the product rather than about the stock, and the guard in
// 0090 is on RECIPES to match `products` itself.
//
// The list on the right is the point. Costing has never reconciled units
// (0090's header has the detail), so a recipe line asking for a bunch, or
// for kilograms of something priced per gram, could not be costed honestly.
// Those lines are listed here by name so somebody can clear them, rather
// than discovered one dish at a time.
//
// A conversion is only offered for the units actually in dispute: the
// product's own unit and the one the recipe line asked for. Offering a free
// text box invites "pack" against a product measured in grams, which
// resolves nothing and reads as fixed.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { Scale, TriangleAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
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
  fetchUnitConversions, fetchLinesNeedingConversion,
  addUnitConversion, removeUnitConversion,
  type UnitConversionRow, type LineNeedingConversion,
} from "@/data/repository";

function said(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^\w+(\([^)]*\))? failed: /, "");
}

export function UnitConversionsPanel() {
  const canWrite = useCanWriteSection("RECIPES");
  const [conversions, setConversions] = useState<UnitConversionRow[]>([]);
  const [needing, setNeeding] = useState<LineNeedingConversion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fixing, setFixing] = useState<LineNeedingConversion | null>(null);
  const [factor, setFactor] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const [c, n] = await Promise.all([
        fetchUnitConversions(),
        fetchLinesNeedingConversion(),
      ]);
      setConversions(c);
      setNeeding(n);
    } catch (err) {
      toast.error("Could not load conversions", { description: said(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-3">
        <div>
          <h3 className="font-medium">Lines that cannot be costed</h3>
          <p className="text-sm text-muted-foreground">
            The recipe asks for one unit and the product is priced in another,
            and no general rule converts between them. Until one is recorded
            these lines cost nothing, which makes the dish look cheap.
          </p>
        </div>
        {needing.length === 0 ? (
          <EmptyState icon={Scale} title="Every line can be costed">
            No recipe asks for a unit its product cannot be converted to.
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dish</TableHead>
                <TableHead>Ingredient</TableHead>
                <TableHead>Needs</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {needing.map((n) => (
                <TableRow key={n.recipeLineId}>
                  <TableCell className="font-medium">{n.recipeName}</TableCell>
                  <TableCell>{n.productName}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <code className="text-sm">
                      {n.lineUnit ?? "—"} → {n.productUnit ?? "—"}
                    </code>
                  </TableCell>
                  <TableCell className="text-right">
                    {canWrite && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setFixing(n); setFactor(""); setNote(""); }}
                      >
                        Record it
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
          <h3 className="font-medium">Recorded conversions</h3>
          <p className="text-sm text-muted-foreground">
            One row answers both directions. Physics is applied first, so a
            kilogram cannot be redefined here by accident.
          </p>
        </div>
        {conversions.length === 0 ? (
          <EmptyState icon={Scale} title="None recorded">
            A bunch, an egg, a punnet — units no general rule covers.
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Conversion</TableHead>
                <TableHead>Why</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {conversions.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <code className="text-sm">
                      1 {c.fromUnit} = {c.factor} {c.toUnit}
                    </code>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {c.note ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {canWrite && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove the conversion 1 ${c.fromUnit} to ${c.toUnit}`}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await removeUnitConversion(c.id);
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

      <Dialog open={fixing !== null} onOpenChange={(o) => !o && setFixing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>What does one {fixing?.lineUnit} weigh?</DialogTitle>
            <DialogDescription>
              {fixing?.recipeName} asks for {fixing?.productName} by the{" "}
              {fixing?.lineUnit}, and it is priced per {fixing?.productUnit}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="uc-factor">
                1 {fixing?.lineUnit} = how many {fixing?.productUnit}?
              </Label>
              <Input
                id="uc-factor"
                inputMode="decimal"
                value={factor}
                onChange={(e) => setFactor(e.target.value)}
                placeholder="80"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="uc-note">How do you know?</Label>
              <Input
                id="uc-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Weighed five bunches and averaged"
              />
              <p className="text-sm text-muted-foreground">
                A factor with no provenance is one nobody dares correct later.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFixing(null)}>Cancel</Button>
            <Button
              disabled={busy || factor.trim() === "" || !fixing}
              onClick={async () => {
                if (!fixing || !fixing.lineUnit || !fixing.productUnit) return;
                setBusy(true);
                try {
                  await addUnitConversion({
                    productId: fixing.productId,
                    fromUnit: fixing.lineUnit,
                    toUnit: fixing.productUnit,
                    factor: Number(factor),
                    note: note.trim() || null,
                  });
                  toast.success("Recorded");
                  setFixing(null);
                  await load();
                } catch (err) {
                  toast.error("Not recorded", { description: said(err) });
                } finally { setBusy(false); }
              }}
            >
              Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {needing.length > 0 && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground lg:col-span-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Recording a conversion does not re-cost anything on its own yet —
            the resolver exists and is tested, and wiring it into the cost
            engine is a change to every recipe in every venue, which needs its
            own evidence.
          </span>
        </p>
      )}
    </div>
  );
}
