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
   supabase start           # local Postgres + Studio; first run pulls ~10 images
   supabase db reset        # applies migrations, then loads supabase/seed.sql
   ```

   `supabase start` prints an **API URL** and an **anon key**. Put them in
   `apps/web/.env.local` (git-ignored — copy `apps/web/.env.example`):

   ```
   VITE_SUPABASE_URL=http://127.0.0.1:54321
   VITE_SUPABASE_ANON_KEY=<the anon key it printed>
   ```

   The local anon key is a well-known development default, not a secret. Never
   put the `service_role` key in `.env.local` — anything prefixed `VITE_` is
   compiled into the browser bundle and shipped to every visitor.

   Without these variables the app still runs, backed by the in-memory mock
   catalogue. That is the intended fallback, so a fresh clone works with no
   database at all.

4. **Web app**
   ```bash
   pnpm --filter web dev    # http://localhost:5173
   ```

### Seed data

`supabase/seed.sql` is generated from the mock catalogue in
`apps/web/src/data/`, so the two never drift:

```bash
pnpm --filter web seed:generate   # rewrites supabase/seed.sql
supabase db reset                 # re-applies migrations + seed
```

Readable ids like `prod-016` are mapped to deterministic uuid v5 values, so
regenerating produces identical SQL and cross-table references stay intact.

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
