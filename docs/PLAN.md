# The plan

> Rewritten 2026-09-19 at `121153f`. This is the only ordering in the
> repository — earlier versions of this file, plus the sequencing sections of
> `PLATFORM.md` and `UI_REVIEW.md`, are folded in here. Three documents each
> claiming to say what comes next is how they drift apart.
>
> Companions: `PROGRESS.md` is what exists, `PLATFORM.md` is the shape it
> should take, `UI_REVIEW.md` is a received critique.

---

## 1. The gaps

Grouped by what kind of thing is missing, because the kinds need different
treatment. Ordered within each group by consequence.

### 1.1 Process — how we know anything still works

| Gap | Why it matters |
|---|---|
| **No repeatable proof of any database control** | Roughly forty triggers carry the system's honesty — segregation of duties, certificate gating, meter resets, room release, sheet capacity, the section grid. Every one was proved once, by hand, in a scratch file nobody kept. CI rebuilds the schema and runs the browser suites and checks none of them. A control nobody re-proves is a control that can be deleted by accident and noticed by an auditor. |
| `pnpm lint` fails | eslint is not installed. A lint script that cannot run reports green by never reporting. |
| Never deployed | `DEPLOY.md` has never been executed and is therefore fiction. |
| `main` is 17 commits behind | Everything lives on one branch and one open PR. |

### 1.2 Structure — what stops the platform being a platform

| Gap | Why it matters |
|---|---|
| **Two organisation trees** | `departments` (HR) and `cost_centres` (money) are separate tables. Three of five departments have no cost centre; one cost centre has no department. Employees and shifts hang off one, orders and budgets off the other, so "what did the bar spend on staff" is unanswerable. |
| **No unit scope on access** | A section is on or off for the whole venue, so "purchasing sees its own staff" cannot be expressed, and neither can any role narrower than the organisation. |
| **No department contract** | Adding Security or Bakery today means deciding case by case what they get. See §2. |
| `repository.ts` is 4.627 lines | 9% of the front end in one file. Not a bug; the clearest structural smell. |

### 1.3 Facts — data that simply is not there

| Gap | Consequence |
|---|---|
| **No pay rate** | Hours are recorded, corrected and argued over. Without a rate there is no labour cost, so no unit P&L, so no CFO or CEO view. |
| **No revenue per unit per day** | Only dish-level `net_sales` on imported POS periods. |
| **No production completion records** | Blocks theoretical-vs-actual usage, one-step-forward traceability, and PM completion evidence — three items that each look separate and are one. |
| **No media storage** | No photograph on a fault report, on waste, or on an inspection. |
| **No occupancy source** | Housekeeping records it by hand and says so on the page. |

### 1.4 Communication — the platform cannot tell anybody anything

| Gap | State |
|---|---|
| **Notifications** | Events are raised by trigger and delivered nowhere. An invitation is not emailed, an approver is never told, an order marked "ordered" transmits nothing. |
| **Handover** | No shift-to-shift note anywhere. It lives in WhatsApp — exactly where this platform is trying to stop things living. |
| **Escalation** | A document nobody acts on sits forever. |
| Adapters unproven | WhatsApp, email and the AI assistant have never made a real network call. |

### 1.5 Controls with known holes

Realtime sync built and reverted, undiagnosed. Field-level audit history for
everything outside the six ledgers. The cascade RPC and the row that triggers
it are still two requests. No organisation switcher. US allergen profile.

### 1.6 Reach — capabilities not yet present

Finance beyond a matched invoice: payments, unit P&L, export to an accounting
package. Menus with sections. A beverage cost basis. Multi-location stock,
which blocks engineering stores. Stewarding, IT, Front office, Marketing,
Security, Bakery as units. Hygiene scoped per unit. AI import. Native shells.

### 1.7 Interface

`UI_REVIEW.md` in full: flat twenty-item sidebar, eleven tabs on People,
one-sentence empty states, no role-aware dashboard, density and elevation
drifted from DOC4.

---

## 2. Future-proofing: the department contract

The test for whether the platform is a platform: **can Security, Bakery or a
Café be added without writing a migration?**

Today, no. The answer is a contract — a written list of what any unit gets for
free, and the only three places a unit is allowed to differ.

### 2.1 What every unit gets, without code

Once §3 Stage 1 exists, one row in `business_units` buys all of this:

| | From |
|---|---|
| Identity, a parent, a manager, a 3-letter code | `business_units` |
| A cost centre, a budget, approval thresholds | it **is** the cost centre |
| Its own document numbers — `WO-SEC-260919-001` | the shared sequence, which has abbreviated units since 0047 |
| People: rota, leave, attendance, certifications, competency | People, scoped |
| Places it owns, and every asset at them | the location tree |
| Buying: its own suppliers, requisitions, approvals, receipts, invoices | Purchasing, scoped |
| Compliance: its own forms and its own overdue list | Hygiene, scoped |
| The five raise rights, in and out | the document spine |
| One dashboard tile | rendered from the access grid |

