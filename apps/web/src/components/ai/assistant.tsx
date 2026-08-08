// ---------------------------------------------------------------------------
// The assistant, on every page
// ---------------------------------------------------------------------------
// A panel that opens over whatever somebody is looking at, already knowing what
// that is. The page context is the whole difference between this and a chat
// window in another tab: "why is this flagged?" is only answerable if the
// assistant knows which screen asked it.
//
// It offers a few starting questions per page, because a blank box is the
// hardest thing to face on a busy service and because the useful questions
// differ enormously between the rota and the allergen matrix.
//
// Images can be attached anywhere. A photograph of a delivery note, a label, or
// a supplier's handwritten price list is the input a kitchen actually has, and
// the one a keyboard is worst at.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Sparkles, X, Paperclip, SendHorizontal, Loader2, Settings2, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAiStore } from "@/stores/ai-store";
import { runAi } from "@/engine/ai/client";
import { assistRequest } from "@/engine/ai/tasks";
import { AiError } from "@/engine/ai/types";

interface Turn {
  role: "user" | "assistant";
  text: string;
  images?: string[];
  substituted?: string[];
}

/**
 * What the assistant is told about where it is.
 *
 * Route-derived rather than passed down through every page, so a new page gets
 * a sensible default instead of nothing, and no page has to remember to wire
 * this up.
 */
function describePage(pathname: string): { label: string; context: string; prompts: string[] } {
  const p = pathname;
  const at = (s: string) => p === s || p.startsWith(s + "/");

  if (at("/recipes")) return {
    label: "Recipes",
    context: "The recipe list or a recipe editor — dishes, their ingredient lines, costs, food cost percentage and allergens.",
    prompts: [
      "Why might this dish's food cost be high?",
      "Suggest a garnish that uses what we already stock",
      "Rewrite this method for a commis chef",
    ],
  };
  if (at("/sub-recipes")) return {
    label: "Sub recipes",
    context: "Preparations — batch recipes used inside dishes, costed per unit of yield.",
    prompts: ["How can I extend the shelf life of this prep?", "What yield should I expect from this batch?"],
  };
  if (at("/products")) return {
    label: "Products",
    context: "The ingredient catalogue — packs, prices, trim percentages, nutrition and allergens.",
    prompts: [
      "What allergens is this ingredient likely to carry?",
      "Read the attached label and tell me what it says",
      "What trim loss should I expect on this?",
    ],
  };
  if (at("/purchasing")) return {
    label: "Purchasing",
    context: "Requisitions, purchase orders, receiving, supplier invoices and budgets.",
    prompts: ["Draft an email chasing a late delivery", "What should I check before approving this order?"],
  };
  if (at("/inventory")) return {
    label: "Inventory",
    context: "Stock on hand against par levels, counts, waste and the movement ledger.",
    prompts: ["Why might this count be so far out?", "How do I cut waste on fresh herbs?"],
  };
  if (at("/hygiene")) return {
    label: "Hygiene",
    context: "HACCP control sheets, what is overdue, and recorded breaches with their corrective actions.",
    prompts: [
      "What corrective action fits a chiller found at 9 °C?",
      "Draft a cleaning schedule for the larder",
    ],
  };
  if (at("/human-resources") || at("/people")) return {
    label: "Human Resources",
    context: "Staff, rota, leave, training, competency and HR cases.",
    prompts: [
      "Draft a newsletter about the new allergen procedure",
      "Write three exam questions on chilled storage",
      "Draft a fair note declining a leave request",
    ],
  };
  if (at("/traceability")) return {
    label: "Traceability",
    context: "Lots, expiry dates and recall — Regulation 178/2002 Articles 18 and 19.",
    prompts: ["Walk me through a recall on this lot", "What records does an inspector ask for?"],
  };
  if (at("/menu-engineering")) return {
    label: "Menu engineering",
    context: "Sales mix classified into Stars, Plowhorses, Puzzles and Dogs.",
    prompts: ["What do I do with a Puzzle?", "Write a summary of this month's menu performance"],
  };
  if (at("/administration")) return {
    label: "Administration",
    context: "Access per section, protected parameters, spend limits and hiring approvers.",
    prompts: ["What access should a commis chef have?", "Explain what this spend limit does"],
  };
  return {
    label: "CulinaryCoreOS",
    context: "The dashboard, showing what needs attention across the venue.",
    prompts: ["What should I look at first today?", "Explain what this app tracks"],
  };
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read that file."));
    r.readAsDataURL(file);
  });
}

