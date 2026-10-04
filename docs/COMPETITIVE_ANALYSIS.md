# Competitive Analysis — CulinaryCoreOS (CCOS) vs. Market

Pass #1, 2026-07-26. Web-verified where noted; revisit before roadmap lock-in.

## Naming collision check (side effect of this research)

Two of the brainstormed alternate names turned out to already be taken:
- **GastroCore** — an existing German hospitality software brand (gastrocore.de)
- **KitchenOS** — already used by Fresco, a smart-appliance connectivity platform
- **Recipeworks** — an old (~2011-era) PC/PDA recipe app of the same name, likely dormant but still a registered product name

Reinforces the plan already in `docs/NAMING.md`: don't lock in a public name without a real clearance pass.

## Feature comparison

| Capability | **CCOS (planned)** | Apicbase | Crunchtime | MarketMan | Supy | StockTake Online | ChefTec | Meez | Galley |
|---|---|---|---|---|---|---|---|---|---|
| Recipe/sub-recipe costing | ✅ core | ✅ | ~ | ~ | ~ | ✅ | ✅ | ✅ (best-in-class UX) | ✅ |
| Nutrition + allergen inheritance | ✅ planned | ✅ (AI-assisted) | – | – | – | ✅ (tags) | ✅ | ✅ | ✅ |
| Menu engineering | ✅ planned | ✅ | ~ | – | – | – | ~ | ✅ | ✅ |
| Procurement / supplier mgmt | ✅ planned | ✅ | ✅ | ✅ | ✅ (deep — multi-level approvals) | ✅ | ~ | integrates out | ✅ |
| Inventory / stock control | ✅ planned | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | integrates out | ✅ |
| Production planning | ✅ planned | ~ | – | – | ~ | – | – | – | ✅ (strong — multi-day, shelf-life aware) |
| Multi-location / transfers | not yet in SRS scope | ✅ | ✅ | ✅ | ✅ | ✅ (core feature) | ~ | ~ | ~ |
| **Accounting integration** | ❌ not in SRS | – (has finance data, integration unclear) | ✅ QuickBooks, NetSuite, Workday, Great Plains, Zoho | ✅ QuickBooks, Xero | ✅ (integrates with accounting/ERP) | ✅ Xero, PaperChase | – | ✅ (connects to finance systems) | – |
| **Staff scheduling / labor** | ❌ not in SRS (only RBAC) | – | ✅ full labor forecasting + payroll sync (ADP, Workday, Paychex) | – | – | ~ (HR offered as a paid "Assist" service, not core software) | – | – | – |
| **Payments** | ❌ not in SRS (by design — see note) | – | – | – | – | – | – | – | – |
| POS integration | not yet in SRS scope | ✅ | ✅ | ✅ | ✅ (50+ POS) | ✅ (Toast, Lightspeed, Aloha, TISSL, Grafterr, HubRise) | – | – | – |
| AI-native positioning | ✅ planned (multi-provider abstraction) | ✅ (now markets as "AI-native BOH OS") | ~ (AI forecasting) | ~ (AI invoice scanning) | ✅ (heavy AI investment, "unified intelligence layer") | ✅ (AI invoice scanning) | – | – | ~ |
| Native mobile app (iOS/Android) | ✅ planned (Capacitor) | ✅ | ✅ | ✅ | ✅ | ✅ | ~ | ❌ (browser-only — a reviewer complaint) | ❌ (reviewers want one) |
| Offline-first | ✅ planned — genuine differentiator | unclear | unclear | unclear | unclear | unclear | – | – | – |
| Apple ecosystem depth (Face ID, Handoff, Spotlight, Shortcuts, Watch) | ✅ planned — **no competitor found doing this** | – | – | – | – | – | – | – | – |
| API-first | ✅ planned | ~ | ✅ (broad integration catalog) | ~ | ~ | ~ | – | ~ | ✅ (explicitly markets this) |

