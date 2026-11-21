# Simphony R&A — raw capture (Zumana Beach Club, YL user level)
# Captured 2026-11-21 from the live portal. User-level view; admin/EMC features not visible here.

## Top-level areas
Dashboard | My Reports | Guest Checks | Library

## My Reports — 26 reports, 7 categories

### Summary (5)
- Revenue Center Tip Report
- Employee Threshold Exceptions — checks/transactions meeting/exceeding 12-week thresholds for adjustments or non-sales
- Daily Operations — sales and operating metrics
- No Sale Transactions — transactions with no sales by location and business date
- Open Checks — open checks <60 days by location, revenue center and employee

### Daily Detail (2)
- Journal Report — POS journal logs
- Cash Management — transaction, deposit and over/short totals

### Operations Performance (6)
- Service Performance — metrics by daypart, hour, quarter-hour
- Employee Productivity — sales, tips, operational KPIs by employee
- Authorized Transactions — authorized transaction detail by authorizing employee
- Employee Exceptions — adjustments, sales, tips by employee
- Employee Financial — sales metrics by employee, drill into financial detail
- System Financial — sales/operating summary + discounts, service charges, order types, checks, tenders, menu items

### Comparison (4)
- Sales Variance — net sales for selected date vs previous week vs previous year, with variance
- Service by Weekday — guests, checks, average spend by daypart
- Sales by Weekday — net sales by location, menu-item hierarchy, daypart, per weekday
- Key Performance Indicator Comparison — KPIs with breakdowns by Business Date, Location, Revenue Center

### Menu Item Sales and Performance (3)
- Menu Engineering — sales & contribution margins by major group, family group, menu item
- Employee Sales Mix — employee sales, drill to major/family/menu item
- Top Menu Items Summary — most-sold items

### Kitchen Performance (2)
- Kitchen Performance — order counts by station across seven aging categories
- Kitchen Display Detail — orders to KDS, breakdowns by revenue center, prep time, station

### Labor (4)
- Payroll Summary
- Tip Exceptions — amount to bring tipped employee to minimum wage
- Clock In Status — employees currently clocked in
- Time Card Summary — hours and pay by job code and employee

## Dashboard

A grid of configurable "tiles", each a mini-report. Global parameters at top
(Edit Parameters): **Locations** + **Revenue Centers** scope the whole board.
Two tile-set modes (Customize dialog):
- **Role Defined** — tiles set by the role administrator, auto-inherit updates.
- **Person Defined** — individual picks and orders tiles, no inheritance.

Below the tiles: a **Favorites / Last Run** quick-launch strip for reports.
Each tile has a "Run Daily Operations" drill-through into the full report.

### The 11 dashboard tiles (with exact scope descriptions)
1. Net Sales — Today, A Week Ago Today and A Year Ago Today variances
2. Net Sales Forecast — Per Day, Last 7 days, Next 7 days and Current business hour (most recent sales, location local time)
3. Average Spend per Guest Forecast — Per Hour, Today (actual vs forecast)
4. Average Spend per Table Turn Forecast — Per Hour, Today (actual vs forecast)
5. Adjustments — Today
6. Top 10 Employee Net Sales — Today
7. Top 10 Major Group Net Sales — Today
8. Cost of Goods Sold — Today, A Week Ago Today and A Year Ago Today variances (value + %)
9. Net Sales and Labor Cost Percent — Per Day, Last 14 days and Current business hour (dual-axis)
10. Labor Cost — Per Hour, Today
11. Order Count and Prep Time by Station — Today

### Dashboard patterns worth noting
- Comparison tiles are always **Today vs Same day last week vs Same day last year**, with variance %.
- Forecast tiles overlay **actual vs forecast** on the same axis.
- "At Current Hour" markers: the board knows the current trading hour and marks it on intraday charts.
- Everything re-scopes instantly by Location + Revenue Center.

## Library — the master report catalogue

**251 report templates**, 11 pages, 24/page. This is the key structural idea:
Simphony ships a large library of report *definitions*; "My Reports" is the
subset a role/user has added. CCOS by contrast has a fixed hardcoded report set.

Library features:
- Search by: Report Name, Description, Category, Tags, Data Permissions
- Options: Favorites only · Hide My Reports · Include reports I don't have
  permissions to run · Hide tags and missing permissions
- Tags encode variants: tax treatment (Add On Tax / Inclusive Tax), service
  type (Table Service / Quick Service), and product lineage (Simphony,
  Simphony Essentials, RES 3700, e7). Much of the 251 count is these variants
  of a smaller set of distinct report concepts.

### Page 1 distinct concepts (category: Summary)
- Daily Operations / Daily Operations Summary (sales & operating metrics)
- Employee Tender Totals — tender counts/amounts by employee & revenue centre
- Employee Threshold Exceptions
- Employee Tips — receipt and tip amounts by employee
- Income Audit by Discount / by Major Group / by Tender — totals by day part
- No Sale Transactions
- Open Checks
- Order Channel Sales and Operations — sales by **order channel** (delivery/online)
- Processed Transactions — carried-over / processed / unprocessed by date
- Revenue Center Tip Report

### Full Library category taxonomy (16 categories)
Summary · Daily Detail · Operations Performance · Menu Item Sales and
Performance · Comparison · Alignment · Administrative · Kitchen Performance ·
Regional · Customer Activity · Common Currency · Card Activity · Campaigning ·
Labor · Inventory

Categories CCOS does NOT currently touch (candidate gaps):
- **Customer Activity** — guest/visit analytics, loyalty behaviour
- **Card Activity** — gift card / stored value
- **Campaigning** — marketing campaign performance
- **Regional** — multi-location / regional rollups
- **Common Currency** — multi-currency consolidation (inclusive-tax normalised)
- **Inventory** — inventory reporting (CCOS has strong inventory data already)
- **Alignment** — org/hierarchy alignment checks
- **Administrative** — Daily Checklist (data-posting verification), Posting
  Calendar (which business dates have posted sales — a data-health view)

### Extra distinct report concepts seen while sampling
- Employee Tender Totals; Employee Tips
- Income Audit by Discount / Major Group / Tender (day-part breakdowns)
- Order Channel Sales and Operations (delivery/online channel split)
- Processed Transactions (carried-over/processed/unprocessed audit)
- KDS Order Aging; Kitchen Display Detail
- Posting Calendar; Daily Checklist
