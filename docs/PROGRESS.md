# Progress Tracker

> **How to read this file.** An item is ticked only where the behaviour has
> been exercised — in the browser against the real catalogue, or by a test that
> runs in CI. Anything partial says so. Claims made before 2026-08-01 were
> one-time checks on one laptop while CI was red; everything since is
> machine-checked on every push.

**Head:** `ec2c054` · CI green (typecheck/unit/build · a11y+keyboard+screen-reader
against a live database · costing reconciliation) · 179 unit tests · 89 browser
tests.

## Where the app stands

CulinaryCoreOS is a working recipe and costing system. It holds the full
ingredient chain (ingredients -> preparations -> dishes), costs it to five
decimal places, cascades a price change through everything built on it,
declares allergens, enforces a recipe approval workflow, and produces the
printed sheets a kitchen actually uses.

Not started: inventory, production planning, procurement, AI import,
reporting, and the wider platform modules in DOC1.

## Done

### Costing
- [x] Cost engine on decimal.js — no float money anywhere. Gross qty from
      trim, line cost, waste and inflation buffers, tax, food cost %,
      contribution margin, recommended pricing. 26 unit tests, each encoding a
      bug that shipped or a figure from a real workbook.
- [x] Cascade: a price change re-costs every preparation and dish above it, in
      dependency order, safe against reference cycles. Uses the as-purchased
      price, because gross quantity already carries the trim — pairing both
      charged for waste twice and came out 25% high.
- [x] `recalculateAll` for whole-catalogue re-costing after a bulk import.
- [x] Per-entity waste, inflation and tax rather than global constants.
- [x] Reconciliation gate in CI against an independent golden master.

### Recipes and preparations
- [x] Full editors with live costing, ingredient autocomplete, nutrition and
      allergen panels.
- [x] **Method**: ordered preparation steps, prep and cook times, and internal
      notes that are excluded from printed sheets and exports.
- [x] **Status workflow** — SRS RCP-FUNC-006, RCP-BR-009/010. Draft -> Pending
      -> Actual with no shortcut; Actual requires a price, ingredients, a name
      and a method; only owners and admins may approve; every transition is
      written to an append-only audit table.
- [x] Guarded delete: refused while anything depends on it, with the blockers
      named and linked, and archiving offered instead. Archiving keeps every
      dish above it costing correctly.
- [x] Archived items hidden from lists by default, still findable by search,
      never offered in the ingredient picker (SRS AC5).

### Allergens
- [x] EU/UK 14 registry with codes, Lucide icons and alias mapping, per CPSM
      Appendix G. A code or icon never stands in for the written name.
- [x] Inheritance through the cascade, so an allergen reaches every dish built
      on the ingredient rather than only where someone saved a page.
- [x] Free-from claims derived from the registry, failing closed on anything
      unrecognised.
- [x] Menu-wide matrix with icons, printable and exportable, stating plainly
      that it is not a compliance record while unverified items remain.
- [x] Per-recipe attribution: which ingredient contributes which allergen, and
      through which preparation.
- [x] Verification workflow — inferred declarations are flagged with what to
      check, transitively, and cleared by a human.

### Output
- [x] Recipe sheets and preparation sheets to DOC4 §11.3 — single column, no
      chrome, in-house components asterisked and linked.
- [x] Collections: named packs that print as one document with a contents page.
- [x] Export as self-contained HTML files in a folder, including the
      preparations the dishes reference. ZIP writer written rather than
      depended on, validated with a real extractor.
- [x] CSV export of costings, products, suppliers and the allergen matrix,
      honouring on-screen filters.

### Data in
- [x] Supplier price-list import with a mandatory preview: unknown names,
      ambiguous names, unreadable figures and negative prices are reported, not
      skipped.
- [x] Recipe import from a sheet, resolving references and refusing to invent
      products.
- [x] Workbook-to-CSV converter, so a spreadsheet and a hand-written sheet are
      the same import.

### Data quality
- [x] Duplicate ingredient detection, graded by whether price, supplier and
      unit agree, with a transactional merge that repoints every line first.
- [x] Duplicate supplier detection and consolidation.
- [x] Nutrition distinguishes "no calories" from "nobody entered any", and
      labels partial coverage a minimum rather than a total.

### Platform
- [x] Supabase with multi-tenancy and RLS; anon revoked, cross-tenant reads and
      writes verified blocked.