`✅` = confirmed strong/native · `~` = partial or unclear · `–` = not found/offered · `❌` = confirmed gap in current SRS

## What this means

### 1. Accounting integration is table stakes, and CCOS has none scoped
Every direct competitor checked (Crunchtime, MarketMan, Supy, StockTake Online) integrates
with QuickBooks and/or Xero at minimum; Crunchtime adds NetSuite, Workday, Great Plains, Zoho.
**Recommendation:** don't build accounting — integrate. Add an "Integrations" module to the
SRS with QuickBooks + Xero as launch targets (broadest coverage), Zoho Books as a
lower-cost-market option. Design the cost/procurement data model so ledger export is a
thin adapter, not a rearchitecture.

### 2. Staff management is a real gap — but scope it carefully
Crunchtime is the only one with a full labor/scheduling/payroll product; StockTake Online
sells HR as a human-delivered service, not software. This is a genuine opportunity but
also a scope trap — full payroll (tax withholding, multi-jurisdiction compliance) is its
own product category. **Recommendation:** scope CCOS's staff module to scheduling +
shift/labor-cost forecasting tied to production planning (a natural extension of your
existing Production Planning module), and integrate with dedicated payroll providers
(Deputy, Workday, ADP, or region-specific — e.g. UAE WPS-compliant providers, Indonesian
payroll platforms like Gadjian/Talenta) rather than building payroll itself.

### 3. Payments: correctly out of scope — don't build this
No competitor processes payments directly; that's POS territory (Toast, Square, Lightspeed,
NCR, etc.), and all of them integrate with POS rather than replacing it. CCOS should do
the same: add POS integration to the Integration Requirements section (section 7 of the
SRS) if it isn't already comprehensive there, and explicitly do **not** build a payments
product. This avoids PCI-DSS scope entirely.

### 4. "AI-native" is no longer a differentiator by itself
When the SRS was drafted, AI-abstraction-layer positioning was a stronger wedge. As of
mid-2026, Apicbase markets itself as an "AI-native back-of-house operating system" and
Supy has built its own internal AI infrastructure. The multi-provider abstraction (SRS
section 1.4) is still sound engineering, but it won't read as novel in a pitch. The two
angles nobody else is covering:

- **Native mobile + offline-first** — Meez and Galley reviewers actively complain about
  lacking a real mobile app; MarketMan/Supy/StockTake Online have apps but none claim
  offline-first architecture. This is a real, defensible differentiator.
- **Apple ecosystem depth** (Face ID, Handoff, Spotlight, Shortcuts, Apple Watch) — no
  competitor found doing this at all. Worth featuring prominently rather than treating
  as a footnote.

### 5. Multi-location transfers aren't explicit in the SRS yet
Supy and StockTake Online both treat "transfer between locations" as a named, core
feature. CCOS's SRS Inventory Management module (4.10) should explicitly call this out
if it's implied but not written down — worth a doc pass.

## Future-proofing recommendations

- **Integrations layer, not integrations-as-afterthought.** Every competitor above lives
  or dies by its integration catalog (POS, accounting, payroll, suppliers). Design an
  adapter/plugin architecture for this from day one rather than hard-coding one-off syncs.
- **API-first**, matching Galley's explicit positioning — CCOS's own AI assistant and any
  future partner integrations depend on this being true internally, not just marketed.
- **Modular monolith → services** — keep the current Supabase/Postgres monolith but draw
  clean module boundaries (cost engine, nutrition engine, procurement, staff) now, so any
  module can be extracted into its own service later without a rewrite.
- **Region-aware compliance from the schema up** — given the real origin data spans UAE
  (per original SRS assumption) and Indonesia (actual source restaurant), design currency,
  tax (VAT vs. Indonesian PPN), and payroll-compliance fields as configurable per-tenant
  from the first migration, not retrofitted later.
