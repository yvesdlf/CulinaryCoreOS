# Progress Tracker

## Done
- [x] Visual regression + accessibility suites (Design Bible §12, §15) using
      Playwright and axe-core. 15 visual baselines covering every list, both
      editors, and isolated allergen/cost/focus-ring components, each in light
      and dark. 12 axe checks at WCAG 2.2 AA across both themes.
      The scan found and fixed 4 real defects, all introduced by the token
      work: filter and editor selects were comboboxes with no accessible name
      (critical); the ingredient grid's quantity and ref% inputs had no label
      and its delete buttons no name (critical); Slate 500 secondary text is
      only 4.39:1 at 12px on ivory, and success/warning foregrounds were
      3.7:1 on their own soft fills (serious). Tokens darkened to
      #69707e / #367b50 / #966300 and a nav-specific muted token added, since
      light-theme secondary text is 3.23:1 on graphite.
      Note the visual suite was initially useless: Playwright's default
      per-pixel threshold of 0.2 — and 0.05 — both passed a full revert of the
      ivory ground to pure white. 0.02 was established empirically as the value
      that actually catches it, verified by breaking the token and confirming
      the failure.
- [x] Design Bible §3/§4 foundation applied. The app had been running the stock
      shadcn neutral theme — pure white against DDL-0001's explicit "warm ivory
      instead of pure-white", Geist instead of the specified stack, and 70 raw
      palette classes across 5 feature files in breach of §14.5/§18.3. Now:
      ivory #F8F7F4 ground, graphite navigation, accessible sage #5A7554
      action, semantic status/module tokens, Inter (SF Pro first where
      licensed). Zero raw palette classes remain and no `dark:` variants are
      needed — the tokens re-derive per theme, so dark mode is a real theme
      rather than an inversion (§14).
- [x] Allergen icons moved from emoji to Lucide (§4 forbids mixing icon
      families; the CPSM registry calls for monochrome assets). Peanuts and
      tree nuts share the Nut glyph deliberately — they are legally distinct
      and the PNT/NUT codes carry that, which is precisely why an icon may
      never stand alone.
- [x] VIEWER role reflected in the UI. The database already refused these
      writes; the editors offered Save anyway and failed afterwards. Save and
      the create actions now render as disabled "Read-only access" / "View
      only" with the reason. Disabled rather than hidden, per §5 — and this is
      an honesty affordance, not authorisation (§14.7).
- [x] SRS reviewed (CC-SRS-001 v1.0.0)
- [x] Source workbooks analyzed (1_-_Recipes.xlsm, 2_-_Sub_Rec.xlsm)
- [x] Naming decision made (CulinaryCoreOS / CCOS, working name)
- [x] Repo scaffolded: monorepo structure, docs, shared types, initial DB schema
- [x] Competitive analysis pass #1 (see `docs/COMPETITIVE_ANALYSIS.md`)

### Phase 1 web app — functional on mock data (no Supabase yet)
- [x] Tailwind v4 + shadcn/ui (Base UI flavour) configured; `@/*` path alias
- [x] App shell: sidebar nav, breadcrumb header, dark-mode toggle, Cmd+K palette
- [x] Cost engine (`apps/web/src/engine/cost-engine.ts`) — gross-qty waste
      adjustment, line cost, security margin, food cost %, contribution margin,
      VAT strip, sub-recipe cost/unit, recommended price
- [x] Nutrition engine — line scaling, aggregation, per-portion and per-100 g
- [x] Mock dataset: 20 products, 5 sub-recipes, 5 recipes; Zustand stores
- [x] Products: list (search/category/status filters) + full detail form
      (General / Packing / Cost & Yield / Nutrition, live derived fields)
- [x] Recipe editor: ingredient autocomplete over products *and* sub-recipes,
      editable line grid, live cost summary + nutrition panel
- [x] Sub-recipe editor: batch costing panel, editable security margin
- [x] Verified in-browser: `pnpm --filter web build` clean, cost cascade correct
      (220 g @ 20 % ref -> 275 g gross -> AED 41.25 -> 26.5 % food cost)
- [x] Money moved off `number` onto decimal.js, per `docs/DECISIONS.md`. The
      cost engine takes `Decimal.Value` and returns `Decimal`; conversion to
      number happens only at the UI boundary. Fixes real errors — in float,
      30 * 0.0055 is 0.16499999999999998 and rendered "0.16".
