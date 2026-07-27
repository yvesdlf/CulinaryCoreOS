# CulinaryCoreOS (CCOS)

Hospitality operating platform — recipe & sub-recipe management, cost/nutrition
engines, allergen tracking, menu engineering, supplier & procurement, inventory,
and production planning. Originally scoped to replace two Excel workbooks
(89 + 250 sheets) for a restaurant kitchen; being built as a general-purpose,
sellable platform for the hospitality industry.

> **Working name.** "CulinaryCoreOS" is a placeholder chosen for development.
> See `docs/DECISIONS.md` for naming history and the plan to revisit it.

## Repo layout

```
culinarycoreos/
├── apps/
│   ├── web/       React + TypeScript + Vite — main app, runs in browser
│   ├── ios/       Capacitor wrapper — generates the Xcode project (iOS/iPadOS)
│   └── macos/     Tauri wrapper — native macOS build
├── packages/
│   └── shared/    Shared TypeScript domain types + costing/nutrition logic
├── supabase/      Postgres schema, migrations, RLS policies
├── docs/          SRS, architecture notes, decision log, competitive analysis
└── .github/       CI workflows
```

## Tooling this repo assumes (per your setup)

Claude Code, Cursor, Git, Node.js, Docker Desktop, Supabase CLI, PostgreSQL,
Xcode, Homebrew, Terminal/iTerm2. Nothing else required to get started.

## Getting started (on your Mac, not in this chat)

```bash
# 1. Install workspace dependencies
pnpm install

# 2. Start the web app
pnpm --filter web dev

# 3. Generate the native iOS project (creates apps/ios/App, opens in Xcode)
cd apps/ios && npx cap add ios && npx cap open ios

# 4. Generate the native macOS project (Tauri)
cd apps/macos && cargo tauri init

# 5. Start local Supabase (requires Docker Desktop running)
supabase start
```

Steps 3–5 require your local toolchain (Xcode, Rust/Cargo, Docker) and can't
be run from this chat — see `docs/SETUP.md` for the full walkthrough and what
Claude Code can do for you locally versus what happens here in chat.

## Status

Pre-development. Schema and domain types are scaffolded from the SRS; no
working UI yet. See `docs/PROGRESS.md` for the running task list.
