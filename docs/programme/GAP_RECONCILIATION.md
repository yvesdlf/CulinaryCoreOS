# Gap reconciliation — the two briefs against the actual schema

Written 2026-10-09/10 against the live local database and the working tree at
`plan/gap-programme`. Every row below was checked; the method and its limits
are in §2.

---

## 1. The headline

**The briefs are a design for a product that largely exists.** They propose
table names as though the schema were empty. It carries 118 tables, 20 views,
roughly 190 functions, 57 enums and a `packages/shared` cost engine across 84
forward-only migrations.

Counting discrete capabilities across both briefs:

| Verdict | Count | Share |
|---|---|---|
| Built, and under the brief's own name | 32 | 30% |
| Built, under a different name | 24 | 23% |
| Partial — the spine exists, a named piece does not | 25 | 23% |
| Absent | 25 | 24% |

So about half of both briefs is already done, and a further quarter needs
finishing rather than starting. **The genuine new-build list is 25 items**, in
§7, and it is much smaller and differently shaped than the briefs imply.

Three things matter more than the counts:

- **The briefs would have you rebuild things that exist, under new names.**
  Acting on Part 1 §4.1 as written would create `purchase_requisitions`
  beside the existing `requisitions`, and `document_links` beside the
  `reference_stem` lineage that already threads the chain. See §5.
- **Two brief proposals are worse than what is here**, and one of them
  violates `AGENTS.md`. See §5 and §6.
- **The most valuable absent items are not the ones the briefs emphasise.**
  The briefs lead with the procure-to-pay chain, which is built. The real
  holes are per-product unit conversions, the stocktake session wrapper,
  menus as a first-class object, and anything that needs a mobile app — of
  which there is none.

## 2. Method, and what this does not tell you

Checked, for every row:
- Table and column existence, by querying `information_schema.columns`.
- Enum values, from `pg_enum` — these turned out to be the best evidence of
  how complete a workflow is, because the status sets are explicit.
- Functions and triggers, from `pg_proc`.
- Views, which is where the metrics layer turned out to live.
- Engine modules in `apps/web/src/engine/` and `packages/shared/src/`.
- Page components in `apps/web/src/pages/`.

**Not checked, and therefore not claimed:**
- *Depth of UI wiring.* A table and a page both existing does not prove the
  screen exposes the whole workflow. Where a verdict depends on that, it says
  so and is marked PARTIAL rather than BUILT.
- *Whether each trigger enforces what its name suggests.* The security review
  is the place for that, and it has already found that one of them
  (`enforce_approval_rules`) does not.
- *Test coverage per capability.* `supabase/tests/` exists and runs, but this
  pass did not map which of these capabilities it proves.
- *Quality or sellability.* "Built" means present and wired, not good.

Confidence is high on existence, medium on completeness, and deliberately
absent on quality.

## 3. Part 1 — the Implementation Brief

### Phase 1: Foundations

| § | Capability | Verdict | Evidence |
|---|---|---|---|
| 3.1 | Per-product unit conversions (`product_unit_conversions`) | **ABSENT** | No such table. `apps/web/src/engine/units.ts` does global conversion only. `products` carries `pack_unit`, `total_unit`, `stock_unit`, `nett_unit` and a `yield_percent`, so a product-specific *pack* ratio exists — but "1 bunch coriander" has no density or per-product factor. The brief's `UnresolvedUnit` typed error does not exist. |
| 3.2 | Product aliases and merge | **PARTIAL** | Merge is built and better than proposed: `merge_products()`, `merge_supplier_names()`, `apps/web/src/engine/duplicates.ts`, a `duplicates.tsx` page, migration `0011_merge_helpers`. **The `product_aliases` table is absent**, so a merged name is not retained as a searchable alias. `pg_trgm` not enabled. |
| 3.3 | Supplier products and price history | **BUILT, DIFFERENT NAME** | `product_suppliers` (18 cols) is their `supplier_products`, with `supplier_sku`, `pack_qty`, `pack_unit`, `pack_price`, `price_per_unit`, `is_preferred`, `lead_time_days`, `minimum_order_qty`. `contract_prices` + `contract_price_for()` give contracted pricing. `derive_product_supplier_price()`, `sync_preferred_supplier()`, `clear_other_preferred_suppliers()` enforce it. View `product_supplier_options` ranks by price. Migration `0046`. **Gap:** no append-only `supplier_prices` history table — `price_updated_on` is a single moving value, so there is no price chart and no "price moved >5%" trigger. |
| 3.4 | Stock locations | **BUILT, DIFFERENT NAME** | `locations` with `parent_id` (a tree, enforced by `enforce_location_tree()`) and `location_kind` enum: SITE, BUILDING, FLOOR, GUEST_ROOM, PUBLIC_AREA, BACK_OF_HOUSE, PLANT, OUTLET. **Gap vs brief:** no store-room / walk-in-chiller / freezer / dry-store kinds, and `stock_movements` has **no `location_id`** — stock is tracked per organisation and business unit, not per storeroom. This is the real gap, not the table. |
| 3.5 | Stock movement ledger and batches | **BUILT, DIFFERENT NAME** | `stock_movements` (16 cols, append-only per `AGENTS.md`) with enum `stock_movement_kind`: RECEIPT, WASTE, USAGE, COUNT, TRANSFER, RETURN. `stock_lots` is their `stock_batches`, with `lot_code`, `expires_on`, `expiry_kind` (USE_BY / BEST_BEFORE), `receipt_temperature_c`, `lot_status` (OK / BLOCKED / RECALLED / WITHDRAWN). Views `product_stock`, `cost_of_goods_daily`. `refuse_movement_on_blocked_lot()` is a control the brief never thought of. **Gaps:** the brief's richer kind list (`transfer_in`/`out` pairs with a `transfer_id`, `production_consume`/`output`, `sale_consume`, `opening_balance`) is collapsed into six; there is no `stock_valuation` view; no `location_id`. |
| 3.6 | Attachments | **BUILT** | `attachments` (16 cols) with `parent_type`/`parent_id`, private bucket, `attachment_retention`, `expired_attachments()`, `can_see_attachment()`, `enforce_attachment()`, `media_limits()`. Migration `0059_media`. Broader than the brief: retention policy per parent type, which the brief omits. |
| 3.7 | Audit log | **CONFLICTS — see §6** | No generic `audit_log`. Instead: `approval_events`, `request_events`, `work_order_events`, `room_state_events`, `recipe_status_events`, `parameter_changes`, `takings_changes`, `privacy_actions`, `time_corrections`. The brief's single-table-from-a-generic-trigger design is the weaker one. |
| 3.8 | Custom fields | **ABSENT** | No `custom_field_definitions`, no `custom_fields jsonb` on products, suppliers or recipes. Genuinely missing, and it is the brief's answer to "let a customer extend without code". |

