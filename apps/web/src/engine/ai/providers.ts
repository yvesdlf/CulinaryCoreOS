// ---------------------------------------------------------------------------
// The providers
// ---------------------------------------------------------------------------
// Three adapters behind one interface.
//
//   gemini             the free default. A generous free tier, vision included,
//                      and it answers a browser directly, which matters because
//                      this app has no server to proxy through.
//   openai-compatible  the escape hatch. Groq, OpenRouter, Together, and — the
//                      reason it is really here — Ollama or LM Studio on a
//                      machine in the office. Some venues will not send their
//                      recipe book to anybody, and for them the only acceptable
//                      answer is a model that never leaves the building.
//   anthropic          for a venue that already pays for it.
//
// The key belongs to the person using the app and is passed in per call. No
// adapter reads it from anywhere; see ai-store for where it lives and why.
//
// One thing to be honest about: none of these has made a real call from this
// machine. There is no key here to make one with. The shapes follow each
// provider's published API, the error mapping is exercised by tests, and the
// first real request is the first real test.
// ---------------------------------------------------------------------------

import { AiError, type AiProvider, type AiRequest, type AiResponse } from "./types";

/** Split a data URL into the parts an API wants. */
function splitDataUrl(dataUrl: string): { mime: string; base64: string } {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) throw new AiError("bad-response", "That image could not be read.");
  return { mime: m[1], base64: m[2] };
}

/**
 * Turn a transport failure into something a person can act on.
 *
 * The status code is the most reliable signal every provider agrees on; the
 * body is not, so it is carried as detail rather than parsed for meaning.
 */
function mapHttpError(status: number, body: string): AiError {
  const detail = body.slice(0, 400);
  if (status === 401 || status === 403) {
    return new AiError("bad-key", "That API key was not accepted.", detail);
  }
  if (status === 429) {
    return new AiError(
      "rate-limited",
      "The provider is rate limiting this key. Wait a moment and try again.",
      detail,
    );
  }
  if (status === 402 || /quota|billing|credit/i.test(body)) {
    return new AiError("quota", "This key has run out of quota.", detail);
  }
  if (status >= 500) {
    return new AiError("network", "The provider is having trouble.", detail);
  }
  return new AiError("unknown", `The provider refused the request (${status}).`, detail);
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new AiError(
      "network",
      "Could not reach the provider. Check the connection, or the base URL if you set one.",
      String(err),
    );
  }
  const text = await res.text();
  if (!res.ok) throw mapHttpError(res.status, text);
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError("bad-response", "The provider sent something unreadable.", text.slice(0, 400));
  }
}

// ── Google Gemini ───────────────────────────────────────────────────────────

