// ---------------------------------------------------------------------------
// Reporting, checks and rooms — the floor's three jobs in the staff portal
// ---------------------------------------------------------------------------
// Written for a phone held in a wet hand: one job per card, large targets,
// and the database's own words when it says no. Every rule is the database's
// (0084) — who may do what, whether a reading is a breach, whether a room may
// be released — so nothing here decides anything; it asks and reports.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BedDouble, ClipboardCheck, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import {
  fetchFloorRequestTypes, fetchFloorRequests, raiseFloorRequest,
  fetchFloorForms, fetchFloorChecksToday, recordFloorCheck,
  fetchFloorRooms, fetchRoomsToInspect, startFloorRoom, finishFloorRoom, inspectFloorRoom,
  type FloorRequestType, type FloorRequest, type FloorForm, type FloorCheck,
  type FloorRoom, type RoomToInspect,
} from "@/data/repository";

/** The database's message, without the data layer's "operation failed:" prefix. */
function said(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^\w+(\([^)]*\))? failed: /, "");
}

const selectClass = "h-11 w-full rounded-md border bg-transparent px-3 text-base";

// ── Report a fault or raise a request ────────────────────────────────────────

export function ReportTab() {
  const [types, setTypes] = useState<FloorRequestType[]>([]);
  const [mine, setMine] = useState<FloorRequest[]>([]);
  const [typeId, setTypeId] = useState("");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [t, m] = await Promise.all([fetchFloorRequestTypes(), fetchFloorRequests()]);
      setTypes(t); setMine(m);
      setTypeId((current) => current || t[0]?.id || "");
    } catch (err) {
      toast.error("Could not load requests", { description: said(err) });
    }
  }
  useEffect(() => { void load(); }, []);

  const chosen = types.find((t) => t.id === typeId);

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border p-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Megaphone className="size-4" aria-hidden="true" />Report something
        </h2>
        <div className="space-y-2">
          <Label htmlFor="fl-type">What kind</Label>
          <select id="fl-type" className={selectClass} value={typeId}
            onChange={(e) => setTypeId(e.target.value)}>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {chosen?.unitName && (
            <p className="text-sm text-muted-foreground">Goes to {chosen.unitName}.</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="fl-title">What is wrong</Label>
          <Input id="fl-title" className="h-11 text-base" value={title}
            placeholder="Fridge 2 is leaking" onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fl-detail">More detail (optional)</Label>
          <Textarea id="fl-detail" value={detail} onChange={(e) => setDetail(e.target.value)} />
        </div>
        <Button className="h-11 w-full text-base" disabled={busy || !typeId || title.trim() === ""}
          onClick={async () => {
            setBusy(true);
            try {
              await raiseFloorRequest({ typeId, title, detail: detail || null, priority: null });
              toast.success("Sent", { description: chosen?.unitName ? `To ${chosen.unitName}.` : undefined });
              setTitle(""); setDetail("");
              await load();
            } catch (err) {
              toast.error("Not sent", { description: said(err) });
            } finally { setBusy(false); }
          }}>Send</Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">What you have reported</h3>
        {mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        ) : mine.map((r) => (
          <div key={r.id} className="rounded-lg border p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium">{r.title}</p>
              <Badge variant="outline">{r.status.toLowerCase().replace(/_/g, " ")}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {[r.reference, r.unitName].filter(Boolean).join(" · ")}
            </p>
            {r.resolution && <p className="mt-1 text-sm">{r.resolution}</p>}
          </div>
        ))}
      </section>
    </div>
  );
}

// ── HACCP checks ─────────────────────────────────────────────────────────────

export function ChecksTab() {
  const [forms, setForms] = useState<FloorForm[]>([]);
  const [done, setDone] = useState<FloorCheck[]>([]);
  const [formId, setFormId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [action, setAction] = useState("");
  const [needsAction, setNeedsAction] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [f, d] = await Promise.all([fetchFloorForms(), fetchFloorChecksToday()]);
      setForms(f); setDone(d);
      setFormId((current) => current || f[0]?.id || "");
    } catch (err) {
      toast.error("Could not load checks", { description: said(err) });
    }
  }
  useEffect(() => { void load(); }, []);

  const form = forms.find((f) => f.id === formId);

  if (forms.length === 0) {
    return <EmptyState icon={ClipboardCheck} title="No checks set for you">
      Your manager sets which checks you do. When there are some, they appear here.
    </EmptyState>;
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border p-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <ClipboardCheck className="size-4" aria-hidden="true" />Record a check
        </h2>
        <div className="space-y-2">
          <Label htmlFor="fl-form">Which check</Label>
          <select id="fl-form" className={selectClass} value={formId}
            onChange={(e) => { setFormId(e.target.value); setValues({}); setNeedsAction(null); }}>
            {forms.map((f) => <option key={f.id} value={f.id}>{f.title}{f.isCcp ? " (CCP)" : ""}</option>)}
          </select>
        </div>
        {form?.fields.map((f) => (
          <div key={f.label} className="space-y-2">
            <Label htmlFor={`fl-${f.label}`}>
              {f.label}{f.unit ? ` (${f.unit})` : ""}
              {(f.min !== null || f.max !== null) && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  limit {f.min ?? "–"} to {f.max ?? "–"}
                </span>
              )}
            </Label>
            {f.type === "yes_no" ? (
              <select id={`fl-${f.label}`} className={selectClass} value={values[f.label] ?? ""}
                onChange={(e) => setValues({ ...values, [f.label]: e.target.value })}>
                <option value="">Choose</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            ) : (
              <Input id={`fl-${f.label}`} className="h-11 text-base"
                inputMode={f.type === "number" ? "decimal" : undefined}
                value={values[f.label] ?? ""}
                onChange={(e) => setValues({ ...values, [f.label]: e.target.value })} />
            )}
          </div>
        ))}
        {needsAction && (
          <div className="space-y-2 rounded-lg border border-status-warning bg-status-warning-soft p-3">
            <p className="text-sm font-medium">{needsAction}</p>
            <Label htmlFor="fl-action">What did you do about it?</Label>
            <Textarea id="fl-action" value={action} onChange={(e) => setAction(e.target.value)}
              placeholder="Moved stock to fridge 1 and told the chef" />
          </div>
        )}
        <Button className="h-11 w-full text-base" disabled={busy || !form}
          onClick={async () => {
            if (!form) return;
            setBusy(true);
            try {
              const result = await recordFloorCheck({
                formId: form.id, values, correctiveAction: action || null,
              });
              if (result.breach) toast.warning("Recorded as out of limits", { description: result.detail });
              else toast.success("Recorded");
              setValues({}); setAction(""); setNeedsAction(null);
              await load();
            } catch (err) {
              const message = said(err);
              // The database names the reading and asks for the action; ask here.
              if (/out of limits/i.test(message)) setNeedsAction(message.replace(/ Say what you did about it\.?$/, ""));
              else toast.error("Not recorded", { description: message });
            } finally { setBusy(false); }
          }}>{needsAction ? "Record with action" : "Record"}</Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Your checks today</h3>
        {done.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet today.</p>
        ) : done.map((c) => (
          <div key={c.id} className="flex items-start justify-between gap-2 rounded-lg border p-3">
            <div>
              <p className="font-medium">{c.title}</p>
              {c.breachDetail && <p className="text-sm text-status-warning">{c.breachDetail}</p>}
            </div>
            <Badge variant={c.breach ? "destructive" : "outline"}>{c.breach ? "out of limits" : "ok"}</Badge>
          </div>
        ))}
      </section>
    </div>
  );
}

