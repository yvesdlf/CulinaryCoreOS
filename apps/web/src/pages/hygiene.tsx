// ---------------------------------------------------------------------------
// Hygiene — HACCP control forms
// ---------------------------------------------------------------------------
// The venue's own control sheets, numbered as their paperwork numbers them, so
// an inspector asking for 3.1 finds 3.1.
//
// The thing worth building here is not the form. It is the answer to "what has
// not been done", because a folder of neatly completed sheets with three
// missing days is exactly what an audit finds and nobody notices in advance.
// Critical control points lead, because a missed temperature record is a
// different order of problem from a missed chemical stock take.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { ClipboardList, TriangleAlert, ShieldCheck, Check, FileUp } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { PermissionGate } from "@/components/shared/permission-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  fetchHaccpForms, fetchHaccpRecords, recordHaccp, verifyHaccpRecord,
  type HaccpForm, type HaccpRecord,
} from "@/data/repository";
import { isSupabaseConfigured } from "@/lib/supabase";
import { HaccpImportDialog } from "@/components/hygiene/haccp-import-dialog";
import { checkFieldLimits, type HaccpField } from "@/engine/haccp-import";

/** How long a form of each rhythm may go before it is overdue. */
const GRACE_DAYS: Record<string, number> = {
  PER_SHIFT: 1, DAILY: 1, WEEKLY: 7, MONTHLY: 31,
  QUARTERLY: 92, ANNUAL: 366, AS_NEEDED: 3650,
};

function isOverdue(f: HaccpForm): boolean {
  if (f.frequency === "AS_NEEDED") return false;
  return (f.daysSince ?? 9999) > (GRACE_DAYS[f.frequency] ?? 1);
}

