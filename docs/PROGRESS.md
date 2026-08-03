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

### Purchasing (requisitions, approvals, orders)
- [x] Requisitions with cost centre, needed-by date, justification and lines,
      numbered per year from the highest existing reference rather than a
      count, so deleting one never causes a number to be reused.
- [x] Segregation of duties enforced by the database. An approval by the
      person who raised the document is refused by trigger, matched on both
      user id and email so a document raised before somebody had an account is
      still caught. Verified in SQL, not through a disabled button.
- [x] Approval authority by amount, held as policy data finance can change
      without a deployment. Seeded at: anyone with write access below 5
      million, ADMIN at or above it, OWNER at or above 25 million. Also
      enforced by trigger.
- [x] The screen states the rule before the button is pressed — who has to
      approve this amount, and whether you are disqualified for having raised
      it. A system that only reports refusals afterwards teaches people it is
      arbitrary.
- [x] Approvals are an append-only ledger capturing actor, role and the amount
      the decision was made against, so a later edit cannot re-describe what
      was approved. No update or delete grant.
- [x] Approved requisitions split into one purchase order per supplier, since
      an order is a contract with one company. Lines with no supplier are held
      back and named rather than guessed at.
- [x] Order totals, VAT and line totals maintained by trigger.

Not built yet: goods receipts matched against an order, invoices, three-way
matching and tolerances, budgets and committed spend, and sending an order to
a supplier — marking one "ordered" does not transmit anything.

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

- [ ] **Realtime sync is not working, and the attempt was reverted.** Reads
      are still hydrate-once at startup plus a refresh when the tab regains
      focus, so a colleague's edit made while you are watching the same screen
      does not appear on its own.

      Attempted and backed out rather than shipped, because a sync that
      silently delivers nothing is worse than none: it invites people to trust
      a screen that is quietly stale, which is a costing error waiting to
      happen. What was established, for whoever picks it up:

      * The tables must be in the `supabase_realtime` publication, and need
        `replica identity full` so row-level security can filter deletes.
      * The socket needs the session token via `realtime.setAuth()`. It is a
        separate connection from the REST client and does not inherit it;
        without it every change is filtered out by RLS.
      * The realtime service caches the publication at boot, so it has to be
        restarted after the publication changes.
      * With all three done the channel subscribes without error and still
        delivers no events. Not diagnosed further.

      Verified along the way that the fetch path itself is fine: a change made
      directly in the database appears immediately on reload.

- [ ] A Playwright session token is present in git history at `3bbcc97`.
      Removing it rewrites history and needs a force-push, which is the
      repository owner's call and has not been given.

## Backlog

- [ ] **Organization switcher.** `auth_default_org_id()` now prefers an
      organisation somebody was invited into over one created at sign-up, and
      sign-up no longer creates an organisation for an invited address. So the
      common case is right. A user genuinely in two organisations still cannot
      choose between them, and there is no UI for it.
- [ ] **Notifications.** Nothing is sent anywhere. An invitation is not
      emailed, an approval request does not reach the approver, a purchase
      order marked "ordered" transmits nothing to the supplier. Every one of
      these needs a channel decision before it can be built.
- [ ] **Field-level audit history.** Recipe status transitions, stock
      movements and approvals are append-only ledgers. Everything else records
      only its current state, so "who changed this price, and when" is not
      answerable outside those three.
- [ ] **The primary entity's own UPDATE is still a separate request from the
      cascade RPC.** The fan-out commits or does not; the row that triggered it
      is written separately, leaving a small window where one succeeded and the
      other did not.
- [ ] **US 9 allergen profile.** The registry is the EU 14 (Regulation
      1169/2011). A venue under FDA rules needs the US set, which overlaps but
      is not a subset.
- [ ] Cascade `refPercent` from product yield onto recipe lines. Deliberately
      not done: ref % is editable per line in the ingredient grid, so
      overwriting it would discard a chef's intentional trim override.
- [ ] AI recipe import, and an AI assistant. Neither is started, and both
      need a provider and key decision first.
- [ ] The larger unbuilt modules, in the order they would pay off: the
      supplier/vendor portal and the communication cycle, contracts, then
      onboarding and offboarding. Scheduling and attendance are now done.

## Done since the last revision

- [x] **Shift scheduling and attendance.** A week rota, clock in and out, and
      rostered-against-worked variance.

      Working-time rules are the EU Working Time Directive (2003/88/EC), not
      invented thresholds — 11 hours daily rest, a break past 6 hours, 24
      hours weekly rest, 48 hours average weekly. Each warning cites its
      article so a manager can look it up. They are warnings rather than
      refusals: a manager sometimes has to break a rota rule and record why,
      and a system that simply refused would be worked around with a paper
      rota, after which nothing is visible at all.

      Two things the database does refuse outright, because they are unlawful
      regardless of intent: rostering somebody whose required certification
      has lapsed or is missing (852/2004 Annex II Chapter XII), and rostering
      somebody on approved leave. A draft passes; publishing is the
      commitment, so that is where the checks bite.

      A punch, once closed, cannot be edited — time becomes pay, so a record
      that can be quietly changed is one nobody can rely on. Corrections are
      separate records and cannot be approved by the person who asked for
      them. Both the original and the effective figure stay visible.

- [x] Membership management: invite by email, set roles, remove people, with
      privilege escalation refused by trigger. Was the blocker that made every
      segregation-of-duties control unusable — they need a second person and
      there was no way to add one.
- [x] Products carry a `version` column and get lost-update protection, the
      same as recipes and preparations. An earlier note claiming otherwise was
      stale.
- [x] Supplier and procurement module: requisitions, approvals, orders,
      receiving, invoice matching, budgets, analytics.
- [x] Menu engineering with real sales-mix, imported from a POS export.
- [x] RBAC and user management, in Settings.

## Open questions for the user
(Updated after competitive analysis pass #1 — see `docs/COMPETITIVE_ANALYSIS.md`)
- Accounting: recommend QuickBooks + Xero at launch, Zoho Books as secondary. Confirm.
- Payments: recommend NOT building this — integrate with POS instead (industry norm).
  Which POS system(s) should be first-priority integrations?
- Staff management: recommend scoping to scheduling/labor forecasting only, integrating
  out to a real payroll provider rather than building payroll. Confirm scope.
- Confirm target launch market(s) — affects tax/currency/compliance defaults (VAT vs.
  Indonesian PPN, UAE WPS payroll compliance vs. Indonesian equivalents).