### 2.2 The three places a unit may differ

Everything else is configuration. These three are the only extension points,
and each is deliberately small.

**a. Its cost basis.** Food cost % for a kitchen, pour cost % for a bar, cost
per occupied room for housekeeping, cost per cover for service, cost per
labour hour for security. One pluggable metric per unit: a numerator, a
denominator, a target. Not a module.

**b. Its own kind of document.** A security incident, a bakery batch, a guest
complaint. This is the one that would otherwise produce a table per
department, so it gets a single mechanism — see §2.3.

**c. Its own compliance forms.** Already data: the venue uploads its own HACCP
sheets today, numbered as its own paperwork numbers them.

### 2.3 One intake, many departments

The platform already has five things that are the same shape wearing different
names: a work order, a HACCP breach, an HR case, a staff request, a hiring
request. Each is *something happened or somebody wants something → route it →
somebody owns it → close it with evidence.*

Rather than a sixth table for security incidents and a seventh for guest
complaints, build **one report intake**: a type, a raiser, a unit, a place, an
asset, media, a severity, a routing rule, and an append-only status ledger.

Crucially it is an **intake layer, not a replacement.** A specialised module
converts a report into its own document — maintenance turns a fault report
into a work order with an asset and a schedule. The existing modules keep
everything they have; what they gain is one front door.

With that in place:

- **Security** = a unit + reports of type `INCIDENT` + patrol logs as
  compliance forms + CCTV in the asset register + a rota. **No new table.**
- **Bakery** = a unit + preparations with batch yields and production planning,
  both of which exist + its own HACCP forms + food cost basis. **No new table.**
- **Café** = a unit; or, if it is the whole business, an organisation with one
  unit and four capabilities on. **No new table.**

That is the future-proofing, and it is falsifiable: if adding Security needs a
migration, the model is wrong.

---

## 3. What has to be done, in order

Each item says what it is and, briefly, how.

### Stage 0 — Make the current state defensible (days)

**0.1 Commit the SQL proofs as a suite, and run them in CI.** *The single most
valuable item in this document.* Take the ad-hoc proofs written for
purchasing, HR, maintenance, housekeeping and the section audit, turn them
into a `supabase/tests/` directory, and run them after `supabase db reset` in
the job that already exists. Two rules learned the hard way: assert **rows
changed**, not that no error was raised, and read the row back — an `UPDATE`
matching nothing raises nothing, and a trigger may silently correct what it
did not refuse.

**0.2 Install eslint.** One dependency.

**0.3 Merge PR #1.** `main` has not moved since August.

**0.4 Deploy.** Nothing downstream — realtime, notifications, mobile, a
supplier or technician outside the building — can be finished on a laptop.

### Stage 0.5 — The cheap half of the interface (days, any time)

Independent of everything else, so it can run in parallel and should, because
it is the part anybody can see. Detail in §4.

Sidebar grouping · People and Purchasing vertical navigation · empty states ·
top-bar context · table density and chips · the token pass.

### Stage 1 — The spine (the riskiest work here)

**1.1 `business_units`.** One table that is the department, the cost centre
and the owner of locations. Thirteen tables of foreign keys. Method: create it,
backfill from both trees, keep `departments` and `cost_centres` as views until
every reference has moved, then drop them. It gets its own branch and its own
proof suite before anything is dropped.

**1.2 The scope axis.** `member_scope(person, unit)` beside the existing
`member_access(person, section, level)`. Read together: the section says what
kind of thing, the unit says whose. No scope means every unit, never none, so
no existing grant becomes worthless on the day it ships. Enforced by extending
`require_section_write` and adding a `unit_visible()` predicate to the policies
of tables that carry a unit.

**1.3 The department contract as a function.** `seed_business_unit(org, code,
capabilities)` — the §2.1 list, created in one call. This is what makes §2
true rather than aspirational.

### Stage 2 — The facts (each unblocks several things)

**2.1 Pay rates,** with effective dates and a history, in the restricted table
beside the other personal data — last month's payroll must stay computed at
last month's rate, the same reasoning that keeps last month's waste valued at
last month's price. *Subject to the decision in §6.*

**2.2 Revenue per unit per day.** Manual daily takings is a day's work and
unblocks the entire executive layer; POS integration is the right answer and
needs a POS named.

**2.3 Production completion records.** One feature, three items closed:
theoretical-vs-actual usage, one-step-forward traceability, PM evidence.

