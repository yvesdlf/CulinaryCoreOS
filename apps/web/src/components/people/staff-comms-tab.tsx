// ---------------------------------------------------------------------------
// Sending things to staff
// ---------------------------------------------------------------------------
// Newsletters, the week's rota, training material, and policies people have to
// acknowledge. One screen because they are the same act — choose what, choose
// who, send — and splitting them into four would mean four places to look when
// somebody asks what was sent last week.
//
// Training material is the interesting case. Attaching it to a course is what
// turns "here is a PDF" into a thing with an exam at the end and a certificate
// after that, so the course is offered on every send and the recipients are
// assigned to it at the same time. Otherwise somebody uploads the material,
// nobody is assigned the course, and the training that was supposedly issued
// never appears on anybody's list.
//
// What is sent is a record. Who read it, and who acknowledged it, is the
// question an inspector asks — so the list leads with those counts rather than
// with the title.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Paperclip, Check, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  sendStaffDocument, fetchStaffDocuments, signedFileUrl, assignTraining,
  type StaffDocument, type StaffDocumentKind, type Department,
  type TrainingCourse,
} from "@/data/repository";
import type { Employee } from "@/engine/people";

const KINDS: { value: StaffDocumentKind; label: string; hint: string }[] = [
  { value: "NEWSLETTER", label: "Newsletter", hint: "What is happening at the venue." },
  { value: "ROTA", label: "Rota", hint: "The published rota, as a document." },
  { value: "TRAINING", label: "Training material", hint: "To read before an exam." },
  { value: "POLICY", label: "Policy", hint: "Something they must acknowledge having read." },
  { value: "OTHER", label: "Notice", hint: "Anything else." },
];

