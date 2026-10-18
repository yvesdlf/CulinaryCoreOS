// ---------------------------------------------------------------------------
// What is on the packet
// ---------------------------------------------------------------------------
// A product can carry several barcodes and that is not an edge case: the case
// barcode and the unit barcode are different numbers for different things,
// and a venue buying the same ingredient from two suppliers has two. So each
// one says what it is on, and one of them is the primary — the number a label
// prints.
//
// The form does not validate the check digit itself. The database does, and
// the refusal comes back in its own words: a transposed pair in a thirteen
// digit number is the mistake people actually make, and "the check digit does
// not add up" tells somebody to read it again, where "invalid barcode" tells
// them the app is broken.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { ScanBarcode, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useCanWriteSection } from "@/stores/access-store";
import {
  fetchBarcodes, addBarcode, removeBarcode,
  type ProductBarcode, type BarcodeKind,
} from "@/data/labels";

function said(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^\w+(\([^)]*\))? failed: /, "");
}

const KINDS: { value: BarcodeKind; label: string }[] = [
  { value: "EAN13", label: "EAN-13 (13 digits)" },
  { value: "EAN8", label: "EAN-8 (8 digits)" },
  { value: "UPCA", label: "UPC-A (12 digits)" },
  { value: "CODE128", label: "Code 128" },
  { value: "QR", label: "QR code" },
  { value: "INTERNAL", label: "Our own number" },
];

export function BarcodePanel({ productId }: { productId: string }) {
  const canWrite = useCanWriteSection("RECIPES");
  const [rows, setRows] = useState<ProductBarcode[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<BarcodeKind>("EAN13");
  const [describes, setDescribes] = useState("");

  const load = useCallback(async () => {
    try {
      setRows(await fetchBarcodes(productId));
    } catch (err) {
      toast.error("Could not load barcodes", { description: said(err) });
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <EmptyState icon={ScanBarcode} title="No barcode recorded">
          With one here, scanning the packet during a count or a delivery finds
          this product instead of somebody searching for it by name.
        </EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Barcode</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>On what</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((b) => (
              <TableRow key={b.id}>
                <TableCell>
                  <code className="text-sm">{b.barcode}</code>
                  {b.isPrimary && (
                    <Badge variant="outline" className="ml-2">prints on labels</Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {KINDS.find((k) => k.value === b.kind)?.label ?? b.kind}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {b.describes ?? "—"}
                </TableCell>
                <TableCell className="text-right">
                  {canWrite && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove the barcode ${b.barcode}`}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await removeBarcode(b.id);
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

      {canWrite && (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="bc-code">Barcode</Label>
            <Input
              id="bc-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Scan it, or type it"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bc-kind">Kind</Label>
            <select
              id="bc-kind"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value as BarcodeKind)}
            >
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="bc-describes">On what</Label>
            <Input
              id="bc-describes"
              value={describes}
              onChange={(e) => setDescribes(e.target.value)}
              placeholder="A case of twelve"
            />
          </div>
          <Button
            disabled={busy || code.trim() === ""}
            onClick={async () => {
              setBusy(true);
              try {
                await addBarcode({
                  productId,
                  barcode: code.trim(),
                  kind,
                  describes: describes.trim() || null,
                });
                setCode(""); setDescribes("");
                await load();
              } catch (err) {
                // The database's own words. "The check digit does not add up"
                // tells somebody to read the number again; "invalid barcode"
                // tells them the app is broken.
                toast.error("Not added", { description: said(err) });
              } finally { setBusy(false); }
            }}
          >
            Add
          </Button>
        </div>
      )}
    </div>
  );
}