**2.4 Media storage.** A Supabase Storage bucket per organisation, RLS on the
objects mirroring the parent document's, a hard cap on video length and a
retention policy. Photographs of a fault are cheap; video is not.

### Stage 3 — Communication

**3.1 Notifications, email first.** The events already exist and are raised by
trigger, so this is a worker draining a queue, not new plumbing. WhatsApp
needs a Meta Business account that does not exist and would still need email
underneath.

**3.2 The report intake** (§2.3), starting with fault reporting, which is the
first thing to need 2.4 and makes 3.1 unavoidable — a report nobody is told
about is a suggestion box.

**3.3 Handover.** Small, used every shift, and the thing the platform
currently loses to WhatsApp.

**3.4 Escalation.** What stops 3.2 becoming a pile.

### Stage 4 — One dashboard, rendered from the grid

Not seven dashboards. One component that renders what the person's capability
× scope says they are accountable for. Depends on 1.2 for scope and on 2.1/2.2
for anything carrying money. **The general manager view is buildable before
2.1 and 2.2**; only margin and labour tiles are blocked.

### Stage 5 — Capabilities, as units

Hygiene scoped per unit, and the failed-check-raises-a-job link — the highest
value cross-module link available. Then Beverage with its pour cost basis,
Finance, Stewarding, IT, Marketing, Front office. Each should be a
configuration exercise; each one that is not is a bug in §2.

### Stage 6 — The long tail

Multi-location stock, then engineering stores. Menus with sections. Field-level
audit. Realtime, on a deployed instance. Organisation switcher. US allergens.
AI import. Native shells.

---

## 4. The interface, and how

From `UI_REVIEW.md`, with a method for each. Everything in Stage 0.5 except
the last line.

| What | How |
|---|---|
| **Sidebar grouped by work area** | Six groups — Today, Culinary, Supply, Operations, People, System. Data change to `navItems`, plus a group header component. Later, filtered by the access grid. |
| **People and Purchasing: vertical navigation** | Eleven tabs is past what a tab row carries. A left rail inside the page, grouped by purpose — the reviewer's Concept 2. The tab content components do not change. |
| **Empty states** | A sentence of explanation, one primary action, and a description of what will appear once there is data. There are about fifteen. |
| **Top-bar context** | Venue, date, service, covers. Covers exist in Production; the venue is the organisation; service is derived from the clock. |
| **Tables** | Avatars, status chips, sticky filters, a density toggle. The chips already have semantic tokens. |
| **The token pass** | Warm off-white background, page headers, compact metric cards, elevation from the four DOC4 shadow steps. **One commit.** |
| **Role-aware dashboard** | Stage 4. Platform work, not visual work. |

Three constraints, repeated here because they decide the cost:

1. **WCAG AA is enforced in CI in both themes.** A background change moves the
   contrast denominator for every token on every page, and PROGRESS already
   records tokens tuned against one background only as a defect that shipped.
2. **The visual snapshots are all invalidated by a restyle.** Do it as one
   commit whose snapshot diff is reviewed, not accepted.
3. **Hiding an action is not authorisation.** Role-aware navigation hides for
   clarity; the database refuses the write regardless.

---

## 5. Why this order

The realignment, stated as reasons rather than a list.

**Proof before features.** Stage 0.1 comes first because everything after it
adds triggers to a system with no regression test for triggers. Building Stage
1 on top of forty unproven controls means the migration that merges the org
trees cannot be shown to have preserved them.

**Structure before facts.** Pay rates and revenue are more exciting than
`business_units`, but attaching money to a cost centre tree that disagrees with
the department tree means doing it twice.

**Facts before dashboards.** An executive dashboard drawn over a missing
labour cost looks finished and answers nothing.

**Communication after facts, before capabilities.** A new department that
cannot tell anybody anything is a folder.

**Interface in parallel, in two halves.** The cheap half depends on nothing
and should not wait behind a database migration. The role-aware half is Stage
4 by definition.

**Departments last, and that is the point.** If §2 is right, they cost
configuration. If they turn out to cost migrations, the spine was built wrong
and that is worth finding out before there are six of them.

---

## 6. Decisions this needs

- **Pay rates here, or hours out to a payroll provider?** Holding rates means
  holding the most sensitive data in the product and taking on payroll's
  compliance surface. Holding none means no labour cost and no unit P&L. The
  middle — rates for costing only, payroll elsewhere — is probably right.
- **Revenue: a POS integration, or manual daily takings?** Manual is a day and
  unblocks everything; integration needs a POS named.
- **Is a venue the unit of sale, or an enterprise?** Decides whether the unit
  tree has one root or many.
- **Front office: integrate with a PMS, or become one?**
- **The reduced VAT rate**, still open, and now blocking a bar rather than
  only a food menu.
