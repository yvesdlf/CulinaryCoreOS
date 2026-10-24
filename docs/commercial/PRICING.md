# Pricing

Written 2026-10-18, against what is actually built (migrations 0001–0115).

The brief asked for several models to be weighed: limited features with
paid add-ons, a monthly renewal, a one-time purchase, and pricing by user
count or organisation size. Three of those four are recommended. One is
recommended against, with reasons.

---

## 1. The decision that matters most: do not charge per user

It is the obvious model and it is wrong for this product specifically.

The thing that makes every report in this system worth reading is that the
people on the floor put data into it — the commis chef clocking in, the
housekeeper closing a room, the storeman counting a shelf. The staff portal
exists to make that frictionless, and **a per-user price puts a meter on the
one behaviour the whole product depends on.** A venue with 120 staff would
licence 8 of them, the other 112 would go back to paper, and within a month
the food cost variance would be unexplainable because the stock counts
stopped.

**Staff portal accounts are free, without a cap, permanently.** Say so in the
pricing table; it is a feature, not an omission.

What gets charged for is **venues** — an outlet with its own takings, its own
stock and its own rota. That is the unit that scales with the customer's
revenue, which is what you want a price to track.

---

## 2. Recommended structure

### Per venue, per month, with module packs

The product already divides cleanly, because the section grid divides it:

| Pack | Sections | What it is |
|---|---|---|
| **Core** (always) | Parameters, Admin, Messaging, Requests, Handover, staff portal | The section grid, the audit trail, the portal. Not sellable separately — everything else assumes it. |
| **Kitchen** | Recipes, Menu, Production, Hygiene | Costing, sub-recipes, allergens, HACCP, prep, labels. |
| **Supply** | Inventory, Purchasing, Suppliers, Traceability | Stock, counts, orders, receipts, landed cost, scorecard, recall. |
| **People** | People, HR cases, Pay | Rota, attendance, leave and carry-over, cases, payroll export. |
| **Property** | Maintenance, Housekeeping | Assets, work orders, rooms, attendant workload. |
| **Revenue** | Revenue | Takings, forecast, profit by unit. |

A single-site restaurant buys Core + Kitchen + Supply. A hotel buys
everything. **Nobody is sold a module for a thing they do not do**, which is
the actual complaint behind "sold with limited features".

Access is already enforced per section by trigger and policy, so a pack is a
grant rather than a hidden screen — and `AGENTS.md` §1 means an unsold module
is genuinely unreachable, not merely invisible.

### Indicative numbers

A 2026 benchmark for hospitality group suites puts the market at
**USD 55–220 per property per month**, with F&B stock and purchasing at
33–77 and HR and scheduling at 22–55 per property per month
([kolonell.com](https://kolonell.com/en/blog/hospitality-group-management-software-cost-benchmark-2026)).
Hotel PMS add-on modules run USD 20–500 depending on the module
([hotelogix](https://www.hotelogix.com/blog/hotel-pms-pricing)). Those are
vendor-published figures and should be read as indicative, not as evidence.

A defensible opening position:

| | Core | + each pack | Typical venue |
|---|---|---|---|
| **Single site** | $39 | $29 | $97 (Core + Kitchen + Supply) |
| **Group, per venue** | $29 | $22 | $73 |

Group pricing starts at three venues. It is lower per venue because the cost
of serving the fourth venue is near zero and because multi-venue customers
are the ones worth keeping.

This sits at the low-to-middle of the benchmark, which is the right place:
the product is unusually complete for its age and unusually unproven in the
market, and the second of those is what a buyer is pricing.

---

## 3. One-time purchase: recommended against

The brief asks for it and it should not be offered. Three reasons, in order
of how expensive each one is to learn:

**The compliance is the product, and the compliance changes.** This system
encodes Regulation 1169/2011 on allergens, 178/2002 on traceability,
852/2004 on training, 2003/88/EC on working time, and GDPR Article 9 on sick
notes. Those are not features that are finished — they are obligations that
move, and when one moves every venue needs the change at once. A perpetual
licence sells somebody a compliance tool with no funded mechanism to keep it
compliant, which is worse for them than not selling it at all.

**The costs are recurring whether the revenue is or not.** Postgres, storage,
the media retention jobs, the outbox. A one-time fee funds those until it
does not.

**It prices against your own interest.** The money arrives when the customer
knows least about whether the product works. The renewal model is the one
that pays you for being worth keeping.

**What to offer instead:** annual prepay at two months free. It gives the
buyer who wants to "just buy it" the thing they actually want — a single
decision and a lower price — without selling a promise that cannot be kept.

---

## 4. Charging for the assistant

Already built, and the model falls out of the architecture (0115):

- **Your own provider key — free, no limit from us.** The call goes from the
  browser to Google or Anthropic and the bill is theirs. It costs the platform
  nothing, so charging for it would be charging rent on somebody else's
  spending.
- **The shared key — metered, with a monthly allowance.** The call goes
  through an edge function, usage is recorded against what the provider
  actually reported, and it stops at the allowance rather than at an invoice.

Include a small allowance in Core (enough to try it: say 200 requests a
month) and sell more in blocks. The honest framing on the settings screen —
own key is cheaper and we impose no limit on it — costs some assistant
revenue and buys the thing this product is otherwise built to be trusted on.

---

## 5. What is not ready to be sold yet

Saying this now is cheaper than a refund later.

- **There is no billing system.** Nothing meters a subscription, invoices it
  or cuts anybody off. `ai_allowances` is set by hand with the service role.
  Before the first paying customer: Stripe, a `subscriptions` table, and a
  job that reconciles entitlement to the section grid.
- **There is no iOS app.** `apps/ios` is a README and zero Swift files. Every
  brief item that says "on the iOS app" — offline counting, camera capture,
  the attendant room flow — has no host. The staff portal is a responsive web
  page and that is the mobile story. Do not sell the other one.
- **A food cost percentage still cannot be computed.** The per-product
  variance exists; the ratio needs paired opening and closing stocktakes and
  nothing records them as a pair. It is the single most-asked-for number in
  the category. See `docs/METRICS.md` §2.
- **One venue has used this.** Every figure above is a reasoned opening
  position, not a tested one. The first five customers are a pricing
  experiment and should be priced — and contracted — as one.

---

## 6. Sequence

1. **Name it** (`NAMING.md`) — before any of this is printed anywhere.
2. **Pick the packs**, which is mostly done above; they follow the section
   grid, so the disagreement will be about Revenue, which could sit in Core.
3. **Build billing.** Until that exists there is no pricing model, only a
   price list.
4. **Sell five at the group rate**, to venues that will tell you the truth,
   with a written note that the price is provisional.
5. **Raise it.** The opening position above is deliberately low and the
   benchmark says there is room above it. Raising a price on new customers is
   easy; discovering you are too cheap to fund the compliance work is not.