### Phase 2: Procure-to-pay

| § | Capability | Verdict | Evidence |
|---|---|---|---|
| 4.1 | Requisition | **BUILT, DIFFERENT NAME** | `requisitions` (17) + `requisition_lines`. `purchase_status` enum covers DRAFT, SUBMITTED, APPROVED, REJECTED, CANCELLED, ORDERED, PARTIALLY_RECEIVED, RECEIVED, CLOSED — a superset of the brief's. `refresh_requisition_total()`, `requisition_prefix()`, `requisition_unit_code()`. Migrations `0021`, `0063`. |
| 4.1 | Purchase order | **BUILT** | `purchase_orders` (26) + `purchase_order_lines`, with `acknowledged_at`, `supplier_promised_on`, `supplier_note` — supplier acknowledgement the brief does not ask for. `acknowledge_purchase_order()`, `refresh_purchase_order_total()`, `refresh_po_line_received()`. |
| 4.1 | Goods receipt | **BUILT** | `goods_receipts` (13) + `goods_receipt_lines` with `quantity_received`, `quantity_rejected`, `rejection_reason`, `condition_note`, `lot_id`, and `vehicle_temperature_c` on the header. |
| 4.1 | Supplier invoice | **BUILT** | `supplier_invoices` (22) + lines. `invoice_status`: DRAFT, MATCHING, EXCEPTION, APPROVED_FOR_PAYMENT, DISPUTED, PAID, CANCELLED — richer than the brief's. |
| 4.1 | Supplier returns, credit notes | **ABSENT** | No `supplier_returns`, no `supplier_credit_notes`. Rejection is *captured* (`goods_receipt_lines.quantity_rejected`) but never becomes a document, so nothing drives a credit. There is a `RETURN` stock movement kind, unused by any return document. **A real gap and the brief is right about it.** |
| 4.1 | `document_links` | **SUPERSEDED — see §5** | The chain is threaded by `reference_stem` plus `next_reference_stem()` / `next_document_reference()`, with view `purchasing_chain` joining requisition → PO → receipt → invoice. Migrations `0047`–`0052`. Partial receipts work via `purchase_order_lines.quantity_received`. |
| 4.2 | Goods receipt with quality checks | **PARTIAL** | Temperature is on the receipt header (`vehicle_temperature_c`), **not per line**, so the brief's "chilled and frozen lines require a product temperature reading" is not enforced. Packaging condition is free text. Photos available via `attachments` (`STOCK_MOVEMENT` parent). No automatic supplier return draft. |
| 4.3 | Three-way match | **BUILT** | `apps/web/src/engine/invoice-matching.ts` — pure, exported `matchInvoice()`, `ExceptionKind`, `Tolerances`, `DEFAULT_TOLERANCES`. `matching_tolerances` table (price %/absolute, quantity %/absolute). `supplier_invoices.exceptions`. `refuse_payment_on_exception()` enforces it in the database. **This is the brief's flagship item and it is done.** |
| 4.4 | AI invoice capture | **ABSENT — and the AI architecture conflicts with the brief, see §6** | `apps/web/src/engine/ai/` is real but its task set is `recipeParseRequest`, `nutritionRequest` and `imageAnalysisRequest`. **There is no invoice task.** No `pg_trgm` either, so the fuzzy supplier/line matching has no index behind it. |
| 4.5 | Auto-reorder | **PARTIAL** | `products.par_level` and `products.reorder_point` **exist**. No scheduled job drafts a requisition from them; `scheduled_jobs` holds the cron registry and does not list one. So the data model is there and the automation is not. |
| 4.6 | Request for quotation | **BUILT** | `rfqs`, `rfq_lines`, `rfq_quotes`, `rfq_suppliers`, `rfq_awards`, view `rfq_comparison`, functions `submit_quote()`, `mark_late_quote()`. `rfq_status`: DRAFT, SENT, CLOSED, AWARDED, CANCELLED. `rfq_awards.purchase_order_id` is the brief's one-click conversion. Migration `0032`. |
| 4.7 | Tax | **BUILT** | `tax_rates`, `category_tax_rates`, `tax_percent_for()`, `organizations.prices_include_tax`, `standard_vat_percent`, `reduced_vat_percent`, `service_charge_percent`. Per-line `tax_percent` on order and invoice lines. |