export function HygienePage() {
  const [forms, setForms] = useState<HaccpForm[]>([]);
  const [records, setRecords] = useState<HaccpRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filling, setFilling] = useState<HaccpForm | null>(null);

  async function load() {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    setLoading(true);
    try {
      const [f, r] = await Promise.all([fetchHaccpForms(), fetchHaccpRecords()]);
      setForms(f); setRecords(r);
    } catch (err) {
      toast.error("Could not load the control forms", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const overdue = useMemo(() => forms.filter(isOverdue), [forms]);
  const overdueCcp = overdue.filter((f) => f.isCcp);
  const openBreaches = records.filter((r) => r.breach && !r.verifiedByEmail);

  const bySection = useMemo(() => {
    const m = new Map<string, HaccpForm[]>();
    for (const f of forms) m.set(f.section, [...(m.get(f.section) ?? []), f]);
    return [...m.entries()];
  }, [forms]);

  return (
    <div>
      <PageHeader
        title="Hygiene"
        description="The kitchen's HACCP control sheets, and what has not been filled in."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Critical points overdue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-semibold ${overdueCcp.length > 0 ? "text-status-danger" : ""}`}>
              {overdueCcp.length}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Temperature, pH and CCP monitoring
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              All forms overdue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{overdue.length}</div>
            <p className="mt-1 text-xs text-muted-foreground">of {forms.length} kept</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Breaches unverified
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-semibold ${openBreaches.length > 0 ? "text-status-warning" : ""}`}>
              {openBreaches.length}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Recorded, not yet countersigned
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="due" className="mt-6">
        <TabsList>
          <TabsTrigger value="due">
            <TriangleAlert className="size-4" />Due ({overdue.length})
          </TabsTrigger>
          <TabsTrigger value="forms">
            <ClipboardList className="size-4" />All forms ({forms.length})
          </TabsTrigger>
          <TabsTrigger value="records">Records ({records.length})</TabsTrigger>
          <TabsTrigger value="templates">
            <FileUp className="size-4" />Templates
          </TabsTrigger>
        </TabsList>

        <TabsContent value="due" className="mt-4">
          {loading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
          ) : overdue.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nothing overdue. Forms appear here once they pass their rhythm.
            </p>
          ) : (
            <FormTable forms={overdue} onFill={setFilling} showDue />
          )}
        </TabsContent>

        <TabsContent value="forms" className="mt-4 space-y-6">
          {bySection.map(([section, list]) => (
            <div key={section}>
              <h2 className="mb-2 text-sm font-medium">{section}</h2>
              <FormTable forms={list} onFill={setFilling} />
            </div>
          ))}
        </TabsContent>

        <TabsContent value="records" className="mt-4">
          {records.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nothing recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Form</TableHead>
                    <TableHead>Covers</TableHead>
                    <TableHead>Where</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead className="w-px" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((r) => {
                    const form = forms.find((f) => f.id === r.formId);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">
                          {form?.code ?? "—"} {form?.title}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.coversDate}{r.shift && ` · ${r.shift}`}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.location ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.completedByEmail}
                        </TableCell>
                        <TableCell className="max-w-md whitespace-normal text-sm">
                          {r.breach ? (
                            <>
                              <span className="font-medium text-status-danger">
                                {r.breachDetail}
                              </span>
                              <div className="text-xs text-muted-foreground">
                                {r.correctiveAction}
                              </div>
                            </>
                          ) : (
                            <span className="text-status-success">within limits</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {r.verifiedByEmail ? (
                            <span className="inline-flex items-center gap-1 text-xs text-status-success">
                              <ShieldCheck className="size-3" />countersigned
                            </span>
                          ) : (
                            <PermissionGate>
                              <Button size="sm" variant="ghost" onClick={async () => {
                                await verifyHaccpRecord(r.id);
                                toast.success("Countersigned");
                                await load();
                              }}>
                                <Check className="size-4" />Verify
                              </Button>
                            </PermissionGate>
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
        <TabsContent value="templates" className="mt-4 space-y-4">
          <div className="rounded-lg border p-4">
            <h2 className="text-sm font-medium">Bring in your own control sheets</h2>
            <p className="mb-3 mt-1 max-w-3xl text-sm text-muted-foreground">
              A venue's HACCP paperwork is its own, and it changes after every
              audit. Upload a sheet listing the forms you keep and what each one
              asks for — repeat the form's code down the rows and add one field
              per row. A form whose code already exists is replaced, so a
              revised sheet is an upload rather than a support request.
            </p>
            <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
              Give a number field a <strong>min</strong> or <strong>max</strong>{" "}
              and the app checks the reading against it when the form is filled
              in. That is the difference between paperwork and a control: a
              chiller log that knows 5 °C is the limit flags 9,2 °C on its own,
              rather than waiting for a tired cook to tick a box at eleven at
              night.
            </p>
            <PermissionGate>
              <HaccpImportDialog forms={forms} onImported={load} />
            </PermissionGate>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Code</TableHead>
                  <TableHead>Form</TableHead>
                  <TableHead>Section</TableHead>
                  <TableHead>Asks for</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {forms.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-mono text-xs">{f.code}</TableCell>
                    <TableCell className="font-medium">{f.title}</TableCell>
                    <TableCell className="text-muted-foreground">{f.section}</TableCell>
                    <TableCell className="max-w-lg whitespace-normal text-xs text-muted-foreground">
                      {f.fields.length === 0
                        ? "one free-text note"
                        : f.fields.map((x) => x.label).join(", ")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {filling && (
        <FillDialog form={filling} onClose={() => setFilling(null)}
          onDone={async () => { setFilling(null); await load(); }} />
      )}
    </div>
  );
}

function FormTable({ forms, onFill, showDue }: {
  forms: HaccpForm[]; onFill: (f: HaccpForm) => void; showDue?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">Code</TableHead>
            <TableHead>Form</TableHead>
            <TableHead>Rhythm</TableHead>
            <TableHead>Last done</TableHead>
            {showDue && <TableHead>Overdue by</TableHead>}
            <TableHead className="w-px" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {forms.map((f) => (
            <TableRow key={f.id}>
              <TableCell className="font-mono text-xs">{f.code}</TableCell>
              <TableCell>
                <span className="font-medium">{f.title}</span>
                {f.isCcp && (
                  <span className="ml-2 rounded-full bg-status-danger-soft px-2 py-0.5 text-xs text-status-danger">
                    critical
                  </span>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {f.frequency.toLowerCase().replace("_", " ")}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {f.lastCompleted ?? "never"}
              </TableCell>
              {showDue && (
                <TableCell className={f.isCcp ? "text-status-danger" : "text-status-warning"}>
                  {f.lastCompleted ? `${f.daysSince} days` : "never done"}
                </TableCell>
              )}
              <TableCell>
                <PermissionGate>
                  <Button size="sm" variant="ghost" onClick={() => onFill(f)}>
                    Fill in
                  </Button>
                </PermissionGate>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function FillDialog({ form, onClose, onDone }: {
  form: HaccpForm; onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const [coversDate, setCoversDate] = useState(new Date().toISOString().slice(0, 10));
  const [shift, setShift] = useState("");
  const [location, setLocation] = useState("");
  const [reading, setReading] = useState("");
  const [note, setNote] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [tickedBreach, setTickedBreach] = useState(false);
  const [breachDetail, setBreachDetail] = useState("");
  const [action, setAction] = useState("");
  const [busy, setBusy] = useState(false);

  /*
   * What the form itself says is out of limits.
   *
   * Derived rather than asked. A form that carries its limits should not need
   * a person to notice that 9,2 is more than 5 at the end of a double shift —
   * that noticing is the entire job of a control sheet, and the one thing a
   * computer does better than a tired cook.
   */
  const detected = form.fields
    .map((f) => checkFieldLimits(f, values[f.label] ?? ""))
    .filter((x): x is string => x !== null);

  // Still tickable: a form can be breached in ways it does not measure — a
  // delivery van that was warm, a probe that read nothing because it was
  // broken. Removing the tick would lose those.
  const breach = tickedBreach || detected.length > 0;
  const detail = detected.length > 0
    ? [...detected, breachDetail.trim()].filter(Boolean).join(" ")
    : breachDetail.trim();

  // The trigger refuses a breach without an action; say so before the attempt.
  const valid = coversDate !== "" && (!breach || action.trim() !== "");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{form.code} — {form.title}</DialogTitle>
          <DialogDescription>
            {form.isCcp
              ? "A critical control point. A reading outside its limit must record what was done about it."
              : "A record. Note anything outside normal."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="h-date">Covers</Label>
              <Input id="h-date" type="date" value={coversDate}
                onChange={(e) => setCoversDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="h-shift">Shift</Label>
              <Input id="h-shift" value={shift} placeholder="Morning / Evening"
                onChange={(e) => setShift(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="h-loc">Location or area</Label>
              <Input id="h-loc" value={location} placeholder="Walk-in, larder, bar"
                onChange={(e) => setLocation(e.target.value)} />
            </div>
          </div>

          {form.fields.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {form.fields.map((f) => (
                <FieldInput
                  key={f.label}
                  field={f}
                  value={values[f.label] ?? ""}
                  onChange={(v) => setValues((prev) => ({ ...prev, [f.label]: v }))}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="h-reading">Reading or result</Label>
              <Input id="h-reading" value={reading}
                placeholder={form.isCcp ? "e.g. 3,4 °C or pH 4,1" : "What was checked"}
                onChange={(e) => setReading(e.target.value)} />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="h-note">Notes</Label>
            <Textarea id="h-note" rows={2} value={note}
              onChange={(e) => setNote(e.target.value)} />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={tickedBreach}
              disabled={detected.length > 0}
              onChange={(e) => setTickedBreach(e.target.checked)} />
            Something was outside its limit
            {detected.length > 0 && (
              <span className="text-xs text-muted-foreground">
                — the readings already say so
              </span>
            )}
          </label>

          {breach && (
            <div className="space-y-3 rounded-lg border border-status-danger bg-status-danger-soft p-3">
              {detected.length > 0 && (
                <ul className="space-y-1 text-sm font-medium text-status-danger">
                  {detected.map((d) => (
                    <li key={d} className="flex gap-2">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      {d}
                    </li>
                  ))}
                </ul>
              )}
              <div className="space-y-2">
                <Label htmlFor="h-breach">
                  {detected.length > 0 ? "Anything else" : "What was wrong"}
                </Label>
                <Input id="h-breach" value={breachDetail}
                  placeholder="Walk-in at 9,2 °C against a 5 °C limit"
                  onChange={(e) => setBreachDetail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="h-action">What was done about it</Label>
                <Textarea id="h-action" rows={2} value={action}
                  placeholder="Stock moved, engineer called, product held above 8 °C for over 2h discarded"
                  onChange={(e) => setAction(e.target.value)} />
                <p className="text-xs">
                  Required. A recorded breach with no corrective action is
                  evidence you knew.
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button disabled={!valid || busy} onClick={async () => {
            setBusy(true);
            try {
              await recordHaccp({
                formId: form.id, coversDate,
                shift: shift.trim() || null, location: location.trim() || null,
                values: form.fields.length > 0
                  ? { ...values, note: note.trim() }
                  : { reading: reading.trim(), note: note.trim() },
                breach, breachDetail: detail || null,
                correctiveAction: action.trim() || null,
              });
              toast.success(`${form.code} recorded`);
              await onDone();
            } catch (err) {
              toast.error("Could not record it", {
                description: err instanceof Error ? err.message : String(err),
              });
            } finally { setBusy(false); }
          }}>Record</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/*
 * One field of a form, rendered as what it is.
 *
 * The limits are shown beside the label rather than only enforced. Somebody
 * reading 6 °C on a chiller with a 5 °C limit should see they are about to
 * record a breach before they record it, not discover it in a red panel
 * afterwards.
 */
function FieldInput({ field, value, onChange }: {
  field: HaccpField;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = `h-field-${field.label.replace(/\s+/g, "-").toLowerCase()}`;
  const limits =
    field.min !== null && field.max !== null ? `${field.min}–${field.max}`
    : field.min !== null ? `at least ${field.min}`
    : field.max !== null ? `at most ${field.max}`
    : null;
  const outOfLimits = checkFieldLimits(field, value) !== null;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {field.label}
        {(limits || field.unit) && (
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            {limits ? `${limits}${field.unit ? ` ${field.unit}` : ""}` : field.unit}
          </span>
        )}
      </Label>
      {field.type === "yes_no" ? (
        <label className="flex h-8 items-center gap-2 text-sm">
          <input
            id={id}
            type="checkbox"
            checked={value === "yes"}
            onChange={(e) => onChange(e.target.checked ? "yes" : "no")}
          />
          {value === "yes" ? "Yes" : "No"}
        </label>
      ) : (
        <Input
          id={id}
          type={field.type === "number" ? "text" : field.type === "time" ? "time" : field.type === "date" ? "date" : "text"}
          inputMode={field.type === "number" ? "decimal" : undefined}
          value={value}
          aria-invalid={outOfLimits}
          className={outOfLimits ? "border-status-danger" : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
