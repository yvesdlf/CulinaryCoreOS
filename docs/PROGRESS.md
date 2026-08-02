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

Stock is now tracked against par levels, with receipts, waste and counts
recorded on an append-only ledger.

Expected covers now turn into a prep list and a pull list, with what is
already on the shelf subtracted.

Sales can be imported from a POS export and the menu classified into Stars,
Plowhorses, Puzzles and Dogs.

Not started: procurement, AI import, reporting, and the wider platform
modules in DOC1.

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

### Inventory (SRS 4.10)
- [x] Stock held as an append-only ledger of movements, not a mutable number,
      so "why is this four kilos short" stays answerable a week later. The
      `authenticated` role has INSERT and SELECT on it and nothing else.
- [x] Par levels and reorder points per ingredient, editable on the product
      page. No par means "not stock-tracked" rather than "out of stock" —
      most of a 1.100-line catalogue is bought to order.
- [x] Stock list graded out / reorder / low / in stock, sorted by what needs
      attention, with the shortfall to par as a suggested order quantity.
      Untracked ingredients are hidden until searched for.
- [x] Receive stock and record waste against a reason, capturing the price at
      the time — so last month's waste stays valued at last month's price.
- [x] Count sheet with variance (INV-FUNC-002): expected quantities are hidden
      during entry, lines that agree are dropped from the review, and applying
      a count writes the correction it implies rather than overwriting history.
- [x] Movement history with who recorded what, and when.
- [x] Verified in the browser end to end against the local database: a receipt
      moved Shallot 3 -> 15 KG and re-graded it, a count of 9 against books of
      11 wrote a -2 COUNT movement and persisted across a reload.

Not built, and deliberately: multiple storage locations and transfers
(INV-FUNC-006), barcode scanning, photo documentation of waste, scheduled
count reminders, purchase-order integration, and theoretical-vs-actual usage
(INV-FUNC-005) — that last one needs production records the app does not yet
capture.

### Menu engineering (SRS 4.8)
- [x] Sales mix imported from a POS item-sales export. Verified against a real
      April export from another venue: 721 rows, 10 dishes matched, zero rows
      misread.
- [x] Finds the item table among the dozen summary tables a POS report stacks
      above it. Several of those also carry a "Name" column beside a "Count"
      column, so the header is chosen by how specific its quantity column is
      rather than by being first — taking the first read a table of cheque
      counts as a sales mix.
- [x] Stops at the blank row that ends the table, so the payment breakdown
      below it does not bury the skipped-rows list.
- [x] Category rows are filtered by not being the name of anything the kitchen
      cooks. These reports are hierarchical — a category row carries the total
      of the dishes beneath it — and importing one would count those sales
      twice. Every unmatched row is listed, biggest first, which is the only
      check that a real dish was not missed.
- [x] Refuses ambiguous names, duplicate rows, negative and unreadable
      quantities rather than guessing.
- [x] Classification crosses popularity against contribution in money, not
      food cost percentage: a dish at 36% food cost on a high price can
      contribute more per plate than one at 24% on a low price, and it is the
      money that pays the rent.
- [x] Popularity uses the Kasavana & Smith 70% rule rather than a plain
      average, which would put half of any menu below the line by construction.
- [x] Each quadrant states what to do about it.

- [x] An import is saved as a named period with dates, not held in the tab.
      A menu decision gets argued about, so everyone has to be able to open
      the same numbers. Periods can be switched between and removed.
- [x] Sample sales for three months, because Manuza is not trading yet and
      the analysis cannot be seen working without units sold. Every period
      carries a SAMPLE flag and the page states in as many words that the
      figures are invented — so the day a real export arrives nobody has to
      wonder which months were real. Re-runnable from
      `supabase/seed_sample_sales.sql`, which leaves real imports alone.

Not built: the rest of Phase 6 — menus with sections, menu-level costing, and
menu allergen and nutrition summaries.

### Production planning (SRS 4.11)
- [x] Prep list from expected covers (PRO-FUNC-001 AC1, AC3): dishes explode
      through every level of preparation into what must be made, ordered so
      that anything a later preparation is built on comes first.
- [x] Whole-batch scaling. A preparation yielding 1 kg cannot be made 0,9
      times, so the sheet shows what is needed, how many batches, and what
      that actually makes — and the pull list covers the batches, not the
      exact need, which is what stops a prep cook running out mid-service.
