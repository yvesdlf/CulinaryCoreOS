# Metrics — what every number on a screen actually means

Both gap briefs ask for this, and the reason is specific: these formulas
exist only as SQL. Somebody disagreeing with a figure has to read a view
definition to find out what it counted, and two screens showing "food cost"
can mean different things without anybody noticing.

**This file is the definition. The views implement it.** Where the two
disagree the view is the bug, not this file — but say so rather than
quietly editing one to match the other.

Written 2026-10-18 against migrations 0001–0113.

---

## 1. The rule behind all of them

Every metric here is a view, or a function behind a view, and the UI reads
only from those. That is `AGENTS.md` §1 applied to numbers: a figure
computed in the browser is a figure that can disagree with the same figure
computed in a report, and the one somebody quotes in a meeting will be the
wrong one.

Three conventions hold throughout:

- **Money is `numeric`, and views cast to `numeric(18,5)`** before returning
  it. A variance printed as `-400.0000000000` beside `-400.00000` on the
  next screen reads as two different numbers.
- **Null means unknown, zero means zero.** They are never conflated. Most of
  the care in these views is in keeping them apart — see §4.
- **A caveat lives in the view, not on the screen.** A flag a page remembers
  to show is one an export forgets.

---

## 2. Food cost

The chain both briefs call the most valuable report, and the one that took
four migrations to make possible.

### Theoretical consumption — `sales_usage_theoretical`, `recipe_product_requirements`

What the recipes say should have left the store.

```
for each sales line:
  theoretical qty of product P
    = units_sold × (quantity of P in one portion, exploded through
                    every level of sub-recipe)
```

`recipe_product_requirements` does the explosion. A recipe line asking for
200 ml of a sauce whose batch yields 500 ml takes two fifths of that batch,
so each of the sauce's own lines contributes two fifths of its quantity —
and if the sauce uses a stock, the same again, to a depth of ten.

`production_usage_theoretical` does the same walk for a production run
(0111). It expanded only **one** level until then and silently dropped
nested preparations — so `production_variance()`, which reads the gap
between theoretical and actual as waste, showed a kitchen making a
demi-glace from a veal stock throwing away the entire stock, every batch.
`production_expansion_gaps` names the records whose walk had to stop at a
preparation with no batch yield, since those are still short.

### Actual consumption — `stocktake_variance`, `food_cost_variance`

What the shelves say left the store.

```
count adjustment for product P
  = sum of COUNT movements for P
  = Σ (counted_qty − expected_qty) over posted stocktake lines
```

### The variance — `food_cost_variance`

```
theoretical_used    = −Σ quantity of USAGE movements where reason = 'sales'
theoretical_value   = theoretical_used × products.gross_price_per_unit
count_adjustment    =  Σ quantity of COUNT movements
adjustment_value    = count_adjustment × products.gross_price_per_unit
```

A negative `adjustment_value` is stock that was on the books and not on the
shelf: waste nobody wrote down, over-portioning, breakage, theft, or a
recipe that no longer describes what the kitchen does.

**Two caveats carried as columns, not as screen text:**

| Column | Means |
|---|---|
| `never_counted` | Used but never counted. The variance is **unknown**, not zero — and zero is also what a perfect count looks like. |
| `sales_partly_unmapped` | Some sales are on till codes no menu item claims, so those lines posted no consumption and `theoretical_used` is understated. There is no way to know by how much. |
| `counts_behind_it` | How many counts stand behind the figure. One count is one count's worth of evidence. |

### What this still cannot tell you

**A food cost percentage.** That needs two stocktakes bracketing a period:

```
actual food cost % = (opening stock + purchases − closing stock) ÷ food sales
```

Nothing records a period's opening and closing counts as a pair, so the
ratio is not computed anywhere. The per-product variance above is what
exists. **Do not present it as a percentage.**

---

## 3. Revenue, labour and profit

### `revenue_daily`

Per business unit, per channel, per day, from `daily_takings`.

```
net_amount       = gross_amount − commission_amount
spend_per_cover  = net_amount ÷ covers        (null where covers is 0)
```

### `labour_cost_daily`

```
hours = (clock_out − clock_in − break_minutes), from approved time entries
cost  = hours × the rate in force on that date   (pay_rate_on)
```

The rate is the one that applied **on the day worked**, not today's — the
same principle as the exchange rates in §6. `refuse_backdated_pay_change`
stops a rate being altered behind an approved timesheet.