// ── Rooms ────────────────────────────────────────────────────────────────────

export function RoomsTab() {
  const [mine, setMine] = useState<FloorRoom[]>([]);
  const [toInspect, setToInspect] = useState<RoomToInspect[]>([]);
  const [failing, setFailing] = useState<RoomToInspect | null>(null);
  const [findings, setFindings] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      const [m, i] = await Promise.all([fetchFloorRooms(), fetchRoomsToInspect()]);
      setMine(m); setToInspect(i);
    } catch (err) {
      toast.error("Could not load rooms", { description: said(err) });
    }
  }
  useEffect(() => { void load(); }, []);

  async function act(id: string, job: () => Promise<void>) {
    setBusy(id);
    try { await job(); await load(); }
    catch (err) { toast.error("Not done", { description: said(err) }); }
    finally { setBusy(null); }
  }

  if (mine.length === 0 && toInspect.length === 0) {
    return <EmptyState icon={BedDouble} title="No rooms for you today">
      Rooms on your sheet, and rooms waiting for inspection, appear here.
    </EmptyState>;
  }

  return (
    <div className="space-y-6">
      {mine.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Your rooms today</h2>
          {mine.map((r) => (
            <div key={r.taskId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              <div>
                <p className="text-lg font-semibold tabular-nums">Room {r.roomNumber ?? "—"}</p>
                <p className="text-sm text-muted-foreground">
                  {r.kind.toLowerCase().replace(/_/g, " ")} · {r.standardMinutes} min · {r.status.toLowerCase().replace(/_/g, " ")}
                </p>
              </div>
              {r.status === "PENDING" && (
                <Button className="h-11 min-w-28" disabled={busy !== null}
                  onClick={() => act(r.taskId, () => startFloorRoom(r.taskId))}>Start</Button>
              )}
              {(r.status === "PENDING" || r.status === "IN_PROGRESS") && (
                <Button className="h-11 min-w-28" variant={r.status === "IN_PROGRESS" ? "default" : "outline"}
                  disabled={busy !== null}
                  onClick={() => act(r.taskId, async () => {
                    const result = await finishFloorRoom(r.taskId);
                    if (result.released) toast.success(`Room ${r.roomNumber ?? ""} is clean`);
                    else toast.warning("Done, but the room stays closed", { description: result.reason ?? undefined });
                  })}>Clean</Button>
              )}
            </div>
          ))}
        </section>
      )}

      {toInspect.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Waiting for inspection</h2>
          {toInspect.map((r) => (
            <div key={r.taskId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              <div>
                <p className="text-lg font-semibold tabular-nums">Room {r.roomNumber ?? "—"}</p>
                <p className="text-sm text-muted-foreground">Cleaned by {r.cleanedBy ?? "somebody"}</p>
              </div>
              <div className="flex gap-2">
                <Button className="h-11 min-w-24" disabled={busy !== null}
                  onClick={() => act(r.taskId, async () => {
                    await inspectFloorRoom({ taskId: r.taskId, passed: true, findings: null });
                    toast.success(`Room ${r.roomNumber ?? ""} passed`);
                  })}>Pass</Button>
                <Button className="h-11 min-w-24" variant="outline" disabled={busy !== null}
                  onClick={() => { setFailing(r); setFindings(""); }}>Fail</Button>
              </div>
              {failing?.taskId === r.taskId && (
                <div className="w-full space-y-2">
                  <Label htmlFor="fl-findings">What needs putting right</Label>
                  <Textarea id="fl-findings" value={findings} onChange={(e) => setFindings(e.target.value)} />
                  <Button className="h-11" variant="destructive" disabled={busy !== null || findings.trim() === ""}
                    onClick={() => act(r.taskId, async () => {
                      await inspectFloorRoom({ taskId: r.taskId, passed: false, findings });
                      setFailing(null);
                      toast.success(`Room ${r.roomNumber ?? ""} sent back`);
                    })}>Send back</Button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
