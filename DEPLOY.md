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

Create **two** projects: staging and production. Choose the region with care —
it cannot be changed afterwards, and it decides where staff data lives. Then,
from the repository root, against each:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

`db push` applies `supabase/migrations/*.sql` in order and records which have
run. The chain rebuilds a complete schema from empty, and that is checked on
every push, so a failure here is a connection or permission problem rather than
a broken migration. `pg_cron` and `pg_net` are created by migrations 0069 and
0076; no dashboard step is needed for them.

Then prove the controls survived the trip — **on staging only**:

```bash
CCOS_ALLOW_REMOTE_TESTS=1 ./supabase/tests/run.sh "$STAGING_DATABASE_URL"
```

They are the same checks CI runs, and running them against a hosted database
is the only way to know it enforces what the local one does — a migration that
applies is not the same as a trigger that fires. **Never point `run.sh` at
production.** Its fixtures create a test venue and users, and its teardown
deletes recipes, products and stock history by name pattern (`T-%`), which on a
real venue includes things like "T-Bone Steak". The script refuses any host
that is not local unless told it is staging.

### What never goes near production

```text
supabase/seed.sql               a demo owner whose password is in this repository
supabase/seed_manuza.sql        starts by truncating every venue's catalogue
supabase/seed_sample_sales.sql  three months of invented sales
supabase/tests/run.sh           writes and deletes rows (see above)
```

An earlier version of this file told people to load the first two into the
hosted database. That would have created an owner account anybody who reads
this repository can sign into. If a hosted project was ever seeded that way,
run `supabase/purge_sample_data.sql` there, which now deletes that user, and
treat its sessions as compromised.

## 2. First user, then the catalogue

The first person to sign up becomes the owner of a new organisation. Sign up,
then load the catalogue into **that** organisation:

```bash
supabase/bootstrap_catalogue.sh "$DATABASE_URL" <organisation-id>
```

It reads the same generated rows as `seed_manuza.sql` but never truncates,
writes only into the organisation you name, creates no logins, and leaves any
row that already exists alone, so running it twice changes nothing. Find the
organisation id with `select id, name from organizations;`.

Then invite colleagues from Settings.

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
Followed as written, production never received any of these. This is for a
database that did — a local stack promoted to real use, or a hosted project
seeded before §1 said not to. It also deletes the demo owner from `seed.sql`.

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
