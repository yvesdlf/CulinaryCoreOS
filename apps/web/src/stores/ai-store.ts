// ---------------------------------------------------------------------------
// Where the API key lives, and why it lives there
// ---------------------------------------------------------------------------
// In this browser, on this device, and nowhere else. Not in the database, not
// on a server, not synced between the people who work here.
//
// The alternative — a key column on a table — was rejected for three reasons,
// and it is worth writing them down because it is the obvious design and it is
// wrong:
//
//   Everybody with access to the row can read the key. `venue_parameters` is
//   readable by anyone with Parameters access, and the whole point of this
//   being the user's own key is that it bills to them personally.
//
//   It lands in every backup, every dump, and every screen-share of a database
//   console, for as long as those exist.
//
//   The app has no server to make the call from. A key in the database still
//   has to reach the browser to be used, so storing it centrally adds the
//   exposure without removing any.
//
// What this does not defend against: a script running on the page can read
// localStorage. That is a real limit and it is stated on the settings screen
// rather than glossed over. The mitigations that exist are that the key never
// leaves the device except to the provider it belongs to, it is per-device so
// a compromise is not a fleet, and clearing it is one button.
//
// The key is deliberately never logged, never put in an error message, and
// never included in anything the app sends to its own backend.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type { AiProviderId } from "@/engine/ai/types";
import { providerById } from "@/engine/ai/providers";

const STORAGE_KEY = "ccos.ai.settings.v1";

export interface AiSettings {
  providerId: AiProviderId;
  apiKey: string;
  model: string;
  /** For OpenAI-compatible providers: Groq, OpenRouter, or a local Ollama. */
  baseUrl: string;
  enabled: boolean;
}

const DEFAULTS: AiSettings = {
  providerId: "gemini",
  apiKey: "",
  model: "gemini-2.0-flash",
  baseUrl: "",
  enabled: true,
};

function load(): AiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      providerId: providerById(parsed?.providerId)?.id ?? DEFAULTS.providerId,
      apiKey: typeof parsed?.apiKey === "string" ? parsed.apiKey : "",
      model: typeof parsed?.model === "string" && parsed.model ? parsed.model : DEFAULTS.model,
      baseUrl: typeof parsed?.baseUrl === "string" ? parsed.baseUrl : "",
      enabled: parsed?.enabled !== false,
    };
  } catch {
    // A corrupt blob must not take the whole app down on boot.
    return { ...DEFAULTS };
  }
}

interface AiState extends AiSettings {
  set: (patch: Partial<AiSettings>) => void;
  clearKey: () => void;
  /** Whether a request can be made at all. */
  isReady: () => boolean;
}

export const useAiStore = create<AiState>((set, get) => ({
  ...load(),

  set: (patch) => {
    set((prev) => {
      const next = { ...prev, ...patch };
      // Changing provider carries a model that provider does not have, so the
      // default comes along unless the person chose one deliberately.
      if (patch.providerId && patch.providerId !== prev.providerId && !patch.model) {
        next.model = providerById(patch.providerId)?.defaultModel ?? next.model;
      }
      persist(next);
      return next;
    });
  },

  clearKey: () => {
    set((prev) => {
      const next = { ...prev, apiKey: "" };
      persist(next);
      return next;
    });
  },

  isReady: () => {
    const s = get();
    return s.enabled && s.apiKey.trim() !== "" && s.model.trim() !== "";
  },
}));

function persist(s: AiState | AiSettings) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        providerId: s.providerId,
        apiKey: s.apiKey,
        model: s.model,
        baseUrl: s.baseUrl,
        enabled: s.enabled,
      }),
    );
  } catch {
    // Private browsing, or a full quota. The session still works; it just will
    // not be remembered, which is better than refusing to run.
  }
}

/** Masked for display. The full key is never rendered back to the screen. */
export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}${"•".repeat(Math.min(24, key.length - 8))}${key.slice(-4)}`;
}
