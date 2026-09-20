// ---------------------------------------------------------------------------
// Lint rules
// ---------------------------------------------------------------------------
// `pnpm lint` has been in package.json since the first week and eslint was
// never installed, so the command failed and reported nothing. A check that
// cannot run is worse than no check: it appears in the script list, nobody
// runs it, and everybody assumes somebody does.
//
// The rule set is deliberately narrow. This codebase already has a type
// checker that runs in CI, 537 unit tests and 98 database checks, so lint is
// not being asked to find type errors or logic bugs. It is here for the
// category none of those catch: code that is *dead*, *unreachable* or
// *accidentally wrong in a way that still compiles* — an unused import left by
// a refactor, a hook whose dependency list has drifted from its body, a `case`
// that falls through.
//
// Style is not linted and there is no formatter rule. Formatting arguments
// cost more time than they save on a codebase one person is writing, and a
// thousand-violation baseline on day one teaches everybody to pass `--fix`
// without reading.
// ---------------------------------------------------------------------------

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "tests/visual.spec.ts-snapshots/**",
      "scripts/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      /*
       * `any` is used deliberately at the database boundary.
       *
       * Every row coming back from Supabase is untyped JSON, and repository.ts
       * maps it into a typed shape by hand. Banning `any` there would mean
       * either generating types from the schema — which is worth doing and is
       * not this task — or writing casts that assert the same thing with more
       * words. Warned rather than errored so it stays visible.
       */
      "@typescript-eslint/no-explicit-any": "warn",

      /*
       * Unused variables are an error, with one exception that matters here:
       * a leading underscore. Destructuring a row to drop a field is
       * deliberate, and the underscore is how that intent is written.
       */
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      /*
       * The React Compiler rules, and why two of them are off.
       *
       * eslint-plugin-react-hooks v6 ships rules that exist to tell the React
       * Compiler what it can optimise, not to find bugs. Two of them fire on
       * patterns that are correct here:
       *
       *   set-state-in-effect — 31 hits, every one the same shape:
       *   `useEffect(() => { void load(); }, [])`. Loading on mount is the
       *   documented way to load on mount. Turning all 31 into something the
       *   compiler prefers would be a rewrite of every page's data loading,
       *   and it would not fix anything.
       *
       *   preserve-manual-memoization — 3 hits, all reporting that the
       *   compiler declined to optimise a component. That is information
       *   about the compiler, which this project does not use.
       *
       * `purity` stays on and is an error. It catches a genuinely impure
       * render — the first run found `Date.now()` inside a useMemo, which
       * never recomputes and makes the same input render differently at
       * different times of day.
       *
       * Revisit all three if the React Compiler is ever adopted.
       */
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "error",

      // Catches `if (x = 1)` and a switch case that runs into the next.
      "no-fallthrough": "error",
      "no-cond-assign": ["error", "always"],
      // Catches `await` inside a loop body that was meant to be parallel only
      // where it is clearly a mistake; off, because the sequential form is
      // deliberate in publishHousekeepingSheet and is explained there.
      "require-atomic-updates": "off",
    },
  },
  {
    // Tests say `any` freely and construct deliberately malformed input.
    files: ["**/*.test.ts", "**/*.test.tsx", "tests/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
