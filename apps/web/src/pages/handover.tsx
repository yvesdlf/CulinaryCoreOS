// ---------------------------------------------------------------------------
// Handover
// ---------------------------------------------------------------------------
// The competitor is WhatsApp. It wins because it takes four seconds and the
// other person definitely reads it, and it loses because nothing is
// searchable, nothing is linked to the job it is about, and whoever comes back
// from four days off has no way to catch up.
//
// So the screen is built to lose as little of the first as possible:
//
//   The summary is one box and everything else is optional. A handover
//   somebody has to think about is a handover that goes back to the phone.
//
//   An item can name the request it is about, and then it is the request —
//   when that is resolved, the handover stops saying it is outstanding without
//   anybody ticking anything.
//
//   Published does not change, and the screen says so before the button is
//   pressed rather than after. A correction is another item, and both stay.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Check, Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { unitOptions } from "@/engine/units";
import { useToday } from "@/lib/today";
import {
  fetchHandovers, fetchHandoverItems, startHandover, updateHandover,
  acknowledgeHandover, addHandoverItem, fetchBusinessUnits, fetchRequests,
  type HandoverRow, type HandoverItem, type HandoverItemKind,
  type BusinessUnit, type RequestRow,
} from "@/data/repository";
import { isSupabaseConfigured } from "@/lib/supabase";

const KIND_LABEL: Record<HandoverItemKind, string> = {
  BROKEN: "Something is broken",
  GUEST: "A guest",
  STOCK: "Stock",
  PEOPLE: "People",
  SAFETY: "Safety",
  NOTE: "Note",
};

/** A fortnight back, which is as far as anybody catches up from. */
function since(today: string): string {
  const d = new Date(today);
  d.setDate(d.getDate() - 13);
  return d.toISOString().slice(0, 10);
}

