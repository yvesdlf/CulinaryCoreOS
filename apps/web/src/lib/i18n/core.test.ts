import { describe, it, expect, vi } from "vitest";
import {
  translate, preferredLocale, isLocale, type Dictionary,
} from "./core";

/**
 * The translation core.
 *
 * The cases here are the ones that go wrong quietly: a key nobody translated,
 * a count in a language with no plural, and a sentence somebody assembled
 * from fragments so it cannot be reordered.
 */
const en: Dictionary = {
  greeting: "Good morning, {name}",
  shifts: { one: "{count} shift", other: "{count} shifts" },
  onlyEnglish: "Not translated yet",
};
const id: Dictionary = {
  greeting: "Selamat pagi, {name}",
  shifts: { other: "{count} sif" } as never,
};
const dicts = { en, id };

describe("translate", () => {
  it("interpolates without concatenating", () => {
    expect(translate(dicts, "id", "en", "greeting", { name: "Wayan" }))
      .toBe("Selamat pagi, Wayan");
  });

  it("uses English plurals: one is special, zero is not", () => {
    expect(translate(dicts, "en", "en", "shifts", { count: 1 })).toBe("1 shift");
    expect(translate(dicts, "en", "en", "shifts", { count: 0 })).toBe("0 shifts");
    expect(translate(dicts, "en", "en", "shifts", { count: 7 })).toBe("7 shifts");
  });

  it("uses one Indonesian form for every count, because the language has one", () => {
    expect(translate(dicts, "id", "en", "shifts", { count: 1 })).toBe("1 sif");
    expect(translate(dicts, "id", "en", "shifts", { count: 9 })).toBe("9 sif");
  });

  it("falls back to English rather than showing a key", () => {
    expect(translate(dicts, "id", "en", "onlyEnglish")).toBe("Not translated yet");
  });

  it("tells the caller a phrase was missing, so a gap is findable", () => {
    const missing = vi.fn();
    translate(dicts, "id", "en", "onlyEnglish", {}, missing);
    expect(missing).toHaveBeenCalledWith("onlyEnglish", "id");
  });

  it("falls back to the English plural rule when only English has the phrase", () => {
    // The phrase came from English, so English's rule decides the form —
    // using Indonesian's rule on an English string would give "1 shifts".
    const sparse = { en, id: {} as Dictionary };
    expect(translate(sparse, "id", "en", "shifts", { count: 1 })).toBe("1 shift");
  });

  it("returns the key when nothing has it at all, because that is the one thing somebody notices", () => {
    const missing = vi.fn();
    expect(translate(dicts, "id", "en", "nothing.here", {}, missing)).toBe("nothing.here");
    expect(missing).toHaveBeenCalled();
  });

  it("leaves an unknown placeholder alone instead of printing undefined", () => {
    expect(translate(dicts, "en", "en", "greeting", {})).toBe("Good morning, {name}");
  });
});

describe("preferredLocale", () => {
  it("matches on the base tag, ignoring the region", () => {
    expect(preferredLocale(["id-ID", "en-GB"])).toBe("id");
    expect(preferredLocale(["en-GB"])).toBe("en");
  });

  it("takes the first language it can actually speak", () => {
    expect(preferredLocale(["fr-FR", "de", "id"])).toBe("id");
  });

  it("falls back rather than showing a half-empty page", () => {
    expect(preferredLocale(["fr-FR", "de-DE"])).toBe("en");
    expect(preferredLocale([])).toBe("en");
  });
});

describe("isLocale", () => {
  it("rejects anything not written", () => {
    expect(isLocale("id")).toBe(true);
    expect(isLocale("jv")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});
