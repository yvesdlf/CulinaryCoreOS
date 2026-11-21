# Simphony R&A vs CulinaryCoreOS — feature comparison and gaps

Researched 2026-11-21 from Zumana Beach Club's live Oracle MICROS Simphony
Reporting & Analytics portal (user-level view) and cross-referenced against
CCOS as it stands on the reports stack (PRs #23–#28 plus the two fixes).

Raw capture: `simphony-raw-capture.md` in this folder.

> Scope note. Simphony is a POS reporting suite: its world is sales, checks,
> tenders, dayparts, revenue centres and labour clock-ins. CCOS is an
> operations system: recipes, costing, stock, purchasing, HR, maintenance,
> housekeeping, hygiene, plus the sales/takings it imports. The two overlap on
> **reporting shape and the executive dashboard**, which is where the useful
> ideas are. They do not overlap on the POS transaction engine, and CCOS
> should not try to become one.

---

## 1. The two things worth taking

Everything below rolls up to two structural ideas CCOS does not have and
Simphony does, both of which the research made concrete:

**A. A configurable dashboard of comparison + forecast tiles.**
Simphony's dashboard is a grid of ~11 tiles, each a mini-report, governed by:
- **Role Defined vs Person Defined** tiles — the org sets a sensible default
  board per role that auto-inherits updates; an individual can switch to
  their own chosen, ordered set.
- **Global parameters** (Location + Revenue Centre) that re-scope the whole
  board at once.
- Two tile shapes that recur: **Today vs same-day-last-week vs
  same-day-last-year, with variance %**, and **actual vs forecast** overlaid
  on one axis, with the current trading hour marked.
- **Drill-through** from every tile into the full report.

CCOS's dashboard (`unit_overview`) is a *fixed* set of per-unit operational
counters (revenue today, emergency jobs, unread handovers, …). It has no
comparison tiles, no forecast tiles, no customisation, no drill-through. Yet
CCOS already **computes** almost everything the Simphony tiles show — the
period engine already does same-time-last-year, and forecasts already exist
in `seed_takings`/`daily_forecasts`. The capability is present and unsurfaced.

**B. A report library you browse and subscribe from.**
Simphony ships **251 report templates in 16 categories**, searchable by name,
description, category and tag, with a per-role permission model; "My Reports"
is the subset a role/user has added. CCOS has **14 reports, hardcoded as tabs**
with no library, no search, no per-role curation. CCOS does not need 251
reports — but the *library + personal selection + role defaults* pattern is a
real product capability it lacks, and it is the same pattern as the dashboard's
Role/Person tiles.

---

## 2. Report-by-report: what maps, what's new

| Simphony report / concept | CCOS today | Gap |
|---|---|---|
| Net Sales (today vs wk vs yr, variance) | Trend report has the data; no same-day tile | **Dashboard tile** |
| Net Sales Forecast (last 7 / next 7, current hour) | `daily_forecasts` exist; not on dashboard | **Forecast tile** |
| Cost of Goods Sold (today vs wk vs yr, %) | Cost of goods report | **Comparison tile** |
| Net Sales & Labor Cost % (dual axis, 14 days) | Labour-against-revenue report | **Trend tile** |
| Average Spend per Guest / per Table Turn (forecast, per hour) | covers/guest counts exist; no per-hour | Needs **daypart/hour data** — see §4 |
| Top 10 Employee Net Sales | sales attributed to outlets, not staff | Needs **sales-by-employee** — see §4 |
| Top 10 / Major Group Net Sales | menu-item + category sales exist (menu engineering) | **Top-N tile** — buildable |
| Adjustments (voids/comps) | not tracked (no POS void feed) | Blocked — POS data |
| Service Performance (by daypart/hour/qtr-hr) | business_date only, no time-of-day | Needs **daypart data** — see §4 |
| Employee Productivity / Exceptions / Financial | labour + tips not modelled per head for sales | Partly blocked — POS data |
| Sales Variance (date vs wk vs yr) | period engine does exactly this | **Report — buildable now** |
| Service by Weekday / Sales by Weekday | trend + takings by date | **Report — buildable now** |
| KPI Comparison (by date/location/RC) | per-outlet figures exist | **Report — buildable now** |
| Menu Engineering (margin by group/item) | **already have it** (menu-engineering page) | Parity |
| Income Audit by Discount / Tender | discounts/tenders not imported | Blocked — POS data |
| Kitchen Performance / KDS Aging | production records exist, no KDS | Partial — see §4 |
| Payroll / Time Card / Clock-in / Tip Exceptions | rota, shifts, clock-in all exist | **Reports — buildable now** |
| Open Checks / No Sale / Processed Transactions | no live check feed | Blocked — POS data |
| Posting Calendar (which dates have data) | — | **Data-health view — buildable now** |
| Customer Activity / Card Activity / Campaigning | no CRM/loyalty/giftcard | Blocked — no data domain |
| Regional (multi-location rollup) | multi-org exists; no rollup report | **Report — buildable later** |
| Common Currency (multi-currency consolidation) | single currency per org | Blocked — needs FX model |

---

## 3. Gaps that are buildable NOW (CCOS already has the data)

Ranked by value-to-effort. These need no POS integration and no decision from
the owner — they re-surface data CCOS already computes.

1. **Dashboard comparison tiles** — Net sales, gross profit and cost-of-goods
   as *today vs same-day-last-week vs same-day-last-year, with variance %*.
   The period engine already does same-time-last-year; this is a new tile
   component over existing figures. Highest value: it is the single thing the
   owner pointed at.
2. **A customisable dashboard** — Role-default tiles + per-person override and
   ordering, mirroring Simphony's Role/Person model and CCOS's own
   section-permission model. The scaffolding the comparison tiles live in.
3. **Forecast tiles** — Net-sales forecast (last 7 / next 7 days) and the
   current-period pace, from `daily_forecasts`, with actual-vs-forecast
   overlaid. CCOS computes forecasts and never shows them on the dashboard.
4. **Sales Variance report** — net sales for a date vs previous week vs
   previous year with variance, which is the period engine's native output.
5. **Sales / Service by Weekday report** — takings and covers bucketed by
   weekday, the "which days actually make money" view.
6. **A labour pack** — Clock-in status, Time-card summary (hours & pay by job
   code), Payroll summary. CCOS has rota, shifts, clock-ins and pay rates;
   none is a report yet.
7. **Posting Calendar / data-health view** — a red/green calendar of which
   business dates have posted takings/sales, surfacing gaps in the record.
   Cheap, and it is the honest-caveats discipline CCOS already prizes.
8. **A report library + search** — lift the 14 hardcoded tabs into a searchable,
   categorised, role-curated library with personal favourites, so the set can
   grow without the page becoming a wall of tabs.

## 4. Gaps blocked on data CCOS does not yet have

These need either a POS feed or a new data domain, and therefore an owner
decision — they are **not** in the build set, and the final report flags them.

- **Daypart / hour-of-day** analytics (service performance, average spend per
  guest/table-turn by hour). CCOS sales carry `business_date` but no time of
  day. Blocked until POS import carries timestamps (the P2 POS brief).
- **Per-employee sales, voids, comps, discounts, tenders** — need the POS
  transaction feed. (Employee *labour* is available; employee *sales* is not.)
- **Open/No-sale/Processed checks** — need a live check feed.
- **Customer Activity, Card Activity, Campaigning** — need CRM / loyalty /
  gift-card domains CCOS does not model.
- **Common Currency consolidation** — needs an FX/normalisation model.

## 5. Recommended sequence

Build §3 as one coherent piece of work — it is the owner's stated interest
(dashboard + reporting), it is all unblocked, and it shares one spine (the
tile framework and the library both reuse CCOS's section-permission model).
Items 1–3 (the dashboard) first, because that is what was pointed at; then the
four net-new reports (4–7) which slot into the existing Reports page the six
new reports already extended; then the library (8) last, as it reorganises
rather than adds. §4 goes to the owner as decisions, and most of it is already
the queued **P2 POS** brief.
