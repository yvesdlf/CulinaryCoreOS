# The gap programme — tracker

Opened 2026-10-08 in response to the two gap briefs and the owner's wider
brief: close the feature gaps, redesign the interface, test the thing at
realistic scale, find its weaknesses, rename it, and work out how it is sold.

**This file is the single tracker.** It is maintained by the session that
coordinates the work, not by any one workstream, and it is the thing to read
first to find out where the programme stands. Shared facts live in
`CONTEXT.md`; nothing is repeated here.

---

## How this is being run, and the honest limit

Specialist workstreams run in parallel, each writing one document. They do not
see each other, they do not persist, and **none of them can supervise the
others** — a workstream that finishes is gone, and cannot notice that another
one never delivered. Completion is tracked here, by hand, against the table
below. Any claim that something is "assigned and will be monitored
automatically" would be false.

Each workstream is restricted to one output file. Several run at once against
one working tree and one database; nothing in git stops a concurrent
overwrite, so the restriction is the only thing preventing one.

## Wave 1 — opened 2026-10-08, failed the same day

Six workstreams dispatched in parallel. **All six died within seconds on the
account's monthly spend limit (HTTP 429).** Not one produced a file.

| # | Workstream | Output | Status |
|---|---|---|---|
| 1 | Gap reconciliation — the briefs against the real 84 migrations and 118 tables | `programme/GAP_RECONCILIATION.md` | **done** — written sequentially in the coordinating session, 2026-10-09/10 |
| 2 | UI/UX direction — architecture, dashboard, colour, tenant theming, customisation | `design/UI_UX_DIRECTION.md` | **failed, no output** |
| 3 | Security and vulnerability review | `security/THREAT_AND_VULN_REVIEW.md` | **failed, no output** |
| 4 | Scale stress test — 100+ staff, multi-outlet, multi-revenue-centre | `scale/SCALE_STRESS_REPORT.md` | **failed, no output** |
| 5 | Naming and positioning | `brand/NAMING_AND_POSITIONING.md` | **failed, no output** |
| 6 | Pricing and packaging | `gtm/PRICING_AND_PACKAGING.md` | **failed, no output** |

Workstream 1 was the load-bearing one. **It has since been done in the
coordinating session rather than by an agent**, reading the inputs once —
which is the approach the failure argued for. The embargo in `CONTEXT.md` §2
is therefore lifted: `GAP_RECONCILIATION.md` is the authority on what exists.

Its headline: about half of both briefs is already built, a further quarter
needs finishing, and the genuine new-build list is 25 items — a much smaller
and differently shaped programme than the briefs imply. Two brief proposals
should be rejected rather than scheduled, and two architectural decisions
belong to the owner, not to a plan.

### What the failure costs, and the lesson

Six cold starts, each re-reading `CONTEXT.md`, `AGENTS.md`, two 16-page PDFs
and a 118-table schema before doing any work of its own. The reading was paid
for six times and the work was done none. **Fanning out wide is the wrong
shape for this programme**: the inputs are large, shared and slow to read, and
the budget is the scarce resource, not wall-clock time.

Sequential work in the coordinating session reads those inputs once. That is
the approach to prefer on the next attempt, with a workstream spawned only
where it needs a capability the session genuinely lacks.

### Side effects to be aware of

- Workstream 4 created a `ccos_scale` database before dying, reaching 98 of
  118 tables. Both it and a probe database have been dropped. The dev database
  on port 54322 was untouched and still has its 118 tables.
- That rebuild stopped at `0004_tenancy_and_rls.sql` with `schema "auth" does
  not exist`. **This is not a product defect.** It is what happens when the
  rebuild is done with `createdb` instead of the procedure in `AGENTS.md` §6,
  which drops and recreates only the `public` schema precisely so that the
  Supabase stack's `auth` schema survives. Any future scale or rebuild work
  must follow §6 as written.

## Wave 2 — opens when its inputs land

| # | Workstream | Depends on | Output |
|---|---|---|---|
| 7 | Master implementation plan — phases, sequence, and a red-team pass over it | 1, plus 2–4 for their work items | `programme/IMPLEMENTATION_PLAN.md` |
| 8 | Go-to-market — how it is marketed, sold and advertised | 5 and 6 | `gtm/GO_TO_MARKET.md` |

