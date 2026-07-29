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
