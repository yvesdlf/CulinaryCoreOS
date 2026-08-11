// ---------------------------------------------------------------------------
// Setting up the assistant
// ---------------------------------------------------------------------------
// Where somebody pastes their own key. Two things this screen has to be honest
// about, and says out loud rather than burying:
//
//   The key stays in this browser. It is not shared with colleagues, it does
//   not follow them to another device, and it is not in the venue's database.
//
//   A script running on this page could read it. That is a real limitation of
//   storing a key client-side, and a settings screen that implied otherwise
//   would be lying to somebody about their own money.
//
// The free option leads, because "which one do I pick" is the first question
// and the honest answer for most venues is the one that costs nothing.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Sparkles, Check, TriangleAlert, ExternalLink, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAiStore, maskKey } from "@/stores/ai-store";
import { AI_PROVIDERS, providerById } from "@/engine/ai/providers";
import { testConnection } from "@/engine/ai/client";
import { AiError, type AiProviderId } from "@/engine/ai/types";

export function AiSettingsCard() {
  const s = useAiStore();
  const [editingKey, setEditingKey] = useState(s.apiKey === "");
  const [keyDraft, setKeyDraft] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const provider = providerById(s.providerId) ?? AI_PROVIDERS[0];

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      const model = await testConnection({
        providerId: s.providerId,
        apiKey: s.apiKey,
        model: s.model,
        baseUrl: s.baseUrl,
      });
      setResult({ ok: true, message: `Working. Answered as ${model}.` });
    } catch (err) {
      setResult({
        ok: false,
        message: err instanceof AiError ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles aria-hidden="true" className="size-4" /> Assistant
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Bring your own API key. It is stored in this browser only — not in the
          venue's database, not shared with colleagues, and not carried to
          another device. Anyone who signs in elsewhere sets up their own.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={s.enabled}
            onChange={(e) => s.set({ enabled: e.target.checked })}
          />
          Show the assistant on every page
        </label>

        <div className="space-y-1">
          <Label htmlFor="ai-provider">Provider</Label>
          <select
            id="ai-provider"
            className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
            value={s.providerId}
            onChange={(e) => s.set({ providerId: e.target.value as AiProviderId })}
          >
            {AI_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}{p.hasFreeTier ? " — has a free tier" : ""}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {provider.id === "openai-compatible"
              ? "Groq, OpenRouter, Together, or a model running on your own machine via Ollama or LM Studio — anything speaking the OpenAI API."
              : provider.id === "gemini"
                ? "The free tier covers everything here, including reading photographs."
                : "Paid. Use this if the venue already has an Anthropic account."}
          </p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="ai-key">API key</Label>
            <a
              href={provider.keyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
            >
              Get one <ExternalLink aria-hidden="true" className="size-3" />
            </a>
          </div>

          {editingKey ? (
            <div className="flex gap-2">
              <Input
                id="ai-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={keyDraft}
                placeholder="Paste your key"
                onChange={(e) => setKeyDraft(e.target.value)}
              />
              <Button
                disabled={!keyDraft.trim()}
                onClick={() => {
                  s.set({ apiKey: keyDraft.trim() });
                  setKeyDraft("");
                  setEditingKey(false);
                  setResult(null);
                  toast.success("Key saved to this browser");
                }}
              >
                Save
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input id="ai-key" readOnly value={maskKey(s.apiKey)} className="font-mono" />
              <Button variant="outline" onClick={() => setEditingKey(true)}>
                Replace
              </Button>
              <Button
                variant="ghost"
                aria-label="Remove the key"
                onClick={() => {
                  s.clearKey();
                  setEditingKey(true);
                  setResult(null);
                  toast.success("Key removed from this browser");
                }}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ai-model">Model</Label>
            <Input
              id="ai-model"
              list="ai-model-options"
              value={s.model}
              onChange={(e) => s.set({ model: e.target.value })}
            />
            <datalist id="ai-model-options">
              {provider.suggestedModels.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
          {provider.id === "openai-compatible" && (
            <div className="space-y-1">
              <Label htmlFor="ai-base">Base URL</Label>
              <Input
                id="ai-base"
                value={s.baseUrl}
                placeholder="https://api.groq.com/openai/v1"
                onChange={(e) => s.set({ baseUrl: e.target.value })}
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={!s.apiKey || testing} onClick={() => void test()}>
            {testing ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Check aria-hidden="true" />}
            Test the connection
          </Button>
          {result && (
            <Badge variant={result.ok ? "default" : "destructive"}>
              {result.ok ? "Connected" : "Failed"}
            </Badge>
          )}
        </div>
        {result && !result.ok && (
          <p role="alert" className="text-sm text-destructive">{result.message}</p>
        )}
        {result?.ok && <p className="text-sm text-muted-foreground">{result.message}</p>}

        <div className="rounded-lg border border-status-warning/40 bg-status-warning-soft p-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-status-warning">
            <TriangleAlert aria-hidden="true" className="size-4" /> What the assistant will not do
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            <li>
              It can add an allergen to check. It can never remove one, and it
              cannot make a free-from claim — that is a legal statement under
              Regulation 1169/2011 and belongs to the venue.
            </li>
            <li>
              It will not say food is safe to serve. Your HACCP records decide
              that.
            </li>
            <li>
              Anything it suggests about allergens leaves the product marked
              unverified until somebody reads the label.
            </li>
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            The key is held in this browser's local storage, which a script
            running on this page could read. It never reaches the venue's
            database or its backups.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
