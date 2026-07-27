# Progress Tracker

## Done
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
- [ ] Wire the app to Supabase (replace the in-memory Zustand mock stores);
      `supabase/migrations/0001_init.sql` already covers products/sub-recipes/
      recipes/costing
- [ ] Move money off `number` and onto decimal.js. `docs/DECISIONS.md` already
      calls for DECIMAL, and the dependency is installed but unused. Float
      representation is visible today: a 0.165 line cost renders as "0.16".
      Totals sum unrounded so they stay correct, but per-line display is off
      by a fils.
- [ ] Persist nutrition/allergens on save — the sub-recipe editor currently
      carries the previous values through rather than deriving them
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