- [x] Atomic cascade RPC — the fan-out commits or does not.
- [x] Optimistic concurrency on recipes, preparations and products.
- [x] Recipe status history shown in the editor.
- [x] Nutrition can arrive by import — optional columns on the product import,
      merged rather than replacing, so a file carrying only kcal does not blank
      macros entered by hand.
- [x] CI: three jobs, green. It failed on all seven of its first runs while
      reporting nothing, because it died at pnpm setup before a test ran.
- [x] WCAG 2.2 AA: axe, keyboard and screen-reader suites in both themes.
      Defects found and fixed include unlabelled selects, a scroll region no
      keyboard could reach, and tokens tuned against one background only.
- [x] Dark mode that survives a reload.
- [x] Catalogue re-reads when the tab regains focus, so a colleague's price
      change does not stay invisible until someone reloads.
- [x] Route-level code splitting and vendor chunks — app chunk 39 kB gzipped,
      down from 298 kB.
- [x] Command-K searching the whole catalogue, not four page links.
- [x] Dashboard as the food cost summary: blended cost weighted by money,
      dishes off target with suggested prices, and food cost by menu section.

## A red CI run that was not a regression

Two of three browser-job runs went red, including one whose only change was
a markdown file. The failing step was `supabase/setup-cli@v1`, not a test:
`version: latest` resolves the newest release on every run, and that network
lookup can simply fail. Pinned to 2.109.1. Worth remembering that a job dying
before any test executes looks identical to a test regression.

## In progress / next up
- [ ] No realtime subscription. The catalogue re-reads when the tab regains
      focus, which covers the common case; a second user's edit made while you
      are watching the same screen still needs a focus change to appear.
- [ ] A Playwright session token is present in git history at `3bbcc97`.
      Removing it needs a force-push, which is the repository owner's call.

## Backlog (from SRS, not yet started)
- [ ] Membership management: invites, role changes and removing a member are
      deliberately not client-writable. `organization_members` has a read
      policy only, so this needs a server-side flow.
- [ ] Organization switcher. `auth_default_org_id()` takes the oldest
      membership, so a user in more than one org always writes to the first.
      write, but the editors still present Save as though it will succeed.
- [ ] Reads are hydrate-once at startup. No realtime subscription and no
      refetch, so a second user's edits are not seen until reload.
- [x] The cascade fan-out is wrapped in the `apply_cascade` RPC, so it commits
      or does not. The primary entity's own UPDATE is still a separate request
      — see below.
- [ ] Products have no `version` column, so they get no lost-update protection
      (recipes and sub-recipes do). Add one if concurrent product editing
      becomes a real scenario.
- [ ] The cascade fan-out is atomic, but the primary entity's own UPDATE is
      still a separate request from it. Folding that into the same RPC would
      close the last window.
- [ ] Cascade `refPercent` too, if product yield should override recipe lines.
      Deliberately not done: ref % is editable per line in the ingredient grid,
      so overwriting it would discard a chef's intentional trim override.
- [x] Allergen management (EU 14). US 9 union still outstanding.
- [x] Menu engineering: food cost by section, off-target dishes and
      suggested prices on the dashboard. Sales-mix weighting still needs
      POS data the app does not yet receive.
- [ ] Supplier & procurement module
- [ ] Inventory management
- [ ] Production planning / prep lists
- [ ] AI recipe import (from the two source workbooks, as first real dataset)
- [ ] AI conversational assistant
- [ ] Reporting & analytics
- [ ] RBAC / user management
- [~] Audit logging: recipe status transitions are logged append-only.
      Field-level history for other entities is not.
- [ ] Notifications & tasks
- [~] Document management: recipe and prep sheets, collections, file export.

## Open questions for the user
(Updated after competitive analysis pass #1 — see `docs/COMPETITIVE_ANALYSIS.md`)
- Accounting: recommend QuickBooks + Xero at launch, Zoho Books as secondary. Confirm.
- Payments: recommend NOT building this — integrate with POS instead (industry norm).
  Which POS system(s) should be first-priority integrations?
- Staff management: recommend scoping to scheduling/labor forecasting only, integrating
  out to a real payroll provider rather than building payroll. Confirm scope.
- Confirm target launch market(s) — affects tax/currency/compliance defaults (VAT vs.
  Indonesian PPN, UAE WPS payroll compliance vs. Indonesian equivalents).
