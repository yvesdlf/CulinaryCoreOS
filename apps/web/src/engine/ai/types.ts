// ---------------------------------------------------------------------------
// The AI provider interface
// ---------------------------------------------------------------------------
// DOC5 §1.1: "CulinaryCore treats AI models as interchangeable services behind
// a unified interface. No application code references a specific provider
// directly." That decision predates this file and is the reason it exists.
//
// It earns its keep immediately: the free tier a venue starts on is not the
// provider it will still be using in a year, and swapping should be a dropdown
// rather than a rewrite. It also lets a kitchen point this at a model running
// on its own machine, which for some venues is the only acceptable answer to
// "where does our recipe book go".
//
// Deliberately smaller than the interface DOC5 sketches. Embeddings, streaming,
// tool calling and cost estimation are all in that document and none of them
// are needed by the tasks this app actually has. An interface with methods
// nothing calls is a promise to maintain code nobody uses.
// ---------------------------------------------------------------------------

export type AiProviderId = "gemini" | "openai-compatible" | "anthropic";

export interface AiCapabilities {
  chat: boolean;
  /** Can be given an image. Needed for reading a delivery note or a label. */
  vision: boolean;
  /** Will reliably return parseable JSON when asked. */
  json: boolean;
}

/** One message in a conversation. Images ride along with the user's turn. */
export interface AiMessage {
  role: "user" | "assistant";
  text: string;
  /** Base64 data URLs. Only sent to a provider whose capabilities allow it. */
  images?: string[];
}

export interface AiRequest {
  system?: string;
  messages: AiMessage[];
  /** Ask for JSON. A provider that cannot enforce it still gets told to. */
  json?: boolean;
  maxTokens?: number;
  /** Low for extraction, higher for prose. Defaults per task, not per call. */
  temperature?: number;
  signal?: AbortSignal;
}

export interface AiResponse {
  text: string;
  /** What actually answered, which is not always what was asked for. */
  model: string;
  /** Null where the provider does not report usage. */
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * A failure that can be shown to a person.
 *
 * `kind` exists so the UI can say something useful rather than printing a
 * provider's raw error: a bad key needs a different sentence from a rate
 * limit, and a kitchen at six in the morning should not have to interpret
 * "429".
 */
export type AiErrorKind =
  | "no-key"
  | "bad-key"
  | "rate-limited"
  | "quota"
  | "blocked"
  | "network"
  | "bad-response"
  | "unknown";

export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export interface AiProvider {
  readonly id: AiProviderId;
  readonly displayName: string;
  readonly capabilities: AiCapabilities;
  /** Where a person gets a key, shown beside the field they paste it into. */
  readonly keyUrl: string;
  readonly defaultModel: string;
  /** Models known to work. A person may type any model name they like. */
  readonly suggestedModels: string[];
  /** True where the provider's free tier is enough to use this app. */
  readonly hasFreeTier: boolean;

  send(
    request: AiRequest,
    config: { apiKey: string; model: string; baseUrl?: string },
  ): Promise<AiResponse>;
}