- **Revisit "AI-native" messaging** once the feature set is real — lead with offline-first
  + Apple ecosystem depth instead, since that's uncontested ground right now.

## Sources
Apicbase, Crunchtime, MarketMan, Supy, StockTake Online, Meez, and Galley marketing/support
pages and third-party review aggregators (Capterra, GetApp, SoftwareAdvice, SelectHub),
accessed 2026-07-26. ChefTec info from cheftec.com. Treat as directionally accurate, not
contractually verified — vendor pricing/features change; re-verify before any competitive
claims go into external-facing material.

---

## Q3 Aurelia — reviewed 2026-09-20

Singapore-headquartered, with offices in Thailand, Malaysia, **Indonesia**,
Vietnam and the Philippines. The closest thing to a direct regional peer yet
reviewed, and operating in the same market as Manuza.

**What they sell:** Q3 Financials Cloud (payables, receivables, general
ledger, fixed assets, bank reconciliation, multi-currency, USALI-shaped chart
of accounts), Q3 Purchasing & Inventory (purchase requests, orders, receiving,
stock take, recipe costing, barcode counting, multi-outlet visibility), four
payment products, e-invoicing against the Malaysian IRBM mandate, and business
reporting that consolidates POS with GrabFood, FoodPanda and Easi.

**Integration is a product, not a feature.** Oracle Opera PMS, Simphony POS,
Materials Control, bank interfaces, payroll. Their FAQ leads with terminal
integration and PCI DSS rather than with any function of their own software.

### Where the two products actually sit

|  | Q3 Aurelia | CulinaryCoreOS |
|---|---|---|
| Accounting ledger | full | none, and deliberately |
| Payments | four products | none, and deliberately |
| E-invoicing / tax filing | yes | **nothing** |
| Purchasing and inventory | yes | yes, and deeper on costing |
| POS / PMS integration | core business | none |
| Multi-currency | yes | single currency |
| Chart of accounts | USALI-shaped | none |
| Barcode counting | yes | not built, deferred to the phone app |
| Real-time stock across outlets | sold as a headline | not possible yet — one unit spine first |
| Fixed assets | full register, depreciation, disposal | asset register for maintenance only; purchase cost held, nothing financial done with it |
| Recipe costing and cascade | "link inventory to menu items" | five decimal places, cascading, tested |
| Allergens and EU food law | not mentioned | EU 14, inherited, verified |
| HACCP and food safety records | not mentioned | the venue's own forms |
| Traceability, lots, recall | not mentioned | one step back, Article 18 |
| HR, rota, certificates, training | not mentioned | built |
| Maintenance and housekeeping | not mentioned | built |
| Controls proved in the database | not claimed | the whole basis of the design — and since 2026-09-20, 579 of those proofs run in CI on every push rather than having been run once by hand |
| Shipping to paying customers | yes — a commercial product sold across six countries | **no — it runs on one laptop** |

**They are a back office. We are an operation.** The overlap is one module out
of eight, and on that module they are broader while we are deeper.

### What that implies

1. **Do not build a ledger, and do not build payments.** Seeing a competitor's
   up close confirms the existing recommendation rather than unsettling it.
   Both are large, both are undifferentiated, and both have incumbents.
2. **E-invoicing is not optional.** It is the one thing on their list that is
   a legal obligation rather than a convenience, and we have nothing. Gap 35.
3. **Revenue does not arrive from one place.** Their reporting consolidates
   delivery aggregators alongside the till. Any revenue model we build has to
   carry a channel from the start, or it will be wrong by whatever GrabFood
   took. Gap 36.
4. **Our asset register is half a fixed-asset register already.** It holds a
   purchase cost and does nothing financial with it. Depreciation would make
   one record serve maintenance and finance at once. Gap 38.
5. **The moat is compliance and operations.** Allergens, HACCP, traceability,
   working-time rules, certificate gating, segregation of duties. None of it
   appears anywhere in their material, and all of it is the part a venue
   cannot buy its way out of. That is where the effort should stay.