export function Assistant() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const { pathname } = useLocation();
  const page = describePage(pathname);

  const providerId = useAiStore((s) => s.providerId);
  const apiKey = useAiStore((s) => s.apiKey);
  const model = useAiStore((s) => s.model);
  const baseUrl = useAiStore((s) => s.baseUrl);
  const enabled = useAiStore((s) => s.enabled);
  const ready = enabled && apiKey.trim() !== "";

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [turns, busy]);

  // Cmd/Ctrl+J, next to the existing Cmd+K palette.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!enabled) return null;

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    const mine: Turn = { role: "user", text: question, images: images.length ? images : undefined };
    const history = turns.map((t) => ({ role: t.role, text: t.text }));
    setTurns((t) => [...t, mine]);
    setDraft("");
    setImages([]);
    setError(null);
    setBusy(true);

    try {
      const res = await runAi(
        assistRequest({
          question,
          pageContext: `${page.label} — ${page.context}`,
          history,
          images: mine.images,
        }),
        { providerId, apiKey, model, baseUrl },
      );
      setTurns((t) => [
        ...t,
        { role: "assistant", text: res.text, substituted: res.substituted },
      ]);
    } catch (err) {
      setError(
        err instanceof AiError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        onClick={() => setOpen((v) => !v)}
        aria-label="Open the assistant"
        title="Assistant (⌘J)"
        className="fixed bottom-5 right-5 z-40 size-11 rounded-full p-0 shadow-lg"
      >
        {open ? <X aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
      </Button>

      {open && (
        <aside
          aria-label="Assistant"
          className="fixed bottom-20 right-5 z-40 flex h-[min(34rem,calc(100svh-7rem))] w-[min(26rem,calc(100vw-2.5rem))] flex-col rounded-xl border border-border bg-background shadow-xl"
        >
          <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">Assistant</p>
              <p className="truncate text-xs text-muted-foreground">{page.label}</p>
            </div>
            <div className="flex items-center gap-1">
              {turns.length > 0 && (
                <Button size="xs" variant="ghost" onClick={() => setTurns([])}>
                  Clear
                </Button>
              )}
              <Button size="icon-xs" variant="ghost" aria-label="Close" onClick={() => setOpen(false)}>
                <X aria-hidden="true" />
              </Button>
            </div>
          </header>

          <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {!ready ? (
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <p className="font-medium">No API key yet</p>
                <p className="mt-1 text-muted-foreground">
                  The assistant runs on your own key, stored only in this browser.
                  Google Gemini has a free tier that covers everything here.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  render={<Link to="/settings" onClick={() => setOpen(false)} />}
                >
                  <Settings2 aria-hidden="true" /> Set it up
                </Button>
              </div>
            ) : turns.length === 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Ask about this screen, or attach a photograph.
                </p>
                {page.prompts.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => void ask(p)}
                    className="block w-full rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-muted/50"
                  >
                    {p}
                  </button>
                ))}
              </div>
            ) : (
              turns.map((t, i) => (
                <div
                  key={i}
                  className={
                    t.role === "user"
                      ? "ml-6 rounded-lg bg-muted px-3 py-2 text-sm"
                      : "mr-2 text-sm"
                  }
                >
                  {t.images?.length ? (
                    <div className="mb-2 flex flex-wrap gap-1">
                      {t.images.map((src, n) => (
                        <img
                          key={n}
                          src={src}
                          alt=""
                          className="size-14 rounded border border-border object-cover"
                        />
                      ))}
                    </div>
                  ) : null}
                  <p className="whitespace-pre-wrap">{t.text}</p>
                  {t.substituted?.length ? (
                    <p className="mt-2 flex gap-1.5 rounded border border-status-warning/40 bg-status-warning-soft p-2 text-xs text-status-warning">
                      <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                      Part of this answer was replaced — the assistant is not
                      allowed to make that claim.
                    </p>
                  ) : null}
                </div>
              ))
            )}

            {busy && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 aria-hidden="true" className="size-4 animate-spin" /> Thinking…
              </p>
            )}
            {error && (
              <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-sm">
                {error}
              </p>
            )}
          </div>

          {ready && (
            <div className="border-t border-border p-2">
              {images.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {images.map((src, i) => (
                    <span key={i} className="relative">
                      <img src={src} alt="" className="size-12 rounded border border-border object-cover" />
                      <button
                        type="button"
                        aria-label="Remove image"
                        onClick={() => setImages((im) => im.filter((_, n) => n !== i))}
                        className="absolute -right-1 -top-1 rounded-full bg-background p-0.5 shadow"
                      >
                        <X aria-hidden="true" className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-1.5">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="sr-only"
                  aria-label="Attach a photograph"
                  onChange={async (e) => {
                    const files = [...(e.target.files ?? [])];
                    const urls = await Promise.all(files.map(fileToDataUrl));
                    setImages((im) => [...im, ...urls].slice(0, 4));
                    e.target.value = "";
                  }}
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Attach a photograph"
                  onClick={() => fileInput.current?.click()}
                >
                  <Paperclip aria-hidden="true" />
                </Button>
                <Textarea
                  rows={1}
                  value={draft}
                  placeholder="Ask about this screen…"
                  className="max-h-28 min-h-9 flex-1 resize-none"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void ask(draft);
                    }
                  }}
                />
                <Button
                  size="icon-sm"
                  aria-label="Send"
                  disabled={busy || !draft.trim()}
                  onClick={() => void ask(draft)}
                >
                  <SendHorizontal aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
        </aside>
      )}
    </>
  );
}
