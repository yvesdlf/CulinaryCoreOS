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
pnpm -C apps/web exec vitest run        # unit tests
pnpm -C apps/web dev                    # dev server on 5173 (pinned)
```

Run them from the repo root. `pnpm -C apps/web exec …` from inside `apps/web`
resolves to `apps/web/apps/web` and fails with a confusing ENOENT.

Migrations are applied by running each file in order against the local
Postgres. There is no ORM and no migration runner.

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

Two ways this has produced false passes in this repo, both worth knowing:

- **`grep "^ERROR"` matches nothing.** psql prefixes errors with `file:line:`.
  Use `grep -i "error:"`.
- **Zero rows updated raises no exception.** An `UPDATE` that matches nothing
  "succeeds". Check `get diagnostics n = row_count`, or the test is vacuous.

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