### Progress since — reviewed 2026-10-03 (second review, same day)

**Two of the eight gaps have now closed, and one of them is the one this
document argued hardest for.**

- **Gap 36 — revenue by channel: closed.** Point 3 above said any revenue model
  "has to carry a channel from the start, or it will be wrong by whatever
  GrabFood took". Migration 0065 does exactly that: takings are recorded per
  unit per day *per channel*, a row carries the gross and what the platform
  withheld, and `net` is generated from the two. Neither figure is called "the
  revenue", because the customer paid one and the venue banked the other and a
  report that picks one is wrong for whoever wanted the other. Covers sit on
  the same row, so spend per head is answerable.
- **Gap 42 — real-time stock across outlets: unblocked rather than closed.**
  The note said it was blocked by gaps 5 and 6. Both are now done: one business
  unit tree (0058) and permissions that can name a unit (0062). The remaining
  work is the reporting, not the structure.
- **Gap 38 — depreciation: still open, but the half it needed is now there.**
The note said the asset register "holds a purchase cost and does nothing
financial with it". `unit_profit_daily` and `accounting_export` are the
financial side it would post into, so depreciation is now a schedule and a
monthly line rather than a new reporting layer.

**Gaps 35, 37, 39, 40 and 41 have not moved** — e-invoicing,
  depreciation, barcode counting, multi-currency and a USALI chart of accounts
  are all still open. This paragraph exists so nobody reads two closed gaps as
  the table above having improved generally.

What else moved, in their terms rather than ours: the platform now knows what
an hour of work costs (0064) and what a day earned (0065), which between them
turn every cost figure it has ever produced into one half of an arithmetic
rather than the whole of a report. That is the ground the comparison is fought
on — they consolidate revenue and we could not read it at all.

What did move is the part of the comparison that was a claim about the design
rather than a feature:

- **The database controls are now proved automatically.** The last row of the
  table above said the controls were "the whole basis of the design", which was
  true of the design and overstated the evidence: every one of them had been
  proved once, by hand, in a scratch file nobody kept. `supabase/tests/` now
  holds 579 checks — up from 98 a fortnight ago — across access, maintenance,
  housekeeping, purchasing, the rota, the business-unit tree, unit-scoped
  permissions, media, production, starting data, use-by dates, the
  add-a-department contract, pay and revenue, run against a schema rebuilt from
  empty on every push, and proved able to fail. Four real defects were found by
  falsifying those checks during stages 1 and 2, including a food-safety
  control that this project's own documentation had claimed existed since
  August and did not. That is the one line in this comparison that was closest to marketing
  and is now the best-evidenced thing in it.
- **A lint gate exists**, which found one real defect and 29 pieces of dead
  code. Minor competitively; it belongs here only because the row above about
  being able to trust the thing is the row this document leans on.
- **The platform can now talk, except for the last hop.** The outbox has been
  filling since migration 0031 and nothing had ever drained it; there is now a
  worker that claims, backs off, respects quiet hours and never sends the same
  thing twice — and no message has reached an inbox, because that needs a
  provider account. Against a competitor that emails suppliers today, "built
  except for the part that emails" is the honest position and is not the same
  as built.
- **Deployment configuration exists**, and the product is still not deployed.
  The gap between those two sentences is the honest position: they are selling
  a running product across six countries, and nobody outside this building has
  ever opened ours. Of everything in this document that row is the one that
  matters most, and it is unchanged.

**What this says about the comparison.** The two products still barely overlap,
and the overlap has not shifted. Where the effort has gone in the past fortnight
is into making the existing claims checkable rather than into closing their
lead on finance — which is the right order, given that the recommendation is not
to compete on finance at all. But it does mean nothing in the "What that
implies" list above has been acted on, and the e-invoicing obligation in point 2
is still a legal requirement with nothing built against it.
