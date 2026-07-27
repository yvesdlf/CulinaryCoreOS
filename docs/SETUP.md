# Setup Walkthrough

## What was done in chat (this repo)
- Monorepo structure (`apps/`, `packages/`, `supabase/`, `docs/`)
- Domain types drawn directly from the source workbooks (`packages/shared`)
- Initial Postgres schema for products/sub-recipes/recipes (`supabase/migrations/0001_init.sql`)
- Minimal web app scaffold (Vite + React + TS) that runs but has no real UI yet
- Decision log, progress tracker, competitive analysis

## What has to happen on your Mac (via Claude Code, Cursor, or by hand)

1. **Unzip this repo** somewhere under your normal projects folder, `git init`
   if the zip didn't preserve `.git`, and push it to a remote (GitHub etc.).

2. **Install dependencies**
   ```bash
   corepack enable   # gives you pnpm if you don't have it
   pnpm install
   ```

3. **Supabase** — requires Docker Desktop running
   ```bash
   supabase login
   supabase init            # if config.toml needs regenerating for your CLI version
   supabase start           # spins up local Postgres + Studio
   supabase db push         # applies supabase/migrations/0001_init.sql
   ```

4. **Web app**
   ```bash
   pnpm --filter web dev    # http://localhost:5173
   ```

5. **iOS (Xcode)** — see `apps/ios/README.md`. High level: `npx cap add ios`
   generates the actual Xcode project; you then open `App.xcworkspace` in
   Xcode directly for signing, running on simulator/device, App Store builds.

6. **macOS (Tauri)** — see `apps/macos/README.md`. Requires Rust installed.

## Division of labor going forward

- **This chat**: planning, research, competitive analysis, drafting
  files/code, updating docs — everything that doesn't require your local
  toolchain.
- **Claude Code** (terminal, VS Code, or desktop app, on your Mac): actually
  running `git`, `xcodebuild`, `docker`, `supabase`, editing the live repo,
  driving the day-to-day build. Point it at this repo once it's on your
  machine and it can pick up right where this chat left off — the docs
  folder is written so a fresh Claude Code session has full context.
