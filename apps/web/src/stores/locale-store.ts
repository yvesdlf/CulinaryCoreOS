// ---------------------------------------------------------------------------
// Which language the screen is in
// ---------------------------------------------------------------------------
// Held per browser rather than per account, deliberately. A portal tablet on
// a kitchen wall is used by fifteen people who do not sign in and out between
// shifts, and a language that followed the account would flip under whoever
// touched it last. The tablet is set to Bahasa Indonesia once, and stays.
//
// The first visit takes the browser's own preference, which is the closest
// thing to a right answer nobody had to configure.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import {
  translate, preferredLocale, isLocale,
  type Locale, type TranslateOptions,
} from "@/lib/i18n/core";
import { dictionaries } from "@/lib/i18n/dictionaries";

const KEY = "ccos.locale";
const FALLBACK: Locale = "en";

function stored(): Locale | null {
  try {
    const raw = localStorage.getItem(KEY);
    return isLocale(raw) ? raw : null;
  } catch {
    // Private browsing, or storage switched off. Not an error: the browser's
    // own preference is a perfectly good answer.
    return null;
  }
}

/*
 * A gap is loud while developing and silent in a kitchen.
 *
 * Shouting about a missing phrase on a tablet helps nobody standing at it,
 * and saying nothing while building is how a screen ships half-translated.
 */
const reported = new Set<string>();
function missing(key: string, locale: Locale) {
  if (!import.meta.env.DEV) return;
  const at = `${locale}:${key}`;
  if (reported.has(at)) return;
  reported.add(at);
  console.warn(`[i18n] no ${locale} phrase for "${key}" — showing English`);
}

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, options?: TranslateOptions) => string;
}

export const useLocaleStore = create<LocaleState>((set, get) => ({
  locale: stored() ?? preferredLocale(
    typeof navigator === "undefined" ? [] : navigator.languages ?? [],
    FALLBACK,
  ),

  setLocale: (locale) => {
    try { localStorage.setItem(KEY, locale); } catch { /* see `stored` */ }
    // Screen readers announce in the language the document declares, so a
    // page left as `lang="en"` is read out with an English voice reading
    // Indonesian words.
    if (typeof document !== "undefined") document.documentElement.lang = locale;
    set({ locale });
  },

  t: (key, options) =>
    translate(dictionaries, get().locale, FALLBACK, key, options, missing),
}));

/** The phrase function alone, for components that do not need the rest. */
export function useT() {
  return useLocaleStore((s) => s.t);
}