export function HandoverPage() {
  const today = useToday();
  const [rows, setRows] = useState<HandoverRow[]>([]);
  const [units, setUnits] = useState<BusinessUnit[]>([]);
  const [openRequests, setOpenRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);
  const [reading, setReading] = useState<HandoverRow | null>(null);

  async function reload() {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    setLoading(true);
    try {
      const [h, u, r] = await Promise.all([
        fetchHandovers(since(today)), fetchBusinessUnits(), fetchRequests(),
      ]);
      setRows(h);
      setUnits(u);
      setOpenRequests(r.filter((x) => !["CLOSED", "REJECTED", "RESOLVED"].includes(x.status)));
    } catch (err) {
      toast.error("Could not read the handovers", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, [today]);

  const unread = useMemo(() => rows.filter((r) => r.unread === true), [rows]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Handover"
        description="What the last shift needs the next one to know. One per department per service, and it does not change once it is published."
      >
        <Button onClick={() => setWriting(true)}>
          <Plus aria-hidden="true" />Write one
        </Button>
      </PageHeader>

      {unread.length > 0 && (
        <Card className="border-amber-500/40">
          <CardContent className="flex items-center gap-3 py-4">
            <TriangleAlert className="size-5 text-amber-600" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-medium">
                {unread.length} {unread.length === 1 ? "handover has" : "handovers have"} not
                been read by anybody
              </p>
              <p className="text-muted-foreground">
                {unread.map((r) => `${r.unitName}${r.service ? ` ${r.service}` : ""} (${r.onDate})`).join(", ")}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No handovers in the last fortnight">
          A handover is what the shift that is leaving tells the one arriving —
          what broke, who is unhappy, what ran out. It takes a minute and it is
          the thing somebody reads after four days off.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {rows.map((h) => (
            <Card key={h.id}>
              <CardHeader className="flex-row items-start justify-between gap-4 pb-2">
                <div className="min-w-0">
                  <CardTitle className="text-sm">
                    {h.unitName}{h.service ? ` · ${h.service}` : ""} · {h.onDate}
                  </CardTitle>
                  <p className="pt-1 text-xs text-muted-foreground">
                    {h.status === "DRAFT"
                      ? `Draft by ${h.writtenByEmail ?? "somebody"}`
                      : h.acknowledgedAt
                        ? `Read by ${h.acknowledgedByEmail}`
                        : "Nobody has said they read it"}
                    {h.openItems > 0 && ` · ${h.openItems} still open`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusChip
                    tone={h.status === "DRAFT" ? "neutral" : h.unread ? "warning" : "success"}
                  >
                    {h.status === "DRAFT" ? "Draft" : h.unread ? "Unread" : "Read"}
                  </StatusChip>
                  <Button variant="ghost" size="sm" onClick={() => setReading(h)}>Open</Button>
                </div>
              </CardHeader>
              {h.summary && (
                <CardContent className="pt-0">
                  <p className="whitespace-pre-wrap text-sm">{h.summary}</p>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      {writing && (
        <WriteDialog
          units={units} today={today}
          onClose={() => setWriting(false)}
          onDone={() => { setWriting(false); void reload(); }}
        />
      )}

      {reading && (
        <ReadDialog
          handover={reading}
          openRequests={openRequests}
          onClose={() => setReading(null)}
          onDone={() => { setReading(null); void reload(); }}
        />
      )}
    </div>
  );
}

function WriteDialog({
  units, today, onClose, onDone,
}: {
  units: BusinessUnit[];
  today: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const choices = unitOptions(units);
  const [unitId, setUnitId] = useState(choices[0]?.id ?? "");
  const [service, setService] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(publish: boolean) {
    setBusy(true);
    try {
      const id = await startHandover({
        businessUnitId: unitId,
        onDate: today,
        service: service.trim() || null,
        summary: summary.trim() || null,
      });
      if (publish) await updateHandover(id, { status: "PUBLISHED" });
      toast.success(publish ? "Published" : "Saved as a draft", {
        description: publish
          ? "It does not change now. A correction is another line on it."
          : "Nobody can read it until it is published.",
      });
      onDone();
    } catch (err) {
      toast.error("Could not save it", {
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
          <DialogTitle>Write a handover</DialogTitle>
          <DialogDescription>
            One per department per service. Publishing is one way — after that
            you can add to it, and nothing already on it changes.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ho-unit">Department</Label>
              <select id="ho-unit"
                className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                {choices.length === 0 && <option value="">No open department</option>}
                {choices.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ho-service">Service</Label>
              <Input id="ho-service" value={service} placeholder="Dinner — or leave it for the day"
                onChange={(e) => setService(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ho-summary">How was it</Label>
            <Textarea id="ho-summary" rows={4} value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Quiet service. Two covers walked out on the wait. Dishwasher still making the noise." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="outline" onClick={() => void save(false)}
            disabled={busy || unitId === ""}>Save as a draft</Button>
          <Button onClick={() => void save(true)} disabled={busy || unitId === ""}>
            Publish it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReadDialog({
  handover, openRequests, onClose, onDone,
}: {
  handover: HandoverRow;
  openRequests: RequestRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [items, setItems] = useState<HandoverItem[]>([]);
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<HandoverItemKind>("NOTE");
  const [requestId, setRequestId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchHandoverItems(handover.id).then(setItems).catch(() => setItems([]));
  }, [handover.id]);

  async function add() {
    if (note.trim() === "") return;
    setBusy(true);
    try {
      await addHandoverItem({
        handoverId: handover.id, kind, note: note.trim(),
        requestId: requestId || null,
      });
      setNote(""); setRequestId("");
      setItems(await fetchHandoverItems(handover.id));
      toast.success("Added");
    } catch (err) {
      toast.error("Could not add it", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function acknowledge() {
    setBusy(true);
    try {
      await acknowledgeHandover(handover.id);
      toast.success("Marked as read", { description: "Under your name, with the time." });
      onDone();
    } catch (err) {
      toast.error("Could not mark it read", {
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
            {handover.unitName}{handover.service ? ` · ${handover.service}` : ""}
          </DialogTitle>
          <DialogDescription>
            {handover.onDate} · written by {handover.writtenByEmail ?? "somebody"}
            {handover.acknowledgedAt ? ` · read by ${handover.acknowledgedByEmail}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {handover.summary && (
            <p className="whitespace-pre-wrap text-sm">{handover.summary}</p>
          )}

          {items.length > 0 && (
            <ul className="divide-y rounded-lg border text-sm">
              {items.map((i) => (
                <li key={i.id} className="px-3 py-2">
                  <span className="text-xs text-muted-foreground">{KIND_LABEL[i.kind]}</span>
                  <p>{i.note}</p>
                  {i.requestId && (
                    <p className="text-xs text-muted-foreground">
                      {/*
                        * The handover does not restate what happened to it.
                        * The request is the record; this line is a pointer at
                        * it, which is why a week of "still broken" notes is
                        * one request rather than seven sentences.
                        */}
                      linked to a request — its own screen says where it got to
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">
              {handover.status === "PUBLISHED"
                ? "Add a line. Nothing already on this changes, including a line that turns out to be wrong — add the correction and both stay."
                : "Add a line before publishing."}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                className="h-9 rounded-md border bg-transparent px-2 text-sm"
                aria-label="What kind of thing"
                value={kind} onChange={(e) => setKind(e.target.value as HandoverItemKind)}
              >
                {(Object.keys(KIND_LABEL) as HandoverItemKind[]).map((k) => (
                  <option key={k} value={k}>{KIND_LABEL[k]}</option>
                ))}
              </select>
              <select
                className="h-9 rounded-md border bg-transparent px-2 text-sm"
                aria-label="Link it to an open request"
                value={requestId} onChange={(e) => setRequestId(e.target.value)}
              >
                <option value="">Not about a request</option>
                {openRequests.map((r) => (
                  <option key={r.id} value={r.id}>{r.reference} — {r.title}</option>
                ))}
              </select>
            </div>
            <Textarea rows={2} value={note} aria-label="The line"
              onChange={(e) => setNote(e.target.value)}
              placeholder="The dishwasher is still making the noise" />
            <div className="flex justify-end">
              <Button size="sm" variant="outline" disabled={busy || note.trim() === ""}
                onClick={() => void add()}>Add it</Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Close</Button>
          {handover.status === "DRAFT" && (
            <Button onClick={async () => {
              setBusy(true);
              try {
                await updateHandover(handover.id, { status: "PUBLISHED" });
                toast.success("Published");
                onDone();
              } catch (err) {
                toast.error("Could not publish it", {
                  description: err instanceof Error ? err.message : String(err),
                });
              } finally { setBusy(false); }
            }} disabled={busy}>Publish it</Button>
          )}
          {handover.status === "PUBLISHED" && !handover.acknowledgedAt && (
            <Button onClick={() => void acknowledge()} disabled={busy}>
              <Check aria-hidden="true" />I have read this
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
