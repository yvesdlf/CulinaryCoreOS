# Deploying CulinaryCoreOS

The app is a static front end talking to Supabase. There is no server of our
own, so deployment is two things: a Supabase project, and somewhere to serve
the built files.

Nothing here has been run against a live project. It is written from how the
local stack is configured and should be followed carefully the first time.

## 1. Supabase project

Create a project, then from the repository root:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

`db push` applies `supabase/migrations/*.sql` in order. The chain has been
verified to rebuild a complete schema — 36 tables, 126 row-level security
policies — from an empty database.

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

Build with the project's URL and anon key:

```bash
VITE_SUPABASE_URL=https://<ref>.supabase.co \
VITE_SUPABASE_ANON_KEY=<anon-key> \
pnpm --filter web build
```

`apps/web/dist` is a static bundle — any static host serves it. It needs a
SPA rewrite so client-side routes resolve: every path to `/index.html`.

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
