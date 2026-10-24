// ---------------------------------------------------------------------------
// The label that goes on the tub
// ---------------------------------------------------------------------------
// A print view rather than a dialog, because the output is a physical sticker
// and the browser's own print dialog is the only thing in this stack that can
// talk to a printer. Sized for a 70 × 50 mm label, repeated for however many
// copies are wanted, each on its own page.
//
// Three things this page is strict about, all of them for the same reason:
// a printed label is the most confident surface in a kitchen, and it leaves
// the building on the product.
//
//   The allergen list is never presented as complete when any of it is still
//   inferred. Regulation 1169/2011 makes the written allergen name the legal
//   statement; AGENTS.md §8 makes the dangerous failure a *confident*
//   allergen rather than a missing one. Where anything needs checking, the
//   label says so on the sticker — not in a toast the person dismissed
//   before they hit print.
//
//   "No allergens found" is the wording, never "contains no allergens". The
//   first is true of what the catalogue knows. The second is a free-from
//   claim, and that is something a person makes after reading a label.
//
//   Printing is recorded, with the allergens as they were on the day. The
//   catalogue can change and the tub cannot, and a recall needs to know what
//   the sticker said rather than what the product says now.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Printer, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { allergenNames } from "@/lib/allergens";
import {
  fetchPrepLabel, recordLabelPrint, type PrepLabel,
} from "@/data/labels";

function said(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^\w+(\([^)]*\))? failed: /, "");
}

function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    day: "2-digit", month: "short", year: "numeric",
  });
}

export function LabelPrintPage() {
  const { id } = useParams<{ id: string }>();
  const [label, setLabel] = useState<PrepLabel | null>(null);
  const [loading, setLoading] = useState(true);
  const [copies, setCopies] = useState("1");

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setLabel(await fetchPrepLabel(id));
    } catch (err) {
      toast.error("Could not load the label", { description: said(err) });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (!label) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">
          There is no label for this batch — it may have been corrected by a
          later record.
        </p>
        <Button
          variant="outline"
          className="mt-4"
          nativeButton={false}
          render={<Link to="/production" />}
        >
          <ArrowLeft className="mr-1 size-4" aria-hidden="true" />
          Back to production
        </Button>
      </div>
    );
  }

  const count = Math.max(1, Math.min(50, Number(copies) || 1));

  async function print() {
    if (!label) return;
    try {
      // Recorded before the dialog opens, not after: the browser never tells
      // us whether anybody pressed Print, and a label that was printed and
      // not recorded is worse than one recorded and not printed.
      await recordLabelPrint({
        productionRecordId: label.productionRecordId,
        copies: count,
        useBy: label.useBy,
        allergensShown: label.allergens,
        allergensWereUnverified: label.allergensNeedReview,
      });
    } catch (err) {
      toast.error("Not recorded", { description: said(err) });
    }
    window.print();
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex flex-wrap items-end gap-3 print:hidden">
        <Button variant="outline" nativeButton={false} render={<Link to="/production" />}>
          <ArrowLeft className="mr-1 size-4" aria-hidden="true" />
          Back
        </Button>
        <div className="space-y-2">
          <Label htmlFor="copies">Copies</Label>
          <Input
            id="copies"
            className="w-24"
            inputMode="numeric"
            value={copies}
            onChange={(e) => setCopies(e.target.value)}
          />
        </div>
        <Button onClick={() => void print()}>
          <Printer aria-hidden="true" />
          Print {count}
        </Button>
      </div>

      {label.allergensNeedReview && (
        <p className="mb-6 flex items-start gap-2 rounded-lg border border-status-warning/40 bg-status-warning/10 p-3 text-sm print:hidden">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Some of these allergens were worked out from an ingredient name and
            nobody has checked them against a packet
            {label.unverifiedProducts.length > 0 && (
              <> — {label.unverifiedProducts.join(", ")}</>
            )}
            . The label says so, and will keep saying so until somebody
            verifies them. Printing is not blocked: a tub with a cautious
            label is safer than a tub with none.
          </span>
        </p>
      )}

      {Array.from({ length: count }, (_, i) => (
        <article
          key={i}
          className="mx-auto mb-4 break-after-page rounded border border-foreground/30 bg-white p-3 text-black"
          style={{ width: "70mm", minHeight: "50mm" }}
        >
          <p className="text-base font-semibold leading-tight">{label.itemName}</p>
          <p className="mt-1 text-xs">
            Made {longDate(label.madeOn)}
            {label.madeBy && <> · {label.madeBy}</>}
          </p>
          {label.quantityMade !== null && (
            <p className="text-xs">
              {label.quantityMade} {label.unit} ({label.batches}{" "}
              batch{label.batches === 1 ? "" : "es"})
            </p>
          )}

          <p className="mt-2 text-sm font-semibold">
            USE BY {longDate(label.useBy)}
          </p>

          <div className="mt-2 border-t border-black/20 pt-1">
            {/*
              * The written name, never a code or an icon on its own — that is
              * the rule in AGENTS.md §8 and it comes from 1169/2011.
              */}
            <p className="text-xs font-semibold">
              {label.allergens.length === 0
                ? "No allergens found"
                : `Allergens: ${allergenNames(label.allergens).join(", ")}`}
            </p>
            {label.allergens.length === 0 && (
              // Not "contains no allergens". Silence in a catalogue is not a
              // free-from claim, and the difference is the whole of §8.
              <p className="text-[10px] leading-tight">
                in the ingredients recorded for this item
              </p>
            )}
            {label.allergensNeedReview && (
              <p className="text-[10px] font-semibold leading-tight">
                NOT YET VERIFIED — check the ingredient packets
              </p>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