- [x] Pull list with current stock subtracted (AC4), sorted so what is missing
      sits above what is merely needed, priced at current cost.
- [x] Refuses to add quantities in different units for the same ingredient,
      and reports it. Adding grams to kilograms would understate an order by a
      factor of a thousand and nobody would notice until delivery.
- [x] Missing ingredients, missing preparations, a preparation with no batch
      yield, and preparations used inside themselves are all reported rather
      than silently dropped.
- [x] Covers persist across a reload, and the sheets print apart — the prep
      cook and whoever opens the store are different people.
- [x] Verified in the browser against the local database: 10 covers of Beef
      burger and 10 of Squid & Guanciale produced 21 pull lines, of which
      Guanciale alone showed no shortfall because 22,5 kg was on the shelf.

Not built: production scheduling with dates, cooks and equipment conflicts
(PRO-FUNC-002), and kitchen display integration (PRO-FUNC-003) — both are
"Could Have" in the SRS and need a calendar and realtime infrastructure that
would dwarf the module. Theoretical-vs-actual usage (INV-FUNC-005) still
needs completion logging, which is PRO-FUNC-002 AC6.

### Jurisdiction and tax
- [x] Compliance profile per organisation: country, food-information regime,
      currency, standard and reduced VAT, and service charge — configurable
      rather than compiled in, so a second venue in another member state does
      not need a code change.
- [x] Set to EU food law (Regulation 1169/2011) at the EU standard VAT rate of
      21%.
- [x] Tax and service charge separated. The old 21% was documented as "11%
      Indonesian PPN + 10% service charge": identical arithmetic, different
      legal meaning. A service charge is the venue's revenue and is itself
      taxable; VAT is collected for the state. Folding them together works
      until somebody files a return or reclaims input tax.
- [x] Allergens already conform — the registry is EU FIC 1169/2011 Annex II.

Open, and needing a decision rather than a default: the reduced VAT rate is
deliberately null. Most EU member states put restaurant food on a reduced rate
and alcohol on the standard rate, so 21% is right for a drinks list and too
high for a food menu. Which reduced rate applies depends on the member state,
and guessing it would overstate tax on every food line.

### Traceability and food safety (EU)
- [x] Suppliers as records rather than a name typed on each product: legal
      name, VAT number, establishment approval number for products of animal
      origin under Regulation 853/2004, contact, terms and lead time. The 81
      free-text names became 74 suppliers — six spellings were one company
      typed twice, and 177 products were consolidated onto the largest.
- [x] Stock lots: lot code as printed, supplier, delivery reference, received
      date, expiry, and temperature on arrival as cold-chain evidence under
      Regulation 852/2004. Created as part of receiving, so the record exists
      because the delivery was booked in rather than as a separate chore.
- [x] Use-by and best-before are never conflated. Past a use-by date food is
      deemed unsafe under Article 14 and the system refuses it; past a
      best-before it says the food is still legal to use. A date with no kind
      stated is reported as unjudgeable rather than guessed — guessing one way
      throws away good food, the other way serves unsafe food.
- [x] One step back (Article 18): supplier, lot, delivery note, date and
      arrival temperature for any lot, with anything missing named as missing
      rather than left blank. A gap in a traceability record is the finding.
- [x] Blocking, recall and withdrawal (Article 19) enforced by the database.
      A lot that is not OK cannot be consumed or transferred by any client —
      verified by SQL, not by a disabled button. Waste and returns stay
      allowed, because getting recalled stock off the shelf is the point.
- [x] Supplier certificates with expiry, surfaced 30 days ahead. An expired
      HACCP certificate is the same shape of problem as an expired ingredient.

Not built: one step forward beyond the kitchen — which service or batch a lot
was consumed by — needs production records the app does not yet capture.
Recall notification to the competent authority is stated on screen as the
operator's job, not automated.

### Platform
- [x] Supabase with multi-tenancy and RLS; anon revoked, cross-tenant reads and
      writes verified blocked.
- [x] TRUNCATE, TRIGGER and REFERENCES revoked from `anon` and `authenticated`
      on every table. TRUNCATE is not subject to row-level security, so the
      inherited platform grant would have let any signed-in user empty every
      tenant's data regardless of the policies.
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