export const geminiProvider: AiProvider = {
  id: "gemini",
  displayName: "Google Gemini",
  capabilities: { chat: true, vision: true, json: true },
  keyUrl: "https://aistudio.google.com/apikey",
  defaultModel: "gemini-2.0-flash",
  suggestedModels: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-pro"],
  hasFreeTier: true,

  async send(request, config): Promise<AiResponse> {
    const contents = request.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [
        { text: m.text },
        ...(m.images ?? []).map((img) => {
          const { mime, base64 } = splitDataUrl(img);
          return { inline_data: { mime_type: mime, data: base64 } };
        }),
      ],
    }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: request.temperature ?? 0.2,
        maxOutputTokens: request.maxTokens ?? 2048,
        ...(request.json ? { responseMimeType: "application/json" } : {}),
      },
    };
    if (request.system) {
      body.systemInstruction = { parts: [{ text: request.system }] };
    }

    const data = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${
        encodeURIComponent(config.model)
      }:generateContent`,
      { "x-goog-api-key": config.apiKey },
      body,
      request.signal,
    );

    const candidate = data?.candidates?.[0];
    // Gemini reports a safety refusal as a finishReason rather than an error
    // status, so an unchecked read here returns an empty string and looks like
    // the model simply had nothing to say.
    if (candidate?.finishReason === "SAFETY" || data?.promptFeedback?.blockReason) {
      throw new AiError(
        "blocked",
        "The provider's own safety filter refused this. Rephrasing usually clears it.",
      );
    }
    const text = (candidate?.content?.parts ?? [])
      .map((p: any) => p?.text ?? "")
      .join("")
      .trim();
    if (!text) {
      throw new AiError("bad-response", "The provider returned an empty answer.");
    }

    return {
      text,
      model: data?.modelVersion ?? config.model,
      inputTokens: data?.usageMetadata?.promptTokenCount ?? null,
      outputTokens: data?.usageMetadata?.candidatesTokenCount ?? null,
    };
  },
};

// ── Anything speaking the OpenAI chat-completions dialect ───────────────────

export const openAiCompatibleProvider: AiProvider = {
  id: "openai-compatible",
  displayName: "OpenAI-compatible",
  capabilities: { chat: true, vision: true, json: true },
  keyUrl: "https://console.groq.com/keys",
  defaultModel: "llama-3.3-70b-versatile",
  suggestedModels: [
    "llama-3.3-70b-versatile",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "gpt-4o-mini",
    "qwen2.5:14b",
  ],
  hasFreeTier: true,

  async send(request, config): Promise<AiResponse> {
    const messages: any[] = [];
    if (request.system) messages.push({ role: "system", content: request.system });

    for (const m of request.messages) {
      if (!m.images?.length) {
        messages.push({ role: m.role, content: m.text });
        continue;
      }
      messages.push({
        role: m.role,
        content: [
          { type: "text", text: m.text },
          ...m.images.map((url) => ({ type: "image_url", image_url: { url } })),
        ],
      });
    }

    const base = (config.baseUrl || "https://api.groq.com/openai/v1").replace(/\/$/, "");
    const data = await postJson(
      `${base}/chat/completions`,
      { authorization: `Bearer ${config.apiKey}` },
      {
        model: config.model,
        messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 2048,
        ...(request.json ? { response_format: { type: "json_object" } } : {}),
      },
      request.signal,
    );

    const text = (data?.choices?.[0]?.message?.content ?? "").trim();
    if (!text) throw new AiError("bad-response", "The provider returned an empty answer.");

    return {
      text,
      model: data?.model ?? config.model,
      inputTokens: data?.usage?.prompt_tokens ?? null,
      outputTokens: data?.usage?.completion_tokens ?? null,
    };
  },
};

// ── Anthropic ───────────────────────────────────────────────────────────────

export const anthropicProvider: AiProvider = {
  id: "anthropic",
  displayName: "Anthropic Claude",
  capabilities: { chat: true, vision: true, json: false },
  keyUrl: "https://console.anthropic.com/settings/keys",
  defaultModel: "claude-sonnet-4-5",
  suggestedModels: ["claude-sonnet-4-5", "claude-haiku-4-5"],
  hasFreeTier: false,

  async send(request, config): Promise<AiResponse> {
    const messages = request.messages.map((m) => ({
      role: m.role,
      content: m.images?.length
        ? [
            { type: "text", text: m.text },
            ...m.images.map((img) => {
              const { mime, base64 } = splitDataUrl(img);
              return {
                type: "image",
                source: { type: "base64", media_type: mime, data: base64 },
              };
            }),
          ]
        : m.text,
    }));

    const data = await postJson(
      "https://api.anthropic.com/v1/messages",
      {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        // Without this the browser request is refused outright. Anthropic
        // requires it as an acknowledgement that the key is being exposed to
        // the page — which here is the user's own key on their own machine.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      {
        model: config.model,
        max_tokens: request.maxTokens ?? 2048,
        temperature: request.temperature ?? 0.2,
        ...(request.system ? { system: request.system } : {}),
        messages,
      },
      request.signal,
    );

    const text = (data?.content ?? [])
      .filter((b: any) => b?.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();
    if (!text) throw new AiError("bad-response", "The provider returned an empty answer.");

    return {
      text,
      model: data?.model ?? config.model,
      inputTokens: data?.usage?.input_tokens ?? null,
      outputTokens: data?.usage?.output_tokens ?? null,
    };
  },
};

export const AI_PROVIDERS: AiProvider[] = [
  geminiProvider,
  openAiCompatibleProvider,
  anthropicProvider,
];

export function providerById(id: string): AiProvider | undefined {
  return AI_PROVIDERS.find((p) => p.id === id);
}