export function StaffCommsTab({
  employees, departments, courses, onDone,
}: {
  employees: Employee[];
  departments: Department[];
  courses: TrainingCourse[];
  onDone: () => void | Promise<void>;
}) {
  const [documents, setDocuments] = useState<StaffDocument[]>([]);
  const [kind, setKind] = useState<StaffDocumentKind>("NEWSLETTER");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [courseId, setCourseId] = useState("");
  const [requireAck, setRequireAck] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Only people who can actually receive it. Somebody who has left should not
  // appear on a distribution list.
  const reachable = useMemo(
    () => employees.filter((e) =>
      ["PROBATION", "ACTIVE", "NOTICE"].includes(e.employmentStatus)),
    [employees],
  );

  async function load() {
    try {
      setDocuments(await fetchStaffDocuments());
    } catch (err) {
      toast.error("Could not load what has been sent", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  useEffect(() => { void load(); }, []);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectDepartment(departmentId: string) {
    const ids = reachable.filter((e) => e.departmentId === departmentId).map((e) => e.id);
    setSelected((s) => {
      const next = new Set(s);
      const allIn = ids.every((id) => next.has(id));
      for (const id of ids) { if (allIn) next.delete(id); else next.add(id); }
      return next;
    });
  }

  async function send() {
    setBusy(true);
    try {
      await sendStaffDocument({
        kind,
        title: title.trim(),
        body: body.trim() || null,
        courseId: courseId || null,
        requiresAcknowledgement: requireAck,
        employeeIds: [...selected],
        file,
      });

      /*
       * Material attached to a course assigns that course too.
       *
       * Sending study notes without assigning the course leaves people with a
       * PDF and no exam, and leaves the training record showing nothing was
       * issued. Failing here must not lose the document that was already
       * sent, so it reports rather than throws.
       */
      if (courseId) {
        try {
          // Already-assigned people are skipped rather than duplicated.
          await Promise.all(
            [...selected].map((id) => assignTraining(courseId, id, null).catch(() => {})),
          );
        } catch (err) {
          toast.warning("Sent, but the course was not assigned", {
            description: err instanceof Error ? err.message : String(err),
          });
        }
      }

      toast.success(`Sent to ${selected.size} ${selected.size === 1 ? "person" : "people"}`);
      setTitle(""); setBody(""); setFile(null); setSelected(new Set());
      setCourseId(""); setRequireAck(false);
      if (fileInput.current) fileInput.current.value = "";
      await load();
      await onDone();
    } catch (err) {
      toast.error("Could not send it", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally { setBusy(false); }
  }

  const valid = title.trim() !== "" && selected.size > 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Send something to staff</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>What is it</Label>
                <Select
                  value={kind}
                  onValueChange={(v) => {
                    const next = (v ?? "NEWSLETTER") as StaffDocumentKind;
                    setKind(next);
                    // A policy is the case where acknowledgement is the point.
                    if (next === "POLICY") setRequireAck(true);
                  }}
                >
                  <SelectTrigger className="w-full" aria-label="Document kind">
                    <SelectValue>
                      {(v: unknown) => KINDS.find((k) => k.value === v)?.label ?? "Choose"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {KINDS.map((k) => (
                      <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {KINDS.find((k) => k.value === kind)?.hint}
                </p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="doc-title">Title</Label>
                <Input
                  id="doc-title"
                  value={title}
                  placeholder="Allergen handling — revised procedure"
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="doc-body">Message</Label>
              <Textarea
                id="doc-body"
                rows={4}
                value={body}
                placeholder="What they need to know, in the app itself."
                onChange={(e) => setBody(e.target.value)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="doc-file">Attachment</Label>
                <Input
                  id="doc-file"
                  ref={fileInput}
                  type="file"
                  accept=".pdf,.docx,.pptx,.txt,.md,image/jpeg,image/png,image/webp"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <div className="space-y-1">
                <Label>Course</Label>
                <Select value={courseId} onValueChange={(v) => setCourseId(v ?? "")}>
                  <SelectTrigger className="w-full" aria-label="Course">
                    <SelectValue placeholder="None">
                      {(v: unknown) =>
                        courses.find((c) => c.id === v)?.title ?? "None"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {courses.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Attaching a course also assigns it, so the exam appears on
                  their list.
                </p>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={requireAck}
                onChange={(e) => setRequireAck(e.target.checked)}
              />
              They must confirm they have read and understood it
            </label>

            <Button disabled={!valid || busy} onClick={() => void send()}>
              <Send aria-hidden="true" />
              Send to {selected.size} {selected.size === 1 ? "person" : "people"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Users aria-hidden="true" className="size-4" /> Who gets it
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  setSelected((s) =>
                    s.size === reachable.length
                      ? new Set()
                      : new Set(reachable.map((e) => e.id)))
                }
              >
                {selected.size === reachable.length ? "None" : "Everyone"}
              </Button>
              {departments.map((d) => (
                <Button
                  key={d.id}
                  size="xs"
                  variant="outline"
                  onClick={() => selectDepartment(d.id)}
                >
                  {d.name}
                </Button>
              ))}
            </div>

            <ul className="max-h-72 space-y-0.5 overflow-y-auto">
              {reachable.map((e) => (
                <li key={e.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50">
                    <input
                      type="checkbox"
                      checked={selected.has(e.id)}
                      onChange={() => toggle(e.id)}
                    />
                    <span className="flex-1 truncate">
                      {e.firstName} {e.lastName}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {departments.find((d) => d.id === e.departmentId)?.name ?? ""}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">What has been sent</CardTitle>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>What</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="text-right">Sent to</TableHead>
                    <TableHead className="text-right">Read</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {d.publishedAt ? new Date(d.publishedAt).toLocaleDateString() : "draft"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {KINDS.find((k) => k.value === d.kind)?.label ?? d.kind}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        {d.title}
                        {d.requiresAcknowledgement && (
                          <Check aria-hidden="true" className="ml-1.5 inline size-3.5 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{d.sentTo ?? 0}</TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${
                          (d.readBy ?? 0) < (d.sentTo ?? 0) ? "text-status-warning" : ""
                        }`}
                      >
                        {d.readBy ?? 0}
                      </TableCell>
                      <TableCell className="text-right">
                        {d.filePath && (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={async () => {
                              try {
                                const url = await signedFileUrl("staff-documents", d.filePath!);
                                window.open(url, "_blank", "noopener,noreferrer");
                              } catch (err) {
                                toast.error("Could not open it", {
                                  description: err instanceof Error ? err.message : String(err),
                                });
                              }
                            }}
                          >
                            <Paperclip aria-hidden="true" /> Open
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