### Phase 3: HACCP

| § | Capability | Verdict | Evidence |
|---|---|---|---|
| 5.1 | Monitoring points | **BUILT, DIFFERENT NAME** | `haccp_forms` is their `haccp_points`: `code`, `section`, `title`, `frequency` (enum PER_SHIFT…AS_NEEDED), `fields jsonb`, `is_ccp`, `business_unit_id`, plus `raises_job` and `raises_request_type_id` — a failed check can raise work, which the brief does not propose. `seed_haccp_forms()` ships the starter template the brief asks for. |
| 5.1 | `haccp_equipment` | **PARTIAL** | `assets` covers equipment with `category`, `criticality`, `required_certifications`. `meters`/`meter_readings` cover readings. No explicit link from an asset to a HACCP form. |
| 5.2 | Scheduled tasks | **PARTIAL** | View `haccp_outstanding` computes what is due from `frequency` and `last_completed`, and `my_checks_today` serves the portal. There is no materialised `haccp_tasks` table, so "missed tasks remain visible and count against compliance" is computed, not recorded. Workable, but a form whose frequency changes rewrites history. |
| 5.3 | Logs and corrective actions | **PARTIAL** | `haccp_records` carries `values`, `breach`, `breach_detail`, `corrective_action`, `completed_by_email`, `verified_by_email`, `verified_at` — so the verifier and the self-verification ban have a home, enforced by `enforce_haccp_breach()`. **No separate `haccp_corrective_actions` table**, so there is one action per record, with no `action_taken` taxonomy and no `product_disposition`. No alert severity ladder. **And the refusal is silent in the UI** — confirmed defect, `CONTEXT.md` §3. |
| 5.4 | Cooling logs | **ABSENT** | No multi-stage cooling log, no per-stage timers. A cooling check could be expressed as a `haccp_forms.fields` jsonb form, but the staged 60→21→5 °C rule with countdowns does not exist. `AGENTS.md` §11 even quotes a cooling comment, so the rule is understood; the feature is not built. |
| 5.5 | Cleaning schedule | **PARTIAL** | Room and public-area cleaning is fully built (`housekeeping_tasks`, kinds including PUBLIC_AREA). **Kitchen cleaning** has no `cleaning_tasks`/`cleaning_records`: it would have to be a HACCP form with `section = 'cleaning'`. No chemical, dilution or method fields. |
| 5.6 | Link to procurement | **PARTIAL** | `haccp_records.raised_request_id` and `raise_request_for_breach()` link a breach to a request. The brief's specific flow — a GRN temperature automatically writing a `haccp_log` with `source = receiving`, and a failed check blocking the line from posting — is **not** built. Receipt temperature sits on `goods_receipts.vehicle_temperature_c` and goes nowhere. |
| 5.7 | Reports and inspection pack | **PARTIAL** | View `hygiene_by_unit` gives compliance per unit including `breaches_nobody_was_told_about`. Traceability is strong: `lot_forward_trace` view, `apps/web/src/engine/traceability.ts`, `traceability.tsx`. **No one-click inspection pack** as PDF/CSV for a date range. |
| 5.8 | Sensor readiness | **ABSENT** | No `source = sensor` on `haccp_records`, no ingest endpoint. `meters`/`meter_readings` are utility meters, not probes. |

### Phase 4: Stocktake, labels, scanning, import

| § | Capability | Verdict | Evidence |
|---|---|---|---|
| 6.1 | Stocktake sessions | **PARTIAL — and this is the biggest single gap** | A `COUNT` movement kind exists, and `apps/web/src/engine/count-sheet.ts` is a thoughtful piece of work (it deliberately omits the expected quantity from the printed sheet, because a counter who sees "expected 4" writes 4). But there is **no `stocktakes` session table and no `stocktake_lines`** — so no `snapshot_at` freeze, no open→counting→submitted→approved→posted status, no variance report, and no approval. Counts post as individual movements. Everything the brief asks for sits on top of work already done. |
| 6.2 | Barcode scanning | **ABSENT** | No `barcodes` table, no scanning library in the tree. |
| 6.3 | Labels | **ABSENT** | No label templates, no ZPL. `stock_lots.expires_on`/`expiry_kind` and `production_records` would supply the data, and migration `0061_use_by_is_refused` shows the use-by rule is already enforced — but nothing prints. |
| 6.4 | Recipe import | **BUILT, except the URL path** | `apps/web/src/engine/recipe-import.ts`, `price-import.ts`, `haccp-import.ts`, all preview-then-commit per `AGENTS.md` §10. **Photo import is built**: `recipeParseRequest(source, images?)` and `parseRecipeResponse()` in `engine/ai/tasks.ts`, against a vision-capable provider. No schema.org/JSON-LD URL import. No `pg_trgm` for the ingredient match, so matching is exact or manual. |
| 6.5 | Global search | **PARTIAL** | A search control is in the UI. `pg_trgm` is **not** enabled, so typo and partial matching as specified is not possible today. |