- [x] Currency switched to IDR with `id-ID` formatting ("Rp 795.500", dot
      groups / comma decimals, 0 dp by convention; per-unit ingredient costs
      override to 2-4 dp or they would all read "Rp 0"). Tax default is now
      Indonesian PPN at 11%, replacing UAE VAT at 5% — this changes every food
      cost %, since price-excl-tax is the denominator. Mock catalogue converted
      at 4.300 IDR/AED and all derived fields recomputed.
- [x] Fixed waste double-counting: line cost is `grossQty * costPerUnit`, and
      `grossQty` already carries the waste adjustment. The engine and the
      ingredient autocomplete were both resolving `nettPricePerUnit`, which
      carries it too — inflating every trimmed product by 1/(1-ref%). Beef at
      20% trim was costing 25% high. Now uses `grossPricePerUnit`.
- [x] Supabase persistence. `0002_align_with_app_model.sql` closes three gaps
      found while wiring it: allergens had no column at all and were being
      dropped, per-unit costs were numeric(14,4) against a 5dp cost engine, and
      currency still defaulted to AED. `supabase/seed.sql` is generated from the
      mock catalogue with deterministic uuid v5 ids. Stores hydrate at startup
      and write through on change; with no credentials configured the whole
      layer no-ops and the app runs on mock data exactly as before.
- [x] Costing model aligned to the venue's own workbook (COGS V5), with tax,
      waste and inflation editable per sub-recipe and per recipe (migration
      0006). Previously these were hard-coded globals — a 5% "security margin"
      and 11% VAT — which suited no real venue.
      * Menu price is now held EXCLUDING tax; the guest price is derived. The
        old model stored a tax-inclusive price and stripped it back, which is
        the opposite of how a chef sets a price.
      * COG = cost + waste + inflation, both taken on raw cost rather than
        compounding. Food cost % = COG / menu price.
      * Tax defaults to 21% (11% PPN + 10% service). Waste defaults to 5% on
        sub-recipes and 0 on recipes, inflation to 4% on recipes and 0 on
        sub-recipes — applying both at both levels would double-count. All
        remain editable in either direction.
      * Verified: the engine reproduces the workbook's own COG and cost % to
        six decimal places on three sampled dishes.
- [x] Trustworthy writes pass:
      * Nutrition, allergens and the free-from dietary flags are now DERIVED on
        save instead of carried forward. Both editors were writing back the
        previous values while the panel displayed live ones — Margherita Pizza
        stored 545 kcal against a real 1203. Panel and save now share one
        function so they cannot drift again. Vegetarian/vegan stay
        author-controlled: an allergen list cannot imply them.
      * Recipe edits were never reaching Supabase at all — the editor called
        the store directly and `persistence` had no recipe path. Fixed; verified
        by reading the row back from Postgres.
      * The cascade is atomic (migration 0005 `apply_cascade`). It was a
        fan-out of independent requests, so a mid-cascade failure left the
        database half-written while the UI showed a consistent result. Verified
        by forcing a failure part-way: the earlier sub-recipe update and its
        line deletion both rolled back. SECURITY INVOKER, so tenant policies
        still apply.
      * Lost-update protection on recipes and sub-recipes via the existing
        `version` column, which nothing had been reading. Verified: a second
        save carrying a stale version affects 0 rows instead of clobbering, and
        surfaces a distinct "Save conflict" toast with a reload action.
- [x] Multi-tenancy and real RLS (migration 0004). Organizations + membership
      with roles; every data table carries `org_id`; policies scope reads to
      the caller's organizations and writes to roles above VIEWER. Clients
      never send `org_id` — a BEFORE INSERT trigger stamps it and the policy's
      WITH CHECK re-verifies, so a tampered client cannot cross tenants.
      Membership lookups go through SECURITY DEFINER functions to avoid policy
      recursion, are STABLE so they run once per statement, and pin
      `search_path` against hijacking. Sign-up creates the user's own org.
      `anon` is revoked from every data table.
      Verified: anon gets 42501 on read and write; a second tenant sees zero
      rows; and as that tenant, inserting with a forged org_id is rejected
      42501 while updating and deleting another org's product both affect no
      rows. App-side auth (sign in/up, session persistence, route guard,
      org context in the header) added to match.
