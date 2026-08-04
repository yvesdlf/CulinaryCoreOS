// ---------------------------------------------------------------------------
// Hygiene template import
// ---------------------------------------------------------------------------
// Same two-step shape as the recipe and price imports: choose a file, read what
// it would do, then decide. Replacing a venue's control sheets from a file
// nobody checked is the same class of mistake as rewriting a thousand prices
// from one — and worse in one respect, because the paperwork is what an
// inspector reads.
//
// The preview leads with the limits, because that is what reveals a misread
// file. A chiller log that imports with no limit on the walk-in still looks
// like a chiller log in a list of titles, and will quietly never flag anything.
// ---------------------------------------------------------------------------

import { useRef, useState } from "react";
import { Upload, TriangleAlert, Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { parseCsv, toCsv, downloadCsv } from "@/lib/csv";
import { planHaccpImport, type HaccpImportPlan } from "@/engine/haccp-import";
import { saveHaccpTemplates, type HaccpForm } from "@/data/repository";

const PREVIEW_ROWS = 12;

/*
 * An example to start from.
 *
 * Offered rather than documented because the shape of the file is most of what
 * anybody needs to know, and a sheet they can open and edit teaches it in one
 * look. The rows are a real form: repeat the code, add one field per row.
 */
const EXAMPLE_ROWS = [
  ["3.8", "Temperature", "Bar Fridge Log", "DAILY", "yes", "Beer fridge", "number", "°C", "0", "5"],
  ["3.8", "", "", "", "", "Wine fridge", "number", "°C", "8", "14"],
  ["3.8", "", "", "", "", "Checked by", "text", "", "", ""],
  ["7.1", "Deliveries", "Goods-In Check", "AS_NEEDED", "no", "Supplier", "text", "", "", ""],
  ["7.1", "", "", "", "", "Temperature on arrival", "number", "°C", "", "5"],
  ["7.1", "", "", "", "", "Packaging intact", "yes/no", "", "", ""],
];

function downloadExample() {
  downloadCsv(
    "hygiene-template-example.csv",
    toCsv(
      ["code", "section", "title", "frequency", "critical", "field", "type", "unit", "min", "max"],
      EXAMPLE_ROWS,
    ),
  );
}

export function HaccpImportDialog({
  forms, onImported,
}: {
  forms: HaccpForm[];
  onImported: () => void | Promise<void>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<HaccpImportPlan | null>(null);
  const [filename, setFilename] = useState("");
  const [applying, setApplying] = useState(false);

  async function handleFile(file: File) {
    const text = await file.text();
    setFilename(file.name);
    setPlan(
      planHaccpImport(parseCsv(text), {
        existing: forms.map((f) => ({ id: f.id, code: f.code })),
      }),
    );
  }

  function reset() {
    setPlan(null);
    setFilename("");
    if (fileInput.current) fileInput.current.value = "";
  }

  async function apply() {
    if (!plan) return;
    setApplying(true);
    try {
      const { created, updated } = await saveHaccpTemplates(plan.forms);
      toast.success(`${created} added, ${updated} replaced`, {
        description: "The forms are live and will start appearing when they fall due.",
      });
      reset();
      await onImported();
    } catch (err) {
      toast.error("Import failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setApplying(false);
    }
  }

  const totalFields = plan?.forms.reduce((n, f) => n + f.fields.length, 0) ?? 0;

  return (
    <div>
      <input
        ref={fileInput}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        aria-label="Hygiene template (CSV)"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => fileInput.current?.click()}>
          <Upload className="mr-1 size-4" aria-hidden="true" />
          Upload template
        </Button>
        <Button variant="ghost" onClick={downloadExample}>
          <Download className="mr-1 size-4" aria-hidden="true" />
          Example sheet
        </Button>
      </div>

      {plan && (
        <div className="mt-4 rounded-lg border p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">
                {filename} — nothing has been saved yet
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {plan.columns?.code && (
                  <>
                    Read <strong>{plan.columns.code}</strong> as the form
                    {plan.columns.field && (
                      <> and <strong>{plan.columns.field}</strong> as its fields</>
                    )}
                    .{" "}
                  </>
                )}
                {plan.forms.length} forms · {totalFields} fields ·{" "}
                {plan.problems.length} not imported
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={reset}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void apply()}
                disabled={plan.forms.length === 0 || applying}
              >
                Save {plan.forms.length} {plan.forms.length === 1 ? "form" : "forms"}
              </Button>
            </div>
          </div>

          {plan.problems.length > 0 && (
            <div
              role="alert"
              className="mb-3 rounded-md border border-status-warning/40 bg-status-warning-soft p-3"
            >
              <p className="flex items-center gap-2 text-sm font-medium text-status-warning">
                <TriangleAlert className="size-4" aria-hidden="true" />
                {plan.problems.length}{" "}
                {plan.problems.length === 1 ? "row" : "rows"} will not be imported
              </p>
              <ul className="mt-2 space-y-1 text-xs text-foreground/80">
                {plan.problems.slice(0, 8).map((p, i) => (
                  <li key={`${p.line}-${i}`}>
                    {p.line > 0 && <>Line {p.line} · </>}
                    {p.code && <>{p.code} — </>}
                    {p.reason}
                  </li>
                ))}
              </ul>
              {plan.problems.length > 8 && (
                <p className="mt-1 text-xs text-foreground/80">
                  and {plan.problems.length - 8} more
                </p>
              )}
            </div>
          )}

          {plan.forms.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Form</TableHead>
                    <TableHead>Section</TableHead>
                    <TableHead>Rhythm</TableHead>
                    <TableHead>Asks for</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plan.forms.slice(0, PREVIEW_ROWS).map((f) => (
                    <TableRow key={f.code}>
                      <TableCell className="font-mono text-xs">{f.code}</TableCell>
                      <TableCell className="font-medium">
                        {f.title}
                        {f.isCcp && (
                          <span className="ml-2 rounded-full bg-status-danger-soft px-2 py-0.5 text-xs text-status-danger">
                            critical
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{f.section}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {f.frequency.toLowerCase().replace("_", " ")}
                      </TableCell>
                      <TableCell className="max-w-md whitespace-normal text-xs text-muted-foreground">
                        {f.fields.length === 0 ? (
                          <span className="text-status-warning">
                            no fields — one free-text note
                          </span>
                        ) : (
                          f.fields.map((x) => {
                            const limits =
                              x.min !== null && x.max !== null ? `${x.min}–${x.max}`
                              : x.min !== null ? `≥ ${x.min}`
                              : x.max !== null ? `≤ ${x.max}`
                              : null;
                            return `${x.label}${limits ? ` (${limits}${x.unit ? ` ${x.unit}` : ""})` : ""}`;
                          }).join(", ")
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {f.existingId ? "replace existing" : "add"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {plan.forms.length > PREVIEW_ROWS && (
            <p className="mt-2 text-xs text-muted-foreground">
              Showing {PREVIEW_ROWS} of {plan.forms.length}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
