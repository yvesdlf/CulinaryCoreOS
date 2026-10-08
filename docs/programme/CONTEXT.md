# Programme context — read this before writing anything

Shared fact base for the parallel workstreams opened on 2026-10-08 in response
to the two gap briefs. It exists so that eight workstreams do not each
re-derive the state of the repository and each get it wrong differently.

Everything below was checked against the repository or a running database on
2026-10-08. Where it was not checked, it says so.

---

## 1. What the product is today

A pnpm monorepo: React 19 + TypeScript + Vite + Tailwind 4 + shadcn/Base UI
over Supabase/Postgres. `apps/web` is the management application and the staff
portal; `packages/shared` holds types; `supabase/migrations` is forward-only.

Measured on 2026-10-08:

| | |
|---|---|
| Migrations | 84, numbered `0001`–`0084` |
| Tables in `public` | 118 |
| Unit tests | 580, all passing |
| Database control tests | `supabase/tests/`, run by `run.sh` |
| Accessibility suites | axe + keyboard + screen reader, 67 passing / 2 skipped |

**The architectural rules in `AGENTS.md` are binding on every recommendation
in this programme.** The ones most likely to be violated by a plan written
from the outside:

- Controls live in triggers and RLS policies, never in the UI. A hidden button
  is not a control.
- A permission question is never "is this person an owner", it is "is this
  person an owner *here*". Any check on `organization_members` that does not
  name an organisation is wrong.
- Money is `decimal.js` / `numeric`. Never floats.
- Ledgers append. A correction is a new row referring to the old one.
- Starting data belongs in `seed_organization_defaults(org)`, never in a bare
  `insert … select … from organizations` in a migration body.
- Portal users are deliberately **not** organisation members.
- A new trigger or policy is not finished until it has a test in
  `supabase/tests/`.

## 2. The briefs are proposals, not a gap list

Both PDFs (`CCOS Gap Implementation Brief for Claude Code`, `CCOS Gap Brief
Part 2`) propose table names as if the schema were empty. It is not. A large
share of what they propose already exists under different names. Spot-checked
examples:

| Brief proposes | Repository already has |
|---|---|
| `stock_batches` | `stock_lots` |
| `purchase_requisitions` / `_lines` | `requisitions` / `requisition_lines` |
| `pm_schedules` | `maintenance_plans` |
| `staff`, `staff_skills` | `employees`, `competencies` |
| `asset_meters` | `meters`, `meter_readings` |
| `lost_found_items` | `lost_property` |
| `prep_plans` / `_lines` | `production_plans` / `production_plan_lines` |
| `haccp_logs` | `haccp_records` |

And genuinely absent, on the same spot check: `product_unit_conversions`,
`product_aliases`, `custom_field_definitions`, `document_links`, `stocktakes`,
`barcodes`, `exchange_rates`, `menus` / `menu_items`, `leave_balances`,
`notification_preferences`, a generic `audit_log`, and an `insights` metrics
schema.

**That spot check is not the reconciliation.** It is an illustration of why one
is needed. The authoritative list is `docs/programme/GAP_RECONCILIATION.md`.
Until that file exists, no workstream may assert that a feature is missing.

## 3. Four confirmed defects, unfixed

Found by audit earlier on 2026-10-08 and **confirmed by execution against a
running database**, not by inspection. They are open. Any plan that assumes
these controls work is wrong.

1. **Approval forgery.** `enforce_approval_rules` reads `new.actor_id` /
   `new.actor_email` from the row rather than `auth.uid()`. A CHEF was refused
   self-approval, then passed the same approval naming the OWNER as `actor_id`
   and it was **allowed**, clearing a 99,000,000 OWNER-threshold requisition
   with the owner recorded as the approver.
   **This matters commercially:** both briefs call the approval engine and
   segregation of duties CCOS's main advantage over the reference projects. It
   is currently forgeable by any authenticated member.
2. **HR case self-add.** A user added themselves to an HR case they were not
   party to: readable before 0, after 1, and the sensitive detail was returned.
3. **Sick-note deletion.** `sick_notes_read` keys on the storage path and
   `can_write_section('PEOPLE')`, never on `leave_attachments`; nothing drains
   `storage_deletions`. GDPR Art 9 special-category data.
4. **HACCP refusal is silent.** On a failed check the corrective-action block
   has no `role`/`aria-live`, focus does not move, and the button is not
   gated on the now-required text — so a second press fails identically. On a
   legally required 852/2004 CCP record.

## 4. Prior work that must be built on, not duplicated

Read these before writing. Several conclusions the briefs reach were already
reached here, and at least one mockup has already been assessed.

- `AGENTS.md` — the binding rules, with the failure that produced each one.
- `docs/PLATFORM.md` — what the product actually became and why; rejects the
  "hotel or food platform" framing.
- `docs/UI_REVIEW.md` — a third-party UI review received 2026-09-19 **with the
  two concept mockups the owner has now re-sent**. Status recorded there:
  "noted, not accepted". It already concedes the summary judgement ("identical
  white cards, flat navigation, long tab rows") as accurate and measurable.
- `docs/NAMING.md` — the rename is already open, with candidates from
  2026-07-26 and the reasoning for dropping "Culinary".
- `docs/COMPETITIVE_ANALYSIS.md` — feature grid against nine competitors, and a
  naming collision check that already killed GastroCore, KitchenOS and
  Recipeworks.
- `docs/PROGRESS.md`, `docs/DECISIONS.md`, `docs/PLAN.md`.

## 5. Licence constraint

The reference projects studied in the briefs are mostly AGPL/GPL
(frappe/hrms, kimai, frappe/lms, Atlas CMMS, ury, metabase, Kamra PMS). Only
Timefold and urlaubsverwaltung are Apache-2.0. **No code, schema, prompt or UI
text may be copied from any of them.** Features may be implemented from a
requirement. New dependencies must be MIT, Apache-2.0, BSD or ISC and recorded
in `docs/DEPENDENCIES.md`.

## 6. Rules for every workstream

1. **Write to your one assigned file only.** Do not edit application code,
   migrations, other workstreams' files, or any file in §4. Several
   workstreams run at once and nothing stops an overwrite.
2. **Ground every claim.** Cite a file path, a table, a migration number, or a
   named external source. Where you did not verify something, write that you
   did not. A plan that reads better than the work behind it is worse than no
   plan.
3. **Do not assert a feature is missing** without checking the 118 tables and
   84 migrations. See §2.
4. Where a threshold comes from law, name the instrument — 1169/2011,
   178/2002, 852/2004, 2003/88/EC, GDPR Art 9.
5. Flag anything that conflicts with `AGENTS.md` rather than quietly routing
   around it.
6. Recommend. Do not survey. Where you considered options, give the choice and
   the reason, not a catalogue.