- [x] Supabase persistence. Migrations 0002 (allergens column, 5dp per-unit
      money, IDR default, updated_at triggers) and 0003 (grants + RLS) on top
      of the original schema; `supabase/seed.sql` generated from the mock
      catalogue with deterministic uuid v5 ids. Stores hydrate at startup and
      write through on save; with no credentials the app falls back to the
      in-memory catalogue, so a fresh clone runs with no database.
      Verified against local Postgres with psql: a 10x flour price wrote
      through and the cascade persisted — Pizza Dough 16.138 -> 113.662,
      Margherita Pizza 10,4% -> 13,6% food cost transitively, Caesar Salad
      untouched. `supabase db reset` replays migrations + seed cleanly.
- [x] Cascading recalculation (`apps/web/src/engine/cascade.ts`): a product cost
      change re-costs every dependent sub-recipe and recipe, to unlimited depth
      and safe against reference cycles. Verified end-to-end — 10x on flour
      moved Pizza Dough 3.76 -> 26.43 and, transitively, Margherita Pizza
      9.3 % -> 13.0 % food cost, while unrelated recipes kept both their
      numbers and their object identity.

Note: `apps/web/package.json` needs `"type": "module"` — Vite 5 cannot load the
ESM-only `@tailwindcss/vite` plugin from a CommonJS package.

## In progress / next up
- [ ] Add Integrations module to SRS (accounting: QuickBooks/Xero; POS: TBD; payroll: TBD)
- [ ] Add explicit multi-location transfer support to Inventory Management module (4.10)
- [ ] Review `supabase/migrations/0001_init.sql` against SRS Section 4 in full
      (this first pass covers recipes/sub-recipes/products/costing only —
      allergens, menu engineering, procurement, inventory, production
      planning tables still need to be added)
- [ ] Decide on accounting/payments/staff-management integration strategy
      (see gaps flagged in Competitive Analysis)
- [ ] Set up Supabase project (local + hosted) — requires user's machine
- [ ] Generate iOS project via Capacitor — requires user's machine + Xcode
- [ ] Generate macOS project via Tauri — requires user's machine + Rust

## Backlog (from SRS, not yet started)
- [ ] Membership management: invites, role changes and removing a member are
      deliberately not client-writable. `organization_members` has a read
      policy only, so this needs a server-side flow.
- [ ] Organization switcher. `auth_default_org_id()` takes the oldest
      membership, so a user in more than one org always writes to the first.
      write, but the editors still present Save as though it will succeed.
- [ ] Reads are hydrate-once at startup. No realtime subscription and no
      refetch, so a second user's edits are not seen until reload.
- [ ] Writes are optimistic and not transactional: the entity and its cascade
      are separate requests, so a mid-cascade failure can leave the database
      inconsistent with the UI until the next reload. Wrap the cascade in an
      RPC/transaction.
- [ ] Products have no `version` column, so they get no lost-update protection
      (recipes and sub-recipes do). Add one if concurrent product editing
      becomes a real scenario.
- [ ] The cascade fan-out is atomic, but the primary entity's own UPDATE is
      still a separate request from it. Folding that into the same RPC would
      close the last window.
- [ ] Cascade `refPercent` too, if product yield should override recipe lines.
      Deliberately not done: ref % is editable per line in the ingredient grid,
      so overwriting it would discard a chef's intentional trim override.
- [ ] Allergen management (EU 14 + US 9 union)
- [ ] Menu engineering matrix
- [ ] Supplier & procurement module
- [ ] Inventory management
- [ ] Production planning / prep lists
- [ ] AI recipe import (from the two source workbooks, as first real dataset)
- [ ] AI conversational assistant
- [ ] Reporting & analytics
- [ ] RBAC / user management
- [ ] Audit logging / version control per entity
- [ ] Notifications & tasks
- [ ] Document management

## Open questions for the user
(Updated after competitive analysis pass #1 — see `docs/COMPETITIVE_ANALYSIS.md`)
- Accounting: recommend QuickBooks + Xero at launch, Zoho Books as secondary. Confirm.
- Payments: recommend NOT building this — integrate with POS instead (industry norm).
  Which POS system(s) should be first-priority integrations?
- Staff management: recommend scoping to scheduling/labor forecasting only, integrating
  out to a real payroll provider rather than building payroll. Confirm scope.
- Confirm target launch market(s) — affects tax/currency/compliance defaults (VAT vs.
  Indonesian PPN, UAE WPS payroll compliance vs. Indonesian equivalents).