### Phase 5: Refinements

| § | Capability | Verdict | Evidence |
|---|---|---|---|
| 7.1 | Landed cost | **ABSENT** | No landed-cost entry, no allocation of freight/duty across receipt lines. |
| 7.2 | Multi-currency | **PARTIAL** | `currency` columns on `requisitions`, `purchase_orders`, `supplier_invoices`, `budgets`, `contracts`; `organizations.currency_code`. **No `exchange_rates` table and no conversion** — so documents can be *denominated* in another currency but reports cannot convert them. |
| 7.3 | Budgets and committed spend | **BUILT** | `budgets` (12) with `hard_stop`, and view `budget_positions` exposing `committed` and `actual` against `amount`. `cost_centres`, `business_units.approval_threshold`. `invoice-matching.ts` exports a `BudgetPosition` type. Escalation-instead-of-block was not verified. |
| 7.4 | AP, payment runs, period lock | **PARTIAL** | Invoice status reaches APPROVED_FOR_PAYMENT and PAID, with `payment_terms_days` and `due_date` on the invoice — so aging is computable. **Absent:** an aging report, a weekly payment proposal, and `closed periods` with a posting block. A view `accounting_export` (`on_date`, `unit_code`, `account`, `amount`, `org_id`) **already exists**, which is the brief's CSV journal export in view form. |
| 7.5 | Supplier scorecard | **ABSENT** | No scorecard. `apps/web/src/engine/procurement-analytics.ts` exists and may hold some of it — not verified. All the inputs exist. |
| 7.6 | Offline-first on iOS | **ABSENT, AND BLOCKED** | `apps/ios/` and `apps/macos/` contain **a README each and zero Swift files**. There is no mobile app to make offline. Every brief item that says "on the iOS app" — offline counting, camera capture, attendant room flow, "My day" — has no host. The staff portal is a responsive web page; that is the current mobile story. |
| 7.7 | Localisation | **ABSENT** | No i18n library, no translation files, strings inline. Bahasa Indonesia not shipped. |
| 7.8 | Webhooks | **BUILT, DIFFERENT NAME** | `message_channels` (with `kind`, `config`, `quiet_from`/`quiet_to`), `message_channel_secrets`, `message_deliveries` (attempts, backoff, `next_attempt_at`, `claimed_at`), `message_endpoint_origins` allow-list, `drain_outbox()`, `attempt_delivery()`, `delivery_backoff()`, `check_channel_endpoint()`, view `outbox_health`. Migrations `0069`, `0070`, `0076`. **More robust than the brief's sketch** — it has retry, backoff, an origin allow-list and quiet hours. |

## 4. Part 2 — People, Housekeeping, Operations, Insights

### People

| § | Capability | Verdict | Evidence |
|---|---|---|---|
| 3.1 | Staff records | **BUILT, DIFFERENT NAME** | `employees` (24) is their `staff`. `employee_private` is a **separate table** for date of birth, national ID, tax ID, bank account — a stronger answer than the brief's "restricted columns in one table", because it is a different RLS target. `staff_documents` + `staff_document_recipients` (`read_at`, `acknowledged_at`). `competencies` + `competency_assessments` are their `staff_skills`, with assessment evidence the brief omits. `employee_certifications` with `expires_on`. |
| 3.1 | Document expiry alerts at 60/30/7 days | **PARTIAL** | `CERTIFICATE_EXPIRING` is a `notification_kind` and `employee_certifications.expires_on` exists. The three-step ladder was not verified. |
| 3.1 | Onboarding / offboarding checklists | **BUILT** | `checklist_templates` (`kind` enum ONBOARDING/OFFBOARDING, `blocks_completion`), `employee_tasks`, view `employee_task_board`, `enforce_offboarding()`, `employee_exits`. Migration `0030`. |
| 3.2 | Rostering | **PARTIAL** | `shifts` (18) with `status` DRAFT/PUBLISHED/CANCELLED, `published_at`, `enforce_shift_rules()`. **Absent:** `shift_templates`, `staff_availability`, `shift_swap_requests`. So there is no copy-last-week, no availability capture, no swap flow, and no auto-fill heuristic. `apps/web/src/engine/scheduling.ts` exists; depth not verified. Live labour cost while building the roster: view `unit_labour_against_revenue` has the inputs. |
| 3.3 | Time and attendance | **BUILT, AND BEYOND** | `time_entries` (16) including `latitude`, `longitude`, `accuracy_m`, `outside_geofence`; `venue_geofences`; `enforce_geofence()`, `metres_between()`. `time_source`: WEB, KIOSK, MANAGER. `time_corrections` as new rows with their own approval, `enforce_correction_rules()`, `protect_time_entries()`. View `attendance` gives the rostered-vs-actual variance the brief asks for. |
| 3.4 | Leave and absence | **PARTIAL** | `leave_types` (with `annual_entitlement_days`, `max_carryover_days`), `leave_requests`, `leave_attachments`, `public_holidays`, `enforce_leave_approval()`, `enforce_leave_attachment_owner()`. **No `leave_balances` table** — `apps/web/src/engine/leave-balance.ts` computes it instead, which is defensible. Two-stage approval not verified. |
| 3.5 | Payroll export | **PARTIAL** | `pay_rates` (HOURLY/MONTHLY, `effective_from`), `pay_rate_on()`, `refuse_backdated_pay_change()`, view `labour_cost_daily`. **No payroll file export**, no ordinary/overtime/night/holiday split, no configurable penalty rates. |
| 3.6 | Training and certifications | **BUILT, AND BEYOND** | `training_courses` (with `pass_mark`, `grants_certification`, `valid_months`), `training_assignments`, `quiz_questions` (MULTIPLE_CHOICE **and** WRITTEN), `quiz_attempts`, `quiz_written_answers` with human marking, `observation_checklists` for practical assessment, `issue_certificate_on_completion()`. Richer than the brief. **Absent:** auto-generating a dish briefing from a new recipe. |