### `unit_labour_against_revenue`

```
labour_percent_of_net = labour_cost ÷ net revenue × 100
```

### `unit_profit_daily`

```
gross_profit         = revenue_net − labour_cost − goods_cost − waste_cost
gross_profit_percent = gross_profit ÷ revenue_net × 100
```

`unattributed_goods_cost` is beside it on purpose: stock movements carrying
no business unit cannot be charged to one, and folding them into whichever
unit sorts first would invent a fact.

### `cost_of_goods_daily`

```
used_cost   = Σ (quantity × unit_cost) of USAGE movements
wasted_cost = Σ (quantity × unit_cost) of WASTE movements
movements_with_no_cost   -- counted, because a zero cost is usually a gap
```

---

## 4. Where null and zero are kept apart

The single most repeated piece of care in this schema. Each of these pairs
looks identical in a total and means the opposite.

| Where | Null means | Zero means |
|---|---|---|
| `stocktake_lines.counted_qty` | Nobody reached that shelf. Posts nothing. | Somebody looked and there was none. Posts the full write-off. |
| `food_cost_variance.never_counted` | — | A product counted and found exactly right |
| `sales_lines.recipe_id` | The till code maps to nothing yet | — |
| `in_base_currency(...)` | No exchange rate is known for that date | The amount really is zero |
| `menu_item_pricing.price` | Neither the menu item nor the recipe is priced | The dish is free |
| `checklist_answers.passed` | Not yet answered | — |
| `leave_carryover.carried_days` on a type with no allowance | — | (no row is written at all — "carried sick days" reads as an allowance to spend) |
| `sales_forecasts.covers` | No trading history for that weekday — **no row is written at all** | — |
| `forecast_accuracy.covers_error_percent` | What happened has not been recorded | The forecast was exactly right |
| `receipt_line_landed_cost.landed_unit_cost` | Nobody recorded a price for the line, or the whole line went back | — |
| `receipt_line_landed_cost.uplift_percent` | There is no goods value for the charge to be a percentage of | The delivery carried no charges |
| `supplier_scorecard.late_percent` | No dated order has been delivered — the supplier has not been tried | Every delivery arrived on time |
| `supplier_scorecard.rejected_percent` | Nothing has been received from them | Nothing was ever refused |
| `recipe_lines_needing_conversion` | — | (a row here means the line **cannot** be costed, not that it costs nothing) |

---

## 5. Hygiene and compliance

### `hygiene_by_unit`

```
breaches_last_30_days
breaches_nobody_was_told_about   -- a breach with no raised request
days_since (last completed)
```

`breaches_nobody_was_told_about` is the number worth reading: a recorded
breach that raised nothing is evidence somebody knew.

### `haccp_outstanding`

Computed from each form's `frequency` and its last completion rather than
materialised as tasks. **Consequence:** changing a form's frequency rewrites
what was historically "due". Acceptable today, recorded here because it is a
real property of the design.

### Cooling — `cooling_logs`, `cooling_readings`

```
within_limit = temperature ≤ the stage's limit
               AND hours elapsed since start ≤ the stage's allowance
```

Both limits come from `venue_parameters` (`COOLING_STAGE_*`), not from the
migration, because they differ by country. Stage 2's clock runs from the
**start**, not from stage 1's reading: two hours plus four is six hours of
cooling in total.

### Delivery temperature

A goods receipt carrying `vehicle_temperature_c` writes a `haccp_records`
row with `source = 'receiving'`. Breach when above `DELIVERY_CHILLED_MAX`
(default 8 °C).

---

## 6. Money across currencies

### `rate_on(org, from, to, date)`

The latest rate **on or before** that date. Never a later one: a document
converted at a rate that did not exist when it was written is a number
nobody can reproduce.

### `in_base_currency(org, amount, currency, date)`

Null where no rate is known — **never the unconverted figure**. Returning
the raw amount would mix currencies inside a total and the result would look
like a number.

---

## 7. Purchasing

### `ap_aging`

Buckets by `current_date − due_date`: not yet due, 1–30, 31–60, 61–90, over
90. Only invoices in `APPROVED_FOR_PAYMENT`, `MATCHING`, `DISPUTED` or
`EXCEPTION` — a draft or a paid invoice is not a debt.

### `ap_by_supplier`

