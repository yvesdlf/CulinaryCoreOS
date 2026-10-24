// ---------------------------------------------------------------------------
// Making the call
// ---------------------------------------------------------------------------
// The one place that puts a key together with a provider and a request. Kept
// separate from the adapters so they stay pure functions of their arguments,
// and separate from the store so the engine has no idea zustand exists.
//
// Every answer goes through guardAnswer on the way out. That is here rather
// than in each caller because a guard somebody has to remember to apply is a
// guard that gets forgotten in the one place it mattered.
// ---------------------------------------------------------------------------

import { providerById } from "./providers";
import { guardAnswer } from "./safety";
import { AiError, type AiRequest, type AiResponse } from "./types";

export interface AiConfig {
  providerId: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  /**
   * Whose key, and therefore whose bill.
   *
   * "OWN_KEY" is the default and goes straight from this browser to the
   * provider. "PLATFORM" goes through `supabase/functions/ai-proxy`, which
   * is the only place the platform's key exists — a key the browser can read
   * is a key the venue has been given.
   */
  keySource?: "OWN_KEY" | "PLATFORM";
  /** Supplied for PLATFORM; the caller's session is what the allowance is on. */
  platform?: {
    functionUrl: string;
    accessToken: string;
    task?: string;
  };
}

export interface GuardedResponse extends AiResponse {
  /** Sentences the app replaced, so the screen can say it edited the answer. */
  substituted: string[];
}

export async function runAi(
  request: AiRequest,
  config: AiConfig,
): Promise<GuardedResponse> {
  if (config.keySource === "PLATFORM") return runOnPlatformKey(request, config);

  if (!config.apiKey?.trim()) {
    throw new AiError(
      "no-key",
      "No API key is set. Add one under Settings to use the assistant.",
    );
  }

  const provider = providerById(config.providerId);
  if (!provider) {
    throw new AiError("unknown", `Unknown provider "${config.providerId}".`);
  }

  // Strip images for a provider that cannot see them, rather than sending a
  // request that will be rejected — and say so, so the answer is not silently
  // about nothing.
  let outgoing = request;
  if (!provider.capabilities.vision) {
    const hadImages = request.messages.some((m) => m.images?.length);
    if (hadImages) {
      outgoing = {
        ...request,
        messages: request.messages.map((m) => ({
          role: m.role,
          text: m.images?.length
            ? `${m.text}\n\n[An image was attached. ${provider.displayName} cannot read images, so it was not sent.]`
            : m.text,
        })),
      };
    }
  }

  const raw = await provider.send(outgoing, {
    apiKey: config.apiKey.trim(),
    model: config.model.trim() || provider.defaultModel,
    baseUrl: config.baseUrl?.trim() || undefined,
  });

  const guarded = guardAnswer(raw.text);
  return { ...raw, text: guarded.text, substituted: guarded.substituted };
}

/**
 * The same call, made by something the venue cannot read.
 *
 * The guard runs here too. It is applied in `runAi` for the own-key path and
 * it has to be applied on this one as well — a guard that depends on which
 * branch the call took is a guard that is missing on one of them, and this
 * is the branch where the platform is paying for the answer.
 *
 * 402 is not retried and is not reported as a failure of the assistant. It
 * means the allowance is spent, which is a thing the venue can do something
 * about, so the message says what.
 */
async function runOnPlatformKey(
  request: AiRequest,
  config: AiConfig,
): Promise<GuardedResponse> {
  if (!config.platform) {
    throw new AiError("no-key", "The assistant is not set up to use a shared key.");
  }

  const prompt = request.messages.map((m) => m.text).join("\n\n");
  let res: Response;
  try {
    res = await fetch(config.platform.functionUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.platform.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        providerId: config.providerId,
        model: config.model,
        prompt,
        task: config.platform.task ?? null,
        maxTokens: request.maxTokens ?? 1024,
      }),
      signal: request.signal,
    });
  } catch {
    throw new AiError("network", "Could not reach the assistant.");
  }

  const body = await res.json().catch(() => ({}));

  if (res.status === 402 || res.status === 501) {
    throw new AiError(
      "quota",
      body.error ??
        "This venue's shared assistant allowance is used up for the month.",
    );
  }
  if (!res.ok) {
    throw new AiError("unknown", body.error ?? "The assistant could not answer.");
  }

  const guarded = guardAnswer(String(body.text ?? ""));
  return {
    text: guarded.text,
    model: String(body.model ?? config.model),
    inputTokens: body.inputTokens ?? null,
    outputTokens: body.outputTokens ?? null,
    substituted: guarded.substituted,
  };
}

/**
 * A cheap round trip to prove a key works.
 *
 * Worth having its own function: "does my key work" is the first question
 * anybody has, and answering it by running a real task means a failure could
 * be the key, the model name, the base URL, or the task itself.
 */
export async function testConnection(config: AiConfig): Promise<string> {
  const res = await runAi(
    {
      messages: [{ role: "user", text: "Reply with the single word: ready" }],
      maxTokens: 16,
      temperature: 0,
    },
    config,
  );
  return res.model;
}