### Housekeeping and maintenance

| § | Capability | Verdict | Evidence |
|---|---|---|---|
| 4.1 | Rooms and areas | **BUILT** | `rooms`, `room_types` (with DEPARTURE/STAYOVER/DEEP_CLEAN minutes), `room_state_events` (append-only), `housekeeping_state` enum, view `housekeeping_board`. **`public_areas` absent** as a table, but `location_kind` has PUBLIC_AREA and `housekeeping_task_kind` has PUBLIC_AREA, so it is modelled through locations. Inbound PMS occupancy webhook absent; `rooms.occupancy` is set manually. |
| 4.2 | Attendant assignment and task board | **BUILT** | `housekeeping_tasks` with `standard_minutes`/`actual_minutes`, `enforce_housekeeping_assignment()`, `start_my_room()`, `finish_my_room()`, `inspect_room()`, `housekeeping_inspections` with `passed`/`score`/`findings`, `apply_housekeeping_inspection()`, `enforce_room_release()`. Views `housekeeping_workload`, `rooms_to_inspect`, `my_rooms`. `housekeeping_consumables` + view `housekeeping_replenishment` link linen and amenities to stock. **Balanced auto-split by credits not verified.** The iOS app it assumes does not exist (§7.6). |
| 4.3 | Lost and found | **BUILT, DIFFERENT NAME** | `lost_property` with `hold_until`, `released_to`, `release_note`, `lost_property_status` HELD/RETURNED/DISPOSED/DONATED, `enforce_lost_property()`. |
| 4.4 | Equipment register | **BUILT** | `assets` (21) with tree (`parent_asset_id`, `enforce_asset_tree()`), `criticality`, `status`, `warranty_until`, `purchase_cost`, `required_certifications`. `meters`/`meter_readings` are their `asset_meters`, with `consumption`, `reset`, `reset_reason`. View `asset_health` aggregates jobs, downtime and parts cost per year. **QR labels absent** (nothing prints — §6.3). |
| 4.5 | Work requests and work orders | **BUILT, DIFFERENT NAME** | `requests` + `request_types` + `request_events` is their `work_requests`, with `converted_type`/`converted_id` and `convert_request_to_work_order()`. `work_orders` (28) with full status enum, `downtime_minutes`, `labour_minutes`, `verified_by_email`, `enforce_work_order_signoff()`, `enforce_work_order_assignment()`. `work_orders.requisition_id` is the contractor-PO link. Views `request_board`, `request_load`, `maintenance_manning`. `chase_unanswered_requests()` and `escalation_chain()` are beyond the brief. **`work_order_parts` absent** — parts consumption is not linked to stock. |
| 4.6 | Preventive maintenance | **BUILT, DIFFERENT NAME** | `maintenance_plans` is their `pm_schedules`: `interval_days`, `estimated_minutes`, `statutory`, `criticality`, `required_certifications`, `last_completed_on`. `advance_maintenance_plan()`, view `maintenance_due` with `days_overdue`. **Meter-based triggers ("every N meter units") absent** — intervals are days only, though `meter_readings` exists. Repair-or-replace flag absent. |

### Culinary operations

| § | Capability | Verdict | Evidence |
|---|---|---|---|
| 5.1 | Menus and menu items | **ABSENT — the significant one** | No `menus`, `menu_items` or `menu_item_modifiers`. `recipes` carries `menu_price`, `price_incl_vat`, `price_excl_vat`, `tax_percent` — so **a recipe is the menu item**, one price, globally. That blocks: one recipe on several menus at different prices, per-outlet pricing, `pos_item_code` mapping, and modifiers. For a multi-outlet product this is a real structural gap. |
| 5.2 | Production planning and prep lists | **BUILT, DIFFERENT NAME** | `production_plans` + `production_plan_lines` are their `prep_plans`. `production_records` with `batches`, `quantity_made`, and **corrections as new rows** (`corrects_id`, `correction_reason`) per `AGENTS.md` §4. `record_production()`, `enforce_production_record()`, `enforce_production_consumption()`. Views `production_records_effective` (with `recipe_changed_since`), `production_usage_theoretical`, `production_usage_actual`, and `production_variance()` — which **is** the brief's yield variance. **Absent:** `par_qty`/`on_hand_qty`/`required_qty` per line and station assignment, so the forecast-driven "what to prep" calculation is not there. |
| 5.3 | Menu engineering | **BUILT** | `menu-engineering.tsx`, `apps/web/src/engine/menu-engineering.ts`, `sales-mix.ts`, `sales_lines`, `sales_periods`. Quadrants not verified but the inputs and the page exist. |
| 5.4 | Allergens and nutrition | **BUILT, AND IT IS THE STRONGEST PART** | `derive_allergens()`, `allergens_need_review`, `allergen_review_note` on both products and recipes; `apply_cascade()` and `apps/web/src/engine/cascade.ts` propagate through sub-recipes; `allergen-breakdown.ts`, `allergen-review.ts`, `nutrition-engine.ts`; `allergen-matrix.tsx` page. Migrations `0007`, `0010`. `AGENTS.md` §8 is enforced: inferred allergens are flagged, silence is never a free-from claim. **Absent:** a separate "may contain" flag, and a printable front-of-house matrix PDF. |
| 5.5 | Kitchen display | **ABSENT** | As the brief itself says, it needs a live POS feed. Neither exists. |

