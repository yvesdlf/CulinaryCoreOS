// ---------------------------------------------------------------------------
// Every `var(--token)` a component names actually exists
// ---------------------------------------------------------------------------
// `fill="var(--primary)"` on an SVG bar is valid TypeScript, valid JSX, valid
// CSS and completely wrong: Tailwind 4 publishes the theme as
// `--color-primary`, `--primary` resolves to nothing, and `fill` falls back to
// its initial value, which is black. Nothing warns. The compiler cannot see
// inside a string, the linter has no opinion about CSS, and the screen shows a
// bar — just the wrong colour.
//
// It shipped. The trend chart (0120) drew solid black bars instead of
// primary-coloured ones for its whole life, and worse, the hatching that marks
// a period still in progress was black on black. A week that is three days old
// looked exactly like a finished one, on the chart whose entire stated reason
// for existing is that it must not. `--secondary`, `--popover`, `--border` and
// two sidebar tokens were wrong the same way; the sidebar's own widths were
// not, because a component may define a token inline and read it back.
//
// This is the cheapest check that catches the class: collect what the
// stylesheet defines, collect what the components ask for, compare. It is not
// a substitute for looking at the screen — the bug was visible to anybody who
// did — but it runs in half a second on every push, which looking does not.
//
// Sources come in through Vite's `?raw` and `import.meta.glob`, not
// `node:fs`: the web app's tsconfig has no Node types, so a `readFileSync`
// version passes under vitest and fails `tsc -b`, which is a test that is
// green while the build is red.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";

import css from "@/index.css?raw";

const sources = import.meta.glob("@/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function declaredIn(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((m) => m[1]);
}

describe("CSS custom properties", () => {
  it("every var(--token) a component names is defined somewhere", () => {
    const declared = new Set(declaredIn(css, /(--[a-zA-Z0-9-]+)\s*:/g));

    /*
     * A component may define a token inline and then read it — the sidebar
     * sets its own width on the wrapper element. A name written as a quoted
     * object key in any source file therefore counts as defined. Deliberately
     * generous: the defect being caught is a *misspelling*, and a misspelling
     * appears in exactly one place.
     */
    for (const text of Object.values(sources)) {
      for (const name of declaredIn(text, /["'](--[a-zA-Z0-9-]+)["']\s*:/g)) {
        declared.add(name);
      }
    }

    const unknown: string[] = [];
    for (const [path, text] of Object.entries(sources)) {
      if (/\.test\.tsx?$/.test(path)) continue;
      for (const m of text.matchAll(/var\((--[a-zA-Z0-9-]+)/g)) {
        const name = m[1];
        // Tailwind's own internals, written by the framework, not by us.
        if (name.startsWith("--tw-") || name.startsWith("--spacing")) continue;
        /*
         * A name completed at runtime — `var(--avatar-tint-${n})` picks one
         * of six. The whole token cannot be checked, so the prefix is: a
         * misspelling lives in the literal part, and `--avatar-tnit-` would
         * still match nothing.
         */
        const interpolated = text.slice(m.index + m[0].length).startsWith("${");
        const ok = interpolated
          ? [...declared].some((d) => d.startsWith(name))
          : declared.has(name);
        if (!ok) unknown.push(`${path}: var(${name})`);
      }
    }

    expect([...new Set(unknown)].sort()).toEqual([]);
  });
});
