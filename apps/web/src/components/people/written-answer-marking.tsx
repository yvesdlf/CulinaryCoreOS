// ---------------------------------------------------------------------------
// Marking what somebody wrote
// ---------------------------------------------------------------------------
// The multiple-choice half of an exam marks itself. This is the other half,
// and it has had a schema and a database function since 0070 with nothing to
// drive them: `awaiting_marking` went true and the attempt sat there.
//
// Three things the screen is deliberate about.
//
//   The model answer sits beside the candidate's, not behind a disclosure.
//   Marking prose against a remembered standard is how two people doing the
//   same job award different marks for the same answer.
//
//   Marks are awarded per question and the total is not shown as a
//   percentage here. The percentage spans both halves of the paper — the
//   auto-marked questions as well as these — and only the database knows the
//   other half. A figure worked out in the browser would be a different
//   number from the one that gets saved, and this one decides whether
//   somebody holds a certification.
//
//   An answer can be given nought. "Not yet marked" and "marked as wrong"
//   are different states, and a blank box that silently means zero loses the
//   difference — so the field starts empty and the button stays disabled
//   until every answer on the paper has a number in it.
//
// Nobody's own paper appears here. The view excludes it, so a manager cannot
// read the model answer to an exam they are about to sit; the RPC refuses the
// write for the same reason. This screen does not need to check either, and
// deliberately does not pretend to be the control.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { GraduationCap, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { PermissionGate } from "@/components/shared/permission-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchWrittenAnswersToMark, markWrittenAnswers,
  type WrittenAnswerToMark,
} from "@/data/operations";

interface Paper {
  attemptId: string;
  courseTitle: string;
  who: string;
  attemptedAt: string;
  answers: WrittenAnswerToMark[];
}

/** One row per answer, grouped into the paper it belongs to. */
function toPapers(rows: WrittenAnswerToMark[]): Paper[] {
  const by = new Map<string, Paper>();
  for (const r of rows) {
    let p = by.get(r.attemptId);
    if (!p) {
      p = {
        attemptId: r.attemptId,
        courseTitle: r.courseTitle,
        who: [r.firstName, r.lastName].filter(Boolean).join(" ")
             + (r.employeeNumber ? ` (${r.employeeNumber})` : ""),
        attemptedAt: r.attemptedAt,
        answers: [],
      };
      by.set(r.attemptId, p);
    }
    p.answers.push(r);
  }
  return [...by.values()];
}

export function WrittenAnswerMarking({ onDone }: { onDone?: () => void | Promise<void> }) {
  const [rows, setRows] = useState<WrittenAnswerToMark[] | null>(null);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await fetchWrittenAnswersToMark());
    } catch (e) {
      toast.error("Could not load the marking queue", {
        description: e instanceof Error ? e.message : undefined,
      });
      setRows([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const papers = useMemo(
    () => toPapers((rows ?? []).filter((r) => r.awaitingMarking)),
    [rows],
  );

  async function submit(paper: Paper) {
    const given: Record<string, number> = {};
    for (const a of paper.answers) {
      const raw = marks[a.id];
      const n = Number(raw);
      // Guarded rather than coerced: an empty box is not a nought.
      if (raw === undefined || raw === "" || Number.isNaN(n)) return;
      given[a.questionId] = n;
    }
    setSaving(paper.attemptId);
    try {
      const { score, passed } = await markWrittenAnswers(paper.attemptId, given);
      toast.success(
        `${paper.who} scored ${score}% — ${passed ? "passed" : "not passed"}`,
        { description: "Across the whole paper, counted in the database." },
      );
      await load();
      await onDone?.();
    } catch (e) {
      toast.error("Could not save the marks", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(null);
    }
  }

  function complete(paper: Paper) {
    return paper.answers.every((a) => {
      const raw = marks[a.id];
      if (raw === undefined || raw === "") return false;
      const n = Number(raw);
      return !Number.isNaN(n) && n >= 0 && n <= a.points;
    });
  }

  if (rows === null) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading the marking queue…
      </div>
    );
  }

  if (papers.length === 0) {
    return (
      <EmptyState icon={GraduationCap} title="Nothing waiting to be marked">
        Written answers appear here when somebody submits an exam that has
        them. Your own papers never do — somebody else marks those.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        {papers.length} paper{papers.length === 1 ? "" : "s"} waiting
      </p>

      {papers.map((paper) => (
        <section
          key={paper.attemptId}
          className="rounded-lg border border-border"
          aria-labelledby={`paper-${paper.attemptId}`}
        >
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h3 id={`paper-${paper.attemptId}`} className="text-sm font-medium">
                {paper.who}
              </h3>
              <p className="text-xs text-muted-foreground">
                {paper.courseTitle} · sat{" "}
                {new Date(paper.attemptedAt).toLocaleDateString()}
              </p>
            </div>
            <Badge variant="outline">
              {paper.answers.length} written answer
              {paper.answers.length === 1 ? "" : "s"}
            </Badge>
          </header>

          <div className="divide-y divide-border">
            {paper.answers.map((a) => (
              <div key={a.id} className="space-y-3 px-4 py-4">
                <p className="text-sm font-medium">{a.prompt}</p>

                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      What they wrote
                    </Label>
                    <Textarea
                      readOnly
                      value={a.answer}
                      rows={4}
                      className="mt-1 resize-none bg-muted/40"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      The model answer
                    </Label>
                    <Textarea
                      readOnly
                      value={a.modelAnswer ?? "No model answer was written for this question."}
                      rows={4}
                      className="mt-1 resize-none bg-muted/40"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-36">
                    <Label htmlFor={`mark-${a.id}`} className="text-xs">
                      Marks out of {a.points}
                    </Label>
                    <Input
                      id={`mark-${a.id}`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={a.points}
                      step="0.5"
                      placeholder="—"
                      value={marks[a.id] ?? ""}
                      onChange={(e) =>
                        setMarks((m) => ({ ...m, [a.id]: e.target.value }))
                      }
                      className="mt-1"
                    />
                  </div>
                  <p className="pb-2 text-xs text-muted-foreground">
                    Nought is a mark. An empty box is not.
                  </p>
                </div>
              </div>
            ))}
          </div>

          <footer className="flex items-center justify-end gap-3 border-t border-border px-4 py-3">
            <PermissionGate>
              <Button
                size="sm"
                disabled={!complete(paper) || saving === paper.attemptId}
                onClick={() => void submit(paper)}
              >
                {saving === paper.attemptId && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                Save marks and score the paper
              </Button>
            </PermissionGate>
          </footer>
        </section>
      ))}
    </div>
  );
}