### Insights

| § | Capability | Verdict | Evidence |
|---|---|---|---|
| 6.1 | Metrics layer | **BUILT, DIFFERENT SHAPE** | No `insights` schema, but the pattern the brief asks for — each KPI defined once as a view, RLS respected, UI reads only from it — **is exactly what exists**, as ~20 views in `public`: `unit_profit_daily`, `unit_labour_against_revenue`, `labour_cost_daily`, `cost_of_goods_daily`, `revenue_daily`, `venue_overview`, `unit_overview`, `pour_cost`, `asset_health`, `maintenance_due`, `hygiene_by_unit`, `request_load`, `outbox_health`, `housekeeping_workload`, `budget_positions`, `purchasing_chain`, `accounting_export`. **Absent:** `docs/METRICS.md` documenting each formula — which matters, because the formulas are currently only in SQL. |
| 6.2 | Sales data | **PARTIAL** | `sales_lines` is thin (7 cols: `period_id`, `recipe_id`, `units_sold`, `net_sales`) against the brief's 14. **Missing:** `business_date`, `pos_item_code`, `covers`, `discount`, `service_charge`, `tax`, `gross_amount`. `daily_takings` (15) carries covers, gross, commission, net by channel — so covers exist, at day/channel grain, not per line. No `sale_consume` movement, so **selling a dish does not deplete stock**. That breaks the theoretical-vs-actual chain the brief calls its most valuable report. |
| 6.3 | Core KPIs | **MOSTLY BUILT** | Present: labour cost % (`unit_labour_against_revenue`), prime cost inputs, sales per labour hour inputs, waste (`WASTE` movements, `cost_of_goods_daily.wasted_cost`), spend per cover (`revenue_daily.spend_per_cover`), HACCP compliance (`hygiene_by_unit`), maintenance backlog (`asset_health`, `maintenance_due`), pour cost + `pour_variance()` (not in the brief at all). **Absent:** actual food cost % and theoretical food cost %, both of which need the stocktake (§6.1) and sales consumption (§6.2). Rooms cleaned per attendant hour: `housekeeping_workload` has it. |
| 6.4 | Sales forecast | **ABSENT** | No forecast anywhere. It is an input to rostering targets, prep plans and auto-reorder, so three other items quietly depend on it. |
| 6.5 | Dashboards, scheduled reports, alerts | **PARTIAL** | `venue_overview` and `unit_overview` exist with `may_see_money`/`may_see_pay` flags — role-awareness already modelled in the view. **Absent:** role-specific dashboards, the daily flash email, configurable metric thresholds, and universal CSV/PDF export. |

### Platform-wide

| § | Capability | Verdict | Evidence |
|---|---|---|---|
| 7.1 | Notifications | **PARTIAL** | `notifications` with a 14-value `notification_kind` enum, `notify()`, `queue_notification_deliveries()`, plus the whole outbox (§7.8 above). **`notification_preferences` absent** — quiet hours are per channel (`message_channels.quiet_from`/`quiet_to`), not per user, and a user cannot choose their channels. No push (no app). **Nothing has ever reached a real inbox** — no provider is configured. |
| 7.2 | Checklists and forms builder | **PARTIAL** | `checklist_templates` exists but only for ONBOARDING/OFFBOARDING, with no `items jsonb` and no versioning. `haccp_forms.fields jsonb` **is** a forms builder, for HACCP only. `observation_checklists.items`, `housekeeping_inspections.findings`. **Absent:** one general versioned template + `checklist_runs` + `checklist_answers`, the item-type set (signature, photo, temperature-writing-a-HACCP-log), and failed-item-creates-a-task. |
| 7.3 | Tasks | **PARTIAL** | `employee_tasks` is onboarding/offboarding-shaped (`kind`, `category`, `blocks_completion`), not a general task table with an arbitrary entity link. View `venue_calendar` and the portal's "My Work" are the beginnings of "My day". |
| 7.4 | SOP library | **PARTIAL — closer than it looks** | `staff_documents` has `kind` (POLICY, TRAINING, …), `title`, `body`, `file_path`, `requires_acknowledgement`, `published_at`; `staff_document_recipients` records `read_at` and `acknowledged_at`. **That is the read-and-acknowledged record the brief asks for.** Absent: versioning with an approval step before publication, and department/recipe/equipment linking. |
| 7.5 | Team communication | **BUILT, DIFFERENT NAME** | `handovers` + `handover_items` (kinds BROKEN, GUEST, STOCK, PEOPLE, SAFETY, NOTE) + view `handover_board` with `unread` — this is the pre-shift briefing, per service and unit, with acknowledgement. Migration `0071`. `board_posts` is a staff noticeboard with moderation, which the brief does not propose. **Absent:** @mentions and comments on arbitrary entities. |
| 7.6 | Incidents | **PARTIAL** | `hr_cases` (kinds CONDUCT, PERFORMANCE, GRIEVANCE, INVESTIGATION, RECOGNITION) with `hr_case_participants` and `can_see_case()` — restricted visibility and an investigation/close-out flow, for **people** incidents. **Absent:** guest complaints, allergen incidents, near misses, security events. Note `hr_case_participants` has a confirmed self-add defect. |
| 7.7 | Integrations and AI | **PARTIAL** | The outbox is the integration hub's outbound half and it is solid (§7.8). Supplier portal exists (`supplier_users`, `portal_*` views). **Absent:** inbound adapters (POS, PMS, payroll, accounting beyond the `accounting_export` view) and an MCP server. |