```
approved_to_pay = Σ invoices in APPROVED_FOR_PAYMENT
credits_owed_to_us = Σ credit notes in EXPECTED or RECEIVED
net_payable = approved_to_pay − credits_owed_to_us
stuck       = count of invoices in EXCEPTION or DISPUTED
```

`stuck` sits beside the total deliberately: a balance of zero means
something different when three invoices are in an argument.

### Landed cost — `receipt_line_landed_cost`

```
goods_value       = (quantity_received − quantity_rejected) × unit_price
charges           = Σ allocated receipt charges for the line
landed_value      = goods_value + charges
landed_unit_cost  = landed_value ÷ (quantity_received − quantity_rejected)
uplift_percent    = charges ÷ goods_value × 100
```

Each charge is spread on its **own basis**: by value (duty, insurance), by
weight (freight, pallet charges) or by quantity (a flat fee per case).
Spreading freight by value makes the saffron carry the cost of moving the
potatoes.

Three rules the allocation holds to:

- **Only accepted quantity carries a charge.** Rejected goods went back on the
  van, and putting freight on a crate the venue does not have would charge it
  to the margin of the one it does.
- **The parts sum to the whole exactly.** Shares are rounded and the remainder
  goes to the largest — three lines sharing 100.00000 by thirds otherwise
  comes to 99.99999, which is a reconciliation somebody spends an afternoon on.
- **It refuses rather than guesses.** A weight basis where a line has no
  weight, or a value basis over lines worth nothing, is refused. An even
  spread is not a cautious answer; it is a fabricated one that is
  indistinguishable from a real allocation afterwards.

`landed_cost_ready` names the receipts that cannot be costed and why, because
a landed cost report that silently omits them reads as though everything were
accounted for.

> **Deliberately not written back.** `product_landed_cost` sits beside
> `products.gross_price_per_unit` and does not update it. The catalogue price
> is what the venue has decided a product costs; a receipt is evidence about
> one delivery, and letting a delivery overwrite the catalogue would move
> every recipe's cost silently on the day a pallet arrived.

### Supplier scorecard — `supplier_scorecard`

Three components, over a window of `SCORECARD_DAYS` (default 180), each with
its own denominator and its own flag against a venue threshold:

```
late_percent     = deliveries arriving after expected_on ÷ deliveries scored × 100
                   (only orders that carried an expected date are scored)
rejected_percent = Σ quantity_rejected ÷ Σ quantity_received × 100
argued_percent   = invoices in EXCEPTION or DISPUTED ÷ invoices × 100
concerns         = count of the three flags raised
```

**There is deliberately no blended score.** The weights behind one number are
arbitrary, nobody remembers them a month later, and a supplier who is late but
cheap comes out level with one who is punctual and dear — the figure settles
the argument by hiding it. `concerns` orders the list without claiming the
three are commensurable.

Thresholds are `venue_parameters`, not constants: `SCORECARD_LATE_PERCENT`,
`SCORECARD_REJECT_PERCENT`, `SCORECARD_DISPUTE_PERCENT`. A fishmonger
rejecting 2% is a problem; a greengrocer rejecting 2% is Tuesday.

`thin_evidence` is raised below `SCORECARD_MIN_ORDERS` scored deliveries. It
labels the figure rather than hiding it — "83% late, from 6 deliveries" can be
weighed, and a suppressed row cannot.

### `supplier_price_history`

```
moved_percent = (this price − the one before it) ÷ the one before it × 100
```

Computed with `lag` rather than stored, so backfilling an old price
recomputes its neighbours instead of leaving a figure that was true when it
was written.

---

## 8. Menu

### `menu_item_pricing`

```
price      = menu_items.selling_price, falling back to recipes.menu_price
priced_by  = 'menu item' | 'recipe fallback' | 'unpriced'
contribution      = price − recipe_cost
food_cost_percent = recipe_cost ÷ price × 100     (null where price is 0)
```

`priced_by` exists so a menu cannot look fully priced when half of it is
inherited from the single price that predates menus.

---

## 9. People

### `attendance`

Rostered against actual, per person per shift. Corrections are new rows in
`time_corrections`, never edits — `protect_time_entries` enforces it,
because time becomes pay.

### Leave

Balances are **computed**, not stored:
`apps/web/src/engine/leave-balance.ts`.

```
remaining = entitlement − (approved days + pending days)
```

