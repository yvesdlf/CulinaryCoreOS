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
}

export interface GuardedResponse extends AiResponse {
  /** Sentences the app replaced, so the screen can say it edited the answer. */
  substituted: string[];
}

export async function runAi(
  request: AiRequest,
  config: AiConfig,
): Promise<GuardedResponse> {
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
