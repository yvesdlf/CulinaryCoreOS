# How this app gets built

The rules that have actually governed this codebase, written down. Not
aspirations — every one of them exists because breaking it caused a specific
failure that is described here.

`.github/copilot-instructions.md` used to hold this and was written when the
repository was empty. It said so, for months after it stopped being true.

---

## The stack, and where things live

pnpm monorepo. React 19 + TypeScript + Vite + Tailwind 4 + shadcn/Base UI,
Supabase (Postgres) behind it.

```
apps/web/src/
  engine/       pure business logic. No React, no Supabase, no I/O.
  data/         every Supabase query. The only file that knows Postgres exists.
  stores/       zustand. Session, catalogue, per-section access.
  pages/        routes.
  components/   ui/ is shadcn; the rest is ours.
  lib/          csv, format, allergens, constants.
packages/shared/  types shared across apps.
supabase/migrations/   numbered, forward-only.
supabase/seed*.sql     demo data. Never required for correctness.
```

### Commands

```bash
pnpm -C apps/web exec tsc --noEmit      # typecheck
pnpm -C apps/web exec vitest run        # 574 unit tests
pnpm --filter web lint                  # eslint
./supabase/tests/run.sh                 # 579 database controls
pnpm -C apps/web dev                    # dev server on 5173 (pinned)
```

Run them from the repo root. `pnpm -C apps/web exec …` from inside `apps/web`
resolves to `apps/web/apps/web` and fails with a confusing ENOENT.

Migrations are applied by running each file in order against the local
Postgres. There is no ORM and no migration runner.

### Lint

`pnpm --filter web lint` runs eslint. The script had been in `package.json`
since the first week and eslint was never installed, so for months the command
failed and reported nothing. **A check that cannot run is worse than no
check**, because it sits in the script list and everybody assumes somebody runs
it.

The rule set is deliberately narrow, and `apps/web/eslint.config.js` says why
at each rule. There is already a type checker in CI, 574 unit tests and 98
database checks, so lint is not asked to find type errors or logic bugs. It is
there for the category none of those catch: code that is dead, unreachable, or
wrong in a way that still compiles.

No style rules and no formatter. Formatting arguments cost more than they save
on a codebase one person writes, and a thousand-violation baseline on day one
teaches everybody to pass `--fix` without reading.

`any` is a warning rather than an error, because every row from Supabase is
untyped JSON and `repository.ts` maps it by hand — banning it there would mean
either generating types from the schema, which is worth doing and is not that
task, or writing casts that assert the same thing with more words. 129 warnings
remain, visible rather than suppressed.

`react-hooks/purity` is an error and earned it on the first run: `Date.now()`
inside a `useMemo` on the housekeeping board, keyed on the board, so the
staleness figure never changed as time passed. Two of the React Compiler rules
are off, with the reasoning in the config — they report what a compiler this
project does not use would prefer, which is not the same as something being
wrong.

---

## 1. Enforce it in the database, not the screen

A hidden button is not a control. Anybody can call the API.

Every rule that matters — who may approve, who may write, what may not be
deleted — lives in a trigger or a row-level-security policy. The UI's job is to
make the rule *visible* and its refusal *legible*, never to be the rule.

This is not theoretical. Migration 0036 shipped a per-section access model
whose ownership check was:

```sql
select 'WRITE' from organization_members
 where user_id = auth.uid() and role = 'OWNER'
```

No organisation in the `WHERE` clause. Sign-up creates an organisation and
makes the new user its owner, so *every* user is an owner of something and the
check passed for everyone. A member granted READ on Recipes could edit them.
The UI looked correct throughout.

**A permission question is never "is this person an owner". It is "is this
person an owner *here*."** Any check on `organization_members` that does not
name an organisation is wrong.

## 2. Prove a control by trying to break it

Write the SQL that attempts the thing that must not happen, and read what the
database says. A test that only exercises the happy path proves nothing about
a control.