Pending counts against the balance: somebody with twenty days who has asked
for fifteen has five to plan with, not twenty. Leave with no annual
entitlement — sick, unpaid, parental — reports days **used** and never a
remainder, because "sick days remaining" reads as an allowance to spend.

### Carry-over — `leave_carryover`, `leave_entitlement_now` (0112)

```
unused   = entitlement + carried_in − taken        (floored at 0)
carried  = least(unused, coalesce(max_carryover_days, 0))
allowance next year = annual_entitlement_days + carried_in_now
```

**A null `max_carryover_days` carries nothing, not everything.** The strict
reading is recoverable — a venue sets a number and closes again; the generous
one is not, because by then people have booked against days they do not have.

**Stored, not recomputed.** The cap was applied on the day the year closed,
under a policy that may since have changed, and the figure ends up in pay when
somebody leaves (AGENTS.md §4).

**A year with an undecided request cannot be closed.** Closing around one
either loses the days or carries them as though they were never going to be
taken, and either way it is found in December.

Carried days expire `CARRYOVER_EXPIRES_MONTHS` into the new year (default 3).
`leave_entitlement_now.carried_in_now` is zero once they have lapsed, while
`carried_days` stays visible — the row is the record of what was decided, and
a balance that silently stopped existing leaves nothing to explain why
somebody's figure dropped.

### Availability — `is_available(employee, from, to)`

A specific date beats a repeating weekday; saying nothing means available.
Rostering against a stated unavailability is **allowed** and noted in the
shift, never refused.

---

## 10. The sales forecast

`sales_forecasts`, written by `build_sales_forecast(org, date, unit)` (0107).

```
sample  = the same weekday as `date`, over the last FORECAST_WEEKS weeks,
          excluding any day that is a public holiday
covers  = avg( sum of covers per day )        -- per DAY, not per row
net     = avg( sum of net_amount per day )
```

**Per day, not per row**, and the distinction is the whole arithmetic:
`daily_takings` holds one row per channel per day, so averaging rows averages
channels — a Tuesday trading through the till and a delivery app counts as two
half-Tuesdays.

A known event for that date then overrides the covers outright
(`covers_override`) or adds to them (`covers_extra`), never both.

**The figure is stored, not recomputed.** A roster built against Tuesday's
forecast must still be explicable in March, and accuracy has to be measured
against the number that was used.

### `forecast_accuracy`

```
covers_error_percent = |forecast − actual| ÷ actual × 100   (null until actual is recorded)
thin_evidence        = samples_used < 3
```

`thin_evidence` is a column rather than screen text for the usual reason: a
forecast from one past day is a guess with a decimal point, and an export that
drops the caveat is worse than one that never had it.

### What it deliberately does not do

No seasonality model, no trend, no regression. A forecast nobody can explain
is one nobody trusts, and an untrusted forecast is worse than none because the
system then looks like it is planning. The sample is short enough that the
drift inside it does not need modelling.

> **Not wired up yet.** Rostering targets, prep quantities and auto-reorder all
> want this figure and none of them reads it.

---

## 11. The label

`prep_label` (0113) assembles what goes on a tub of a prepared item.

```
use_by      = made_on + PREP_USE_BY_DAYS        (default 3)
expiry_kind = USE_BY, always
allergens   = every allergen on every product consumed, exploded through
              nested preparations (via production_usage_theoretical)
allergens_need_review = any of those products has allergens_need_review
```

It is a **use-by** and not a best-before: 1169/2011 draws that line at food
which becomes unsafe rather than merely worse, and a kitchen preparation is on
the unsafe side.

**There is no "contains no allergens" column, and there never will be.** The
view can say what was found in what the catalogue knows; a free-from claim is
something a person makes after reading a label. The print view words it "No
allergens found — in the ingredients recorded for this item".

`allergens_need_review` prints **on the sticker**, not just on the screen. A
caveat shown in a toast is one somebody dismissed before they pressed print,
and a printed label is the most confident surface in a building (AGENTS.md §8).

`label_prints` copies the allergens onto the row at print time rather than
looking them up later: the catalogue can change and the tub in the walk-in
cannot, and a recall needs to know what the sticker said (178/2002 Art 18).

---

## 12. What is deliberately not here
- **Rooms cleaned per attendant hour** lives in `housekeeping_workload` and
  is hotel-module only.