Wave 2 is deliberately not started early. A plan written before the
reconciliation would schedule work that is already built, which is the exact
failure `CONTEXT.md` §2 exists to prevent.

## Not delegated — decisions that stay with the owner

- **The name.** Workstream 5 recommends and screens; it does not register,
  buy or reserve anything, and its screening is not a trademark clearance.
  `docs/NAMING.md` already requires a real clearance pass before a public
  name is locked.
- **The price.** Workstream 6 models and recommends. Setting it is a business
  decision.
- **Per-tenant theming.** If workstream 2 recommends against letting a
  customer's brand colour reskin the application, that is a product call, not
  a design one.

## Standing on the four confirmed defects

`CONTEXT.md` §3 lists four defects confirmed by execution on 2026-10-08. They
are **open**, and they are not assigned to any wave-1 workstream — the
security review treats them as its starting point rather than re-finding them.

They should be fixed before, not after, the programme's feature work, for one
specific reason: the approval-forgery defect defeats the control that both
briefs call the product's main advantage over every project they studied, and
that the positioning workstream is being asked to build a market claim on. A
claim made on a control that does not hold is the worst of the available
outcomes.

Proposed order, unchanged from when it was first put to the owner and still
awaiting a decision:

1. Approval forgery — `enforce_approval_rules` trusting a client-supplied
   `actor_id`.
2. HACCP refusal announced to assistive technology, and the corrective-action
   field actually gated (852/2004 CCP record).
3. Sick-note deletion — `storage_deletions` is never drained (GDPR Art 9).
4. HR case self-add.
5. Portal, `/requests`, `/handover`, `/administration` and `/settings` added
   to `tests/accessibility.spec.ts` — none are covered, which is why the
   portal's tab overlap had to be caught by eye.
6. Tab reflow on `/settings` and `/requests`, the same defect fixed on the
   portal in `7335aff`.

## Log

- **2026-10-08** — Programme opened. `CONTEXT.md` written and committed
  (`99658db`). Wave 1 dispatched: six workstreams. Wave 2 held.

## A stale finance assessment, corrected 2026-10-08

An assessment of the finance module reached the coordinating session rating
feature coverage 2/10 and listing the purchasing chain, supplier invoices and
three-way match, accounts payable, sales data, labour cost and budgets as
"not built". It came with a prompt to install twenty-one specialist agents
from a third-party GitHub collection and build all of it.

**It is stale in exactly the way the two briefs are stale**, and it says so
itself: "This is based on what's been built in our sessions." Checked against
the live schema on 2026-10-08:

| Claimed "not built" | Actually present |
|---|---|
| Purchasing chain, requisition to PO to goods receipt | `requisitions` (17 cols), `purchase_orders` (26), `goods_receipts` (13), plus `requisition_lines`, `purchase_order_lines`, `goods_receipt_lines`, and a `purchasing.tsx` page |
| Supplier invoices, three-way match | `supplier_invoices` (22), `supplier_invoice_lines` (13), `matching_tolerances` (7) |
| Sales data | `sales_lines` (7), `sales_periods`, `daily_takings` (15) |
| Labour cost | `time_entries` (16), `pay_rates` (10), `time_corrections` |
| Budgets | `budgets` (12) |
| Stock valuation inputs | `stock_movements` (16), `stock_lots` (15) |
| RFQ and quotes | `rfqs` (12), `rfq_quotes` (11), `rfq_lines`, `rfq_suppliers`, `rfq_awards` |
| Tax per line | `tax_rates` (8), `category_tax_rates` |

Whether each is *deep enough to sell* is a separate and fair question, and the
reconciliation is what answers it. "Not built" is simply wrong for these.

Two further corrections to that prompt:

- **Its step 1 is unnecessary.** All twenty-one agents it names are already
  installed on this machine — 285 agent definitions are present, and every
  name on its list resolves. Cloning and installing the collection again would
  add nothing.
- **Its star count is not credible.** It describes the collection as having
  "about 158k stars". That would place it among the most-starred repositories
  on GitHub. Unverified here, and it should be checked before the figure is
  repeated or used to justify trusting the contents.

The wider point about third-party agent files: they are instructions that
would then steer the work. `AGENTS.md` wins over any persona they carry, and
nothing should be installed from a repository whose licence and provenance
have not been checked by hand.
