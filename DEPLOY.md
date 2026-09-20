# Deploying CulinaryCoreOS

The app is a static front end talking to Supabase. There is no server of our
own, so deployment is two things: a Supabase project, and somewhere to serve
the built files.

Nothing here has been run against a live project. It is written from how the
local stack is configured and should be followed carefully the first time.

**What is already connected:** a Vercel project, `culinary-core-os`, is linked
to this repository and has been failing on every pull request. It had no
configuration in the repository at all, so it was guessing at a pnpm workspace
whose application lives in `apps/web`. `vercel.json` now says what to do — see
§3. Nothing about the Supabase side exists yet.

## 1. Supabase project

Create a project, then from the repository root:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

`db push` applies `supabase/migrations/*.sql` in order. The chain rebuilds a
complete schema from empty — 98 tables and 373 row-level security policies as
of migration 0057 — and that is checked on every push, so a failure here is a
connection or permission problem rather than a broken migration.

Then prove the controls survived the trip:

```bash
./supabase/tests/run.sh "$DATABASE_URL"
```

98 checks. They are the same ones CI runs, and running them against the hosted
database is the only way to know that the hosted database enforces what the
local one does — a migration that applies is not the same as a trigger that
fires.

Then load the catalogue:

```bash
psql "$DATABASE_URL" -f supabase/seed.sql
psql "$DATABASE_URL" -f supabase/seed_manuza.sql
```

Do **not** run `supabase/seed_sample_sales.sql` on a production project. It
invents three months of sales for demonstration.

## 2. First user

The first person to sign up becomes the owner of a new organisation. Sign up,
then invite colleagues from Settings.

Approvals need at least two people. Nobody may approve their own requisition
or their own leave, whatever their role, so a single-user installation cannot
exercise those controls at all. Settings says so on screen.

## 3. Front end

`apps/web/dist` is a static bundle and any static host serves it. It needs one
thing from the host: a rewrite sending every path that is not a built asset to
`/index.html`, or client-side routes 404 on reload.

### On Vercel, which is already connected

`vercel.json` at the repository root sets the install and build commands, the
output directory and that rewrite. Two things still have to be done in the
Vercel dashboard, because they are account settings rather than repository
settings:

1. **Root Directory must be the repository root**, not `apps/web`. A root
   directory of `apps/web` means `vercel.json` is never read and the workspace
   cannot be installed from there.
2. **Two environment variables**, for Production and Preview:

   ```
   VITE_SUPABASE_URL       https://<ref>.supabase.co
   VITE_SUPABASE_ANON_KEY  <anon key>
   ```

   Without them the build still succeeds — the application checks
   `isSupabaseConfigured` and runs on its mock catalogue — which is worth
   knowing, because a deployment that looks fine and shows invented data is
   the failure mode to watch for here.

### Anywhere else

```bash
VITE_SUPABASE_URL=https://<ref>.supabase.co \
VITE_SUPABASE_ANON_KEY=<anon-key> \
pnpm --filter web build
```

The anon key is meant to be public. Every table is protected by row-level
security, and the key alone grants nothing without a session. The service role
key must never reach the browser and is not used anywhere in this codebase.

## 4. Before real data

```bash
psql "$DATABASE_URL" -f supabase/purge_sample_data.sql
```

Removes the invented sales, sample employees, test purchasing documents and
demonstration stock. Leaves the ingredient and recipe catalogue alone.

## 5. Still to decide

These are known gaps rather than oversights, and each changes behaviour:

- **Which EU member state.** `organizations.reduced_vat_percent` is null, so
  everything is taxed at the 21% standard rate. Most member states reduce the
  rate on restaurant food, which makes 21% too high on every food line.
- **Approval thresholds.** Seeded at 5.000.000 for ADMIN and 25.000.000 for
  OWNER. These are placeholders, not a finance policy.
- **Sending things.** Marking a purchase order "ordered" transmits nothing;
  an invitation is not emailed. Both need a channel choosing.
- **Payment.** Invoices reach "approved for payment" and stop. Execution
  belongs with an AP or bank provider by design.

## 6. Operational gaps

No error monitoring, no backup restore has been rehearsed, and no runbook
exists. Supabase takes automatic backups on paid plans; restoring one has not
been tested here.
