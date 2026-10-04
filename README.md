# CulinaryCoreOS (CCOS)

A hospitality operations platform. It started as a replacement for two Excel
workbooks (89 + 250 sheets) that costed one restaurant kitchen, and it has grown
past that: alongside recipe and sub-recipe costing, nutrition, allergens and
menu engineering, it now covers purchasing from requisition to three-way invoice
matching, inventory on an append-only ledger, EU traceability and recall, HACCP
records on a venue's own forms, Human Resources with rota, leave, training and a
staff portal, engineering maintenance, and housekeeping.

The thing it is actually built around is narrower than that list: **every rule
that matters is enforced in the database by a trigger or a row-level-security
policy, and proved by SQL that tries to break it.** A hidden button is not a
control. See `AGENTS.md` for the rules this follows and why each one exists.

### What it is not

- **Not deployed.** It runs on one laptop. No supplier, technician or manager
  outside the building has ever opened it. The Vercel configuration exists; the
  account settings it needs do not.
- **Not an accounting system, and deliberately so.** No general ledger, no
  payables or receivables, no payments, no e-invoicing or tax filing. The
  recommendation in `docs/COMPETITIVE_ANALYSIS.md` is to export to an accounting
  package rather than build one.
- **Not integrated with anything.** No POS, no PMS, no payroll, no accounting
  connector. Sales mix arrives as an imported file; occupancy is typed in and
  the screen says how old it is.
- **It tells nobody anything.** No notification is sent anywhere — an invitation
  is not emailed, an approval request does not reach the approver, and an order
  marked "ordered" transmits nothing to the supplier. The WhatsApp and email
  adapters are written and have never made a real network call.
- **No native app.** `apps/ios` and `apps/macos` are placeholders with
  instructions, not builds.
- **Single currency, single organisation at a time.** A user genuinely in two
  organisations cannot switch between them.
- **No live updating.** Reads are hydrate-once plus a refresh when the tab
  regains focus. Realtime sync was attempted, could not be made to deliver
  events, and was reverted rather than shipped.

`docs/PROGRESS.md` is the honest version of all of this: what is built, what is
not, and how each claim was checked.

> **Working name.** "CulinaryCoreOS" is a placeholder chosen for development.
> See `docs/DECISIONS.md` for naming history and the plan to revisit it.

## Repo layout

```
culinarycoreos/
├── apps/
│   ├── web/       React + TypeScript + Vite — the application. Everything
│   │              is here: engine/ (pure logic), data/ (the only files that
│   │              know Postgres exists), pages/, components/, stores/.
│   │              tests/ holds the Playwright suites.
│   ├── ios/       Placeholder. A README with the Capacitor commands to
│   │              generate the Xcode project on a Mac. No build exists.
│   └── macos/     Placeholder. Same, for Tauri. No build exists.
├── packages/
│   └── shared/    Domain types shared across apps, and a small costing
│                  helper. The cost engine itself lives in apps/web/src/engine.
├── supabase/
│   ├── migrations/   57 numbered, forward-only SQL files. No ORM, no runner.
│   ├── tests/        579 database controls, run by run.sh and by CI.
│   └── seed*.sql     Demo data. Never required for correctness.
├── scripts/       The WhatsApp and email adapters, and the workbook-to-CSV
│                  converter. Run outside the database on purpose: a trigger
│                  must never make a network call.
├── docs/          SRS, database and UI specs, the plan, the progress tracker,
│                  the decision log, competitive analysis.
├── .github/       CI workflows and the pull request template.
└── vercel.json    Build and rewrite configuration for the web app.
```

## Tooling this repo assumes (per your setup)

Claude Code, Cursor, Git, Node.js, Docker Desktop, Supabase CLI, PostgreSQL,
Xcode, Homebrew, Terminal/iTerm2. Nothing else required to get started.

## Getting started (on your Mac, not in this chat)

```bash
# 1. Install workspace dependencies
pnpm install

# 2. Start local Supabase and build the schema from empty (needs Docker)
supabase start
supabase db reset          # applies all 75 migrations, then seed.sql

# 3. Point the app at it — the local keys are development defaults, not secrets
cp apps/web/.env.example apps/web/.env.local   # then fill in the anon key
                                               # from `supabase status`

# 4. Start the web app
pnpm --filter web dev      # port 5173, pinned
```

Without step 3 the app falls back to an in-memory mock catalogue rather than
failing, so a screen full of plausible invented data is the symptom of a missing
environment variable.

### The checks

```bash
pnpm --filter web typecheck   # tsc --noEmit
pnpm --filter web test:unit   # 574 unit tests, no database needed
pnpm --filter web lint        # eslint
./supabase/tests/run.sh       # 579 database controls, against a fresh reset
cd apps/web && npx playwright test --project=desktop
```

The Playwright run needs the dev server and a seeded database; it starts the
server itself. `visual.spec.ts` will fail — its screenshot baselines are stale
and excluded from CI.

### The native shells

```bash
cd apps/ios && npx cap add ios && npx cap open ios   # iOS/iPadOS, Capacitor
cd apps/macos && cargo tauri init                    # macOS, Tauri
```

Neither has been generated. Both need a local toolchain (Xcode, Rust/Cargo) —
see `docs/SETUP.md` for the full walkthrough.

## Status

In development, and working. Measured at `f504b51` on 2026-10-03, on a database
rebuilt from empty:

| | |
|---|---|
| Migrations | 57, forward-only |
| Schema | 113 tables, 403 policies, 174 functions, 276 triggers, 48 views |
| Unit tests | 574, across 33 files, all passing |
| Database controls | 579, all passing — `supabase/tests/run.sh` |
| Browser tests | 39 passing on the desktop project, of which CI runs 35 — the axe, keyboard and screen-reader files. A further 15 visual snapshots fail; see below |
| Lint | 0 errors, 129 warnings (`any` at the database boundary, warned on purpose) |
| Source | 49.822 lines of TypeScript, 13.123 of SQL in migrations |
| Web app | 29 page components behind 33 routes, 20 of them destinations in a sidebar of six groups |

Still not deployed anywhere, and `DEPLOY.md` has never been run. CI runs
typecheck, the unit tests, lint, a production build, the 579 database controls
and the accessibility suites on every pull request and on every push to `main`.

Two caveats worth reading before trusting the numbers above: the visual
regression baselines are eight weeks stale and are excluded from CI, so all 15
screenshot comparisons fail locally; and the 579 database controls cover five
areas rather than every control in the schema. Both are recorded in
`docs/PROGRESS.md`, which is the honest version of what is built, what is not,
and how each claim was checked.
