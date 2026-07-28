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
- [ ] The UI does not yet respect the VIEWER role — the database refuses the
      write, but the editors still present Save as though it will succeed.
- [ ] Reads are hydrate-once at startup. No realtime subscription and no
      refetch, so a second user's edits are not seen until reload.
- [ ] Writes are optimistic and not transactional: the entity and its cascade
      are separate requests, so a mid-cascade failure can leave the database
      inconsistent with the UI until the next reload. Wrap the cascade in an
      RPC/transaction.
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