## 5. Where this repository chose differently, and better

Four cases where implementing the brief as written would be a regression.
These are the ones to push back on rather than schedule.

**`document_links` versus reference lineage.** The brief wants a join table
recording which document each line came from. The repository threads the chain
with a shared `reference_stem` allocated by `next_reference_stem()`, so a
requisition, its PO, its receipts and its invoice all carry one human-readable
number, and `purchasing_chain` joins them. Migrations `0048`–`0052` are
visibly a sequence of corrections to get this right ("one number per supplier
chain", "order keeps the request number"). It is better because the link is
*visible to the user on the paperwork*, not only to the database. Partial
quantities are carried by `quantity_received` on the line, which is where the
brief's own partial-receipt case lands anyway.

**Per-domain event tables versus one `audit_log`.** See §6 — this is also a
rules conflict.

**`employee_private` as a separate table versus restricted columns.** The
brief says "use column-level protection through a restricted view". A
separate table with its own RLS is a stronger boundary and harder to leak
through a `select *`.

**The outbox versus "emit events to webhook URLs".** What exists has retry
with backoff, an endpoint origin allow-list, per-channel secrets, quiet
hours, delivery claiming and a health view. The brief's one-line description
would be a downgrade if taken literally.

## 6. Conflicts with AGENTS.md

**One real conflict.** Part 1 §3.7 asks for an `audit_log` written "from a
generic trigger attached to every business table", with `before jsonb` and
`after jsonb`.

That collides with `AGENTS.md` §1 and §2 in a specific way: a generic trigger
on every table produces rows whose meaning is untyped, and **a control cannot
be tested by trying to break it if what it records is a jsonb blob**. The
existing `approval_events` carries `document_type`, `action`, `actor_role`,
`amount` as columns precisely so that `supabase/tests/` can assert on them
with `expect_value`. It also collides with §1's RLS requirement — one table
spanning every entity needs one policy expressing every entity's visibility
rule, which is the shape that produced the migration 0036 failure.

Recommendation: **reject it.** Keep per-domain event tables. If a unified
view is wanted for an auditor, build it as a view over them, which costs one
migration and loses nothing.

**A second real conflict, and it is a product decision not a bug.** Part 1
§2 rules: *"AI features call the Claude API from Supabase Edge Functions only.
Never expose keys to the client."*

Neither half holds. **There is no `supabase/functions` directory — the
project has no Edge Functions at all.** The AI runs entirely in the browser:
`engine/ai/client.ts` takes an `AiConfig { providerId, apiKey, model,
baseUrl }` and calls Gemini, Anthropic or an OpenAI-compatible endpoint
directly, and `stores/ai-store.ts` persists the key to browser storage.

This is **bring-your-own-key**, deliberately: the user enters their own key in
Settings, against a provider they choose. That is a defensible design and not
a leaked secret — but it is a different product from the one the brief
assumes, and the difference has consequences well beyond this document:

- The key sits in browser storage, so any XSS is a key disclosure.
- There is no server-side control of AI spend, and no way to meter it — which
  the pricing work needs to know, because "AI included" cannot be costed if
  the customer brings the key, and cannot be offered if they must.
- Every AI feature is unavailable to a tenant who has not configured a key.

What the brief gets wrong in the other direction: the human-review rule is
**over**-satisfied. `engine/ai/safety.ts` carries a `SAFETY_PREAMBLE`
declaring EU food law, a `REFUSED_CLAIMS` pattern list, and `guardAnswer()`
applied centrally in `client.ts` — placed there, the comment says, because "a
guard somebody has to remember to apply is a guard that gets forgotten in the
one place it mattered". `mergeAllergenProposal()` honours `AGENTS.md` §8.
That is stronger than anything the briefs propose.

**Decision needed, not a task:** bring-your-own-key, or a platform key behind
Edge Functions. Pricing, security and the AI roadmap all hang off it.

**One softer tension:**

- Part 2 §7.7 proposes an MCP server exposing CCOS actions to AI agents "with
  the same RBAC as the UI". Given `CONTEXT.md` §3 finding 1 — the approval
  trigger trusts a client-supplied `actor_id` — **an MCP server today would
  expose a forgeable approval path to an automated caller.** Do not build it
  before that is fixed.

## 7. The genuine gap list, ordered by what it unblocks

Tier 1 — unblocks the most, and the KPIs everyone wants depend on it.

1. **Stocktake sessions** (`stocktakes`, `stocktake_lines`, snapshot freeze,
   variance, approval, posting). The engine and the movement kind exist.
   *Unblocks: actual food cost %, stock valuation, theoretical-vs-actual.*
2. **Sales consumption** — widen `sales_lines` (business date, pos item code,
   covers, discount, tax, gross) and post `USAGE` movements from the recipe on
   import. *Unblocks: theoretical food cost %, the variance report the brief
   calls its most valuable, and menu engineering accuracy.*
3. **Per-product unit conversions** + the typed unresolved-unit error.
   *Unblocks: correct costing of "1 bunch", and honest stocktake conversion.*
4. **Menus, menu items, modifiers.** *Unblocks: multi-outlet pricing, POS
   mapping, per-outlet margin.*

Tier 2 — substantial value, no hard dependency on tier 1.

5. Supplier price history as an append-only table, plus the >5% move alert.
6. Supplier returns and credit notes (the rejection data already exists).
7. `stock_movements.location_id` + storeroom location kinds.
8. Closed periods with a posting block, and the AP aging report.
9. Exchange rates and report-currency conversion.
10. Cooling logs; HACCP corrective actions as their own table with disposition.
11. GRN per-line temperature writing a HACCP record, and blocking the line.
12. Shift templates, availability, swap requests; copy-last-week.
13. Sales forecast — three other features quietly depend on it.
14. General checklist runs and answers, versioned.
15. `docs/METRICS.md` — the formulas exist only as SQL today.

Tier 3 — real, but deferrable or blocked.

16. Custom fields. 17. Product aliases + `pg_trgm` (also fixes global search
and import matching). 18. Labels and barcodes. 19. Landed cost.
20. Supplier scorecard. 21. General incidents. 22. Notification preferences.
23. Payroll file export. 24. i18n and Bahasa Indonesia. 25. AI invoice
capture — the AI framework, safety guards and vision path already exist, so
this is one task plus a parser, but see the §6 key-architecture decision
first.

**Blocked, not deferred: everything requiring a mobile app.** `apps/ios`
holds a README and no code. Offline stocktake, camera invoice capture, the
attendant room flow and "My day" all presume an app that does not exist.
Either that is a project of its own, or the responsive portal is the answer
and the briefs should be amended to say so. This is a decision, not a task.

## 8. The briefs' own dependency errors

Part 2 §1 says to finish Part 1 first because it depends on "locations, audit
log, attachments, custom fields, stock movements, approvals and
notifications". Of those, **`audit_log` and `custom_fields` do not exist and
are not planned** (§6 recommends rejecting the first). So any Part 2 item
written as depending on them is mis-specified:

- Part 2 §4.5 `work_order_parts` "consumes Part 1 stock" — it can, since
  `stock_movements` exists, but there is no `location_id` to consume *from*.
- Part 2 §7.2 checklists with a temperature item "writes a HACCP log" —
  depends on Part 1 §5, which is only partially built.
- Part 2 §5.2 prep planning requires the §6.4 forecast, which is absent, and
  `par_qty`, which is not on `production_plan_lines`.
- Part 2 §6.3 food cost KPIs require Part 1 §6.1 stocktake. Not built.

## 9. What the briefs miss

Found in the code, absent from both briefs:

- **Business units.** Migrations `0058`, `0062`, `0073` built a unit tree with
  unit-scoped access grants and per-unit P&L. Neither brief mentions it, yet
  it is the backbone of the multi-outlet story both assume.
- **Pour cost.** `product_pour`, view `pour_cost`, `pour_variance()` —
  beverage control, absent from both briefs, and a thing bars buy software for.
- **Request escalation.** `chase_unanswered_requests()`, `escalation_chain()`,
  `requests.escalation_level`, `respond_by`. An SLA engine nobody specified.
- **The supplier portal.** `supplier_users` and seven `portal_*` views.
- **Privacy and erasure.** `anonymise_person()`, `privacy_actions`,
  `storage_deletions`, `attachment_retention`. GDPR machinery the briefs omit
  entirely — though note `storage_deletions` is never drained
  (`CONTEXT.md` §3).
- **Written exam marking.** Human-marked written answers alongside quizzes.
- **Geofenced clock-in.** Latitude, longitude, accuracy and an
  outside-geofence flag on every punch.

The briefs were written from other projects' feature lists. These are the
features this product grew on its own, and they are closer to what makes it
different than most of what the briefs propose.

## 10. What I did not verify

Stated plainly so this file is not trusted further than it has earned:

- Whether the AI recipe-photo path works end to end against a live provider.
  The task, the parser and the vision capability flag are all present and
  read correctly; no call was made.
- Depth of UI wiring for every BUILT row. Table and page existence is not
  proof that the whole workflow is reachable.
- Which capabilities `supabase/tests/` actually proves.
- Whether status transitions are enforced — there are **no check constraints**
  on the status columns, so enforcement is by trigger or not at all, and I did
  not read all ~40 triggers.
- `docs/PROGRESS.md` against this. If it disagrees, this file is the one
  built from the database, but the disagreement itself is worth reading.