**The proofs live in `supabase/tests/`, and CI runs them on every push.** 372
checks across the section grid, maintenance, housekeeping, purchasing's
segregation of duties, the rota, the business-unit tree, unit-scoped access,
media, production, starting data, use-by dates, the department contract, pay
and revenue — run by `supabase/tests/run.sh` against a schema rebuilt from
empty. Before that suite existed, every "proved in SQL" claim in
`docs/PROGRESS.md` had been proved once, by hand, in a scratch file nobody kept
— which a month later is indistinguishable from never having proved it at all.

**Write the test so you can watch it fail.** A green check proves nothing until
you have seen it go red for the reason you think it is guarding. Every rule
added in stages 1 and 2 was falsified by hand before it was merged, and twice
that was the only reason a defect was found: renaming one trigger so it sorted
after another numbered a kitchen job `WO-ENG-`, and a test that asserted a
generated column rather than the report built on it stayed green while the
report was rewritten to say something false. The second is the shape to watch
for — proving the thing underneath the thing somebody reads.

**Do not rewrite a function in full to add a line to it.** Five migrations each
rewrote `seed_organization_defaults` that way, and the fifth dropped the
fourth's line: a new venue got no media retention policy, so every photograph
it took was kept forever and nobody was told. The list is rows in
`organization_seeders` now, and a migration that wants to add a seeder inserts
one. Where a registry is not possible — a trigger body — the suite is what
catches it, and it did: the first draft of 0061 rebuilt a trigger from 0020's
text and lost the direction check 0060 had added, and two checks in another
file went red within the minute.

**A new trigger or policy is not finished until it has a test there.** That is
the rule this section now exists to state. Forty-odd triggers are what this
system's honesty rests on, and the only thing standing between one of them and
somebody quietly dropping it is a check that runs without being asked.

A suite that cannot fail is decoration, so confirm it can: dropping the
work-order assignment trigger turns four checks red and the runner exits 1.

### Three ways this repository has produced a false pass

Each one is why `_harness.sql` has a function rather than a bare statement.
Read that file before adding a test — all three of these were paid for.

- **An UPDATE matching zero rows raises nothing.** A refusal and an empty table
  read identically, so a test asserting "no error" passes without ever
  executing the rule it names. `expect_rows` asserts how many rows changed.
  Where a fixture row would mean inventing three parent records,
  `expect_guarded` checks the wiring instead — a table added later and never
  listed is what actually goes missing.
- **A trigger may silently correct what it did not refuse.** "The write was
  allowed" is not "the write happened", so anything that matters is read back
  afterwards with `expect_value`. Asserting the absence of an error is not
  asserting the presence of the outcome.
- **A fixture that fails takes every later assertion with it**, and the run
  then reports a screenful of passes that never executed. Each fixture is
  isolated in a subtransaction, and the runner refuses to assert anything at
  all if any of them failed.

One more, about reading the output rather than writing the test:
**`grep "^ERROR"` matches nothing.** psql prefixes errors with `file:line:`.
The runner counts `FAIL` lines instead and takes its exit code from the total,
because `ON_ERROR_STOP` would abort on the first *expected* refusal.

Where writing a test reveals that a control is wrong, assert the behaviour as
it actually is, name it a gap in `docs/PROGRESS.md`, and let the check go red
when it is fixed. A suite quietly patched to agree with the code it is meant to
be testing is worth less than no suite.

## 3. Money is decimal, quantities are numbers

`decimal.js` for anything denominated in currency. Never floats.

Measured quantities may be plain numbers, but subtract them in decimal when the
result is displayed: `4 - 20.87` in binary floating point is
`-16.869999999999997`, and a stock report showing that reads as broken.

## 4. Ledgers append, they do not update

`stock_movements`, `recipe_status_events`, `approval_events`, `haccp_records`,
`time_entries`. No update or delete grant. A correction is a new record that
refers to the old one, and both stay visible.

Time becomes pay. A punch that can be quietly edited is a punch nobody can rely
on.

## 5. Nobody approves their own work

Requisitions, purchase orders, leave, time corrections, performance reviews,
hiring. Enforced by trigger, not convention.

