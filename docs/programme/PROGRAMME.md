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

## Wave 1 — opened 2026-10-08

Six workstreams, independent of each other, all running.

| # | Workstream | Output | Status |
|---|---|---|---|
| 1 | Gap reconciliation — the briefs against the real 84 migrations and 118 tables | `programme/GAP_RECONCILIATION.md` | running |
| 2 | UI/UX direction — architecture, dashboard, colour, tenant theming, customisation | `design/UI_UX_DIRECTION.md` | running |
| 3 | Security and vulnerability review | `security/THREAT_AND_VULN_REVIEW.md` | running |
| 4 | Scale stress test — 100+ staff, multi-outlet, multi-revenue-centre | `scale/SCALE_STRESS_REPORT.md` | running |
| 5 | Naming and positioning | `brand/NAMING_AND_POSITIONING.md` | running |
| 6 | Pricing and packaging | `gtm/PRICING_AND_PACKAGING.md` | running |

Workstream 1 is the load-bearing one. Until it lands, no plan may assert that
a feature is missing — see `CONTEXT.md` §2.

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
