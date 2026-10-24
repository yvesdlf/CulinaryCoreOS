import { describe, it, expect } from "vitest";
import { en, id } from "./dictionaries";

/*
 * The sources come in through Vite's `?raw`, not through `node:fs`. The web
 * app's tsconfig has no Node types — rightly, it is a browser bundle — and
 * `readFileSync` compiled under vitest while failing `tsc -b`, so the test
 * passed and the build did not.
 */
import portalSource from "@/pages/portal.tsx?raw";
import homeSource from "@/components/portal/home.tsx?raw";
import pickerSource from "@/components/shared/language-picker.tsx?raw";

/**
 * Does the translated surface stay translated?
 *
 * This is the check that matters more than any wording. A screen goes
 * half-translated one `t()` call at a time: somebody adds a line, the key
 * lands in `en` because that is the file they were looking at, and the
 * Indonesian side is a sentence short. Nothing complains, because a missing
 * phrase falls back to English *by design* — which is right at runtime and
 * useless as a warning.
 *
 * So the rule is enforced here instead: every key the translated files ask
 * for exists in both dictionaries, and `id` carries everything `en` does.
 *
 * The file list is deliberate rather than a glob. The staff portal is
 * translated and the management app is not, and that is a decision — the
 * people who need Bahasa Indonesia are clocking in and asking for leave, not
 * reading a food cost variance report. A glob would quietly pull the whole
 * app in and turn a stated scope into a failing test.
 */
const TRANSLATED: { file: string; source: string }[] = [
  { file: "pages/portal.tsx", source: portalSource },
  { file: "components/portal/home.tsx", source: homeSource },
  { file: "components/shared/language-picker.tsx", source: pickerSource },
];

function keysUsedIn(source: string): string[] {
  // t("some.key" … — the opening quote is enough; a key built from a
  // variable would not be findable here, which is why none are.
  return [...source.matchAll(/\bt\(\s*"([^"]+)"/g)].map((m) => m[1]);
}

describe("translation coverage", () => {
  it("has an English phrase for every key the translated screens ask for", () => {
    const missing: string[] = [];
    for (const f of TRANSLATED) {
      for (const key of keysUsedIn(f.source)) {
        if (!(key in en)) missing.push(`${f.file}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("has an Indonesian phrase for every key the translated screens ask for", () => {
    const missing: string[] = [];
    for (const f of TRANSLATED) {
      for (const key of keysUsedIn(f.source)) {
        if (!(key in id)) missing.push(`${f.file}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("keeps the two dictionaries the same shape", () => {
    // An entry in one and not the other is either a phrase nobody translated
    // or one nobody removed. Both are worth seeing.
    expect(Object.keys(id).sort()).toEqual(Object.keys(en).sort());
  });

  it("uses the same placeholders in both languages", () => {
    // A translated sentence that dropped {name} loses the name silently, and
    // one that invented {naam} prints the braces on screen.
    const placeholders = (phrase: unknown): string[] => {
      const text = typeof phrase === "string"
        ? phrase
        : Object.values(phrase as Record<string, string>).join(" ");
      return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
    };
    const wrong: string[] = [];
    for (const key of Object.keys(en)) {
      const a = placeholders(en[key]);
      const b = placeholders(id[key]);
      if (a.join(",") !== b.join(",")) wrong.push(`${key}: en(${a}) id(${b})`);
    }
    expect(wrong).toEqual([]);
  });

  it("gives Indonesian one plural form and English two, which is what each language has", () => {
    const wrong: string[] = [];
    for (const key of Object.keys(en)) {
      const e = en[key];
      const i = id[key];
      if (typeof e === "object") {
        if (typeof i !== "object") { wrong.push(`${key}: id is not a counted phrase`); continue; }
        if (!("one" in e) || !("other" in e)) wrong.push(`${key}: en needs one and other`);
        if ("one" in i) wrong.push(`${key}: id does not inflect for number`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