Hiring routes to the head of the department that pays for the person — the
executive chef for the kitchen, the general manager for front of house — with a
named deputy, because otherwise hiring stops whenever somebody takes a holiday.

## 6. Starting data belongs in a function, not a migration body

**The single most repeated defect in this repository.** Seven migrations wrote
`insert … select … from organizations`. That runs once, over the organisations
that exist at that moment — and on a database built from its own migrations,
that is none, because migrations run before anybody has signed up.

Rebuilding from empty found zero cost centres, approval policies, matching
tolerances, budgets, tax rates, message channels, leave types and HACCP forms.
With no approval policy, nothing needs approving. With no matching tolerance,
an invoice has nothing to be inside or outside of.

Defaults live in `seed_organization_defaults(org)`, called by a trigger on
organisation creation and for every organisation that already exists. All
idempotent; none overwrites a value a venue has changed.

**Rebuilding from empty is the check that finds these.** Do it before claiming
a migration works:

```bash
psql "$DB" -q -c "drop schema public cascade; create schema public;
  grant usage on schema public to anon, authenticated, service_role;"
for f in supabase/migrations/*.sql; do
  psql "$DB" -q -v ON_ERROR_STOP=1 -f "$f" || echo "FAILED: $f"
done
```

## 7. Portal users are not organisation members

Suppliers and staff get accounts. Neither is a member of the venue.

If a commis chef were, `auth_org_ids()` would include the venue and every
existing read policy — three hundred of them — would return rows. Making that
safe would mean auditing all of them and getting all of them right. Making it
safe *by default* means the caller has no membership, so every policy already
denies them and access exists only where a migration deliberately opens a door,
each one keyed to `auth_employee_id()` or `auth_supplier_id()`.

## 8. Allergens are a legal statement

Regulation 1169/2011. The dangerous failure is not a *missing* allergen — it is
a *confident* one.

Anything inferred from a name is stored with `allergensNeedReview` set. Silence
is never turned into a claim: "no allergens found" and "this contains no
allergens" are different statements, and only the first is ever true from a
name match. A free-from claim is something a person makes after reading a
label.

A code or icon never replaces the written allergen name.

## 9. Regulation is cited, not invented

Where a threshold comes from law, name the instrument in the code so the next
person can look it up rather than guess whether it was made up:

- 1169/2011 — allergens, use-by vs best-before
- 178/2002 Art 18/19 — traceability, recall
- 852/2004 Annex II Ch XII — food-safety training
- 2003/88/EC — 11 h daily rest, break past 6 h, 24 h weekly rest, 48 h week
- GDPR Art 9 — sick notes are special-category health data

## 10. Imports preview before they commit

Recipes, prices, HACCP templates, stock counts. Same shape every time: choose a
file, read what it *would* do, then decide. The planner is pure, so the preview
and the commit cannot disagree.

Report what will not import, by line number and reason. Never silently drop a
row.

A blank is not a zero. On a count sheet, "I did not count this" and "there are
none" are different statements, and treating the first as the second writes off
the shelf.

## 11. Comments explain why, never what

The code says what. A comment earns its place by recording the reasoning, the
regulation, or the bug that produced the shape.

```ts
// Cooled from 63 °C to 10 °C within 90 minutes; the record is the last
// reading, which must be at or below 10 °C.
```

not

```ts
// set the max to 10
```

## 12. Report what happened, including the failures

If a check failed, say so with the output. If something was skipped, say that.
A summary that reads better than the work is worse than no summary.

Every bug found while building is written into the commit message, because the
next person will otherwise reintroduce it.

---

## Working agreement

Commit and push at checkpoints without asking.

**Force-push, history rewrite and branch deletion need explicit approval,**
every time. Approval for one does not carry to the next.

Work goes on a branch and reaches `main` through a pull request. Use the
template in `.github/pull_request_template.md`; the "how it was proved" section
is the one that matters.

The COGS V5 workbook is read-only reference material and is not part of this
build. Do not consult it.
