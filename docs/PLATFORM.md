# Platform: departments, and how they link as one

> Written 2026-09-19 at `31f8ba5`. A design, not a record of what exists —
> `PROGRESS.md` is that. This answers a single question: what has to change so
> that one application runs a corner-shop café, a restaurant group and a small
> hotel, with each department working in its own part and reaching into other
> people's parts where it genuinely has to.

## 1. The problem underneath every other problem

The application already has two organisational hierarchies, and they do not
agree with each other.

```
departments (HR)          cost_centres (money)
  KITCHEN  ────linked───►   KITCHEN
  BAR      ────linked───►   BAR
  SERVICE  ── unlinked      FOH        ◄── no department
  ADMIN    ── unlinked
  ENG      ── unlinked
```

Three of five departments have no cost centre. One cost centre has no
department. Nothing forces the link, and the two are referenced by different
halves of the schema:

| | referenced by |
|---|---|
| `department_id` | employees, shifts, job_roles, hiring_requests, department_approvers |
| `cost_centre_id` | requisitions, purchase_orders, budgets, work_orders, locations, meters |

So "what did the bar spend on staff" cannot be asked, because staff hang off
one tree and money off the other. Every cross-department feature in this
document runs into that seam, which is why it is first.

### The fix: one business unit

One table — call it `business_units` — that **is** the department, **is** the
cost centre, and **owns** locations. `departments` and `cost_centres` become
views over it during migration and are then dropped.

A unit carries: a code (KIT, BAR, HK, ENG…), a name, a parent unit, a manager,
an approval threshold, and the locations it is responsible for. It is what a
reference number already abbreviates — `PO-KIT-260919-001` has been naming
business units since migration 0047, without a table to point at.

**This is the prerequisite for everything below.** It is also the single
riskiest migration in the project so far: it rewrites foreign keys across
thirteen tables. It should be its own piece of work with its own proof.

---

## 2. Permissions become two axes, not one

Today access is a grid of *person × section*. A person has WRITE on
Purchasing, everywhere. That cannot express what was asked for — "purchasing
should be able to see the HR records of their own staff" — because People is
one switch and it is on or off for the whole venue.

The change is to add a second axis:

```
        member_access   : person × section × level      (exists)
      + member_scope    : person × business unit        (new)
```

Read together: **the section says what kind of thing you may touch; the unit
says whose.** A head chef with `PEOPLE: WRITE` scoped to Kitchen can build the
kitchen rota, approve kitchen leave and see kitchen attendance — and sees
nothing at all of the bar's. An HR director has `PEOPLE: WRITE` with no scope,
which means all units.

Enforced the way everything else here is enforced: a trigger, extending the
`require_section_write` function that migration 0057 has just finished wiring
up, plus a `unit_visible()` predicate added to the RLS policies of the tables
that carry a unit.

Three properties worth stating, because each is a decision:

- **No scope means every unit**, not none. Otherwise every existing grant
  silently becomes worthless on the day this ships.
- **Scope narrows, never widens.** A person with `PEOPLE: NONE` and a Kitchen
  scope still has nothing. The section remains the outer gate.
- **A unit scope is inherited down the tree.** Scope somebody to Food &
  Beverage and they get Kitchen and Bar beneath it, because that is what a
  director of F&B is.

---

## 3. What anybody may do, regardless of department

Some things are not a department's property. A kitchen porter who finds a
leaking tap must be able to say so, and today the Maintenance section guard
refuses their write.

The model is the one this codebase already uses for staff self-service, and
which 0057 formalised: **you may raise a document; somebody else must act on
it.** Five of these, and they are the connective tissue of the whole platform:

| Anybody may raise | It lands in | Only they may |
|---|---|---|
| A maintenance issue | Maintenance, as an OPEN work order | assign, put on hold, complete, sign off |
| A hygiene concern | Hygiene, as a non-conformity | investigate, close with a corrective action |
| A request to buy something | Purchasing, as a requisition for their own unit | approve, order, receive |
| A request for staff | HR, as a hiring request for their own unit | approve, advertise, hire |
| A request about themselves | HR, as leave, a shift swap, a correction | decide |

Each already has a table. `hiring_requests` already carries
`department_id`, `job_role_id` and `headcount` — the "request staff from HR"
feature is modelled and simply unreachable from anywhere but Administration.

### Reporting a fault, in detail

This is the one the request describes most concretely, so it is specified most
concretely.

A reporter — any signed-in member of staff, from any department — submits:
a photograph or a short video, a description, the location, and the time.
Time and date are the server's, not the client's, for the same reason a
delivery temperature is: a self-reported timestamp on a fault that later
matters is not evidence.

It becomes a work order at `OPEN` with `source = 'REPORTED'`, which is why
that enum already has room for it. From there it follows the states the
module already has — `ON_HOLD` is literally "waiting for parts" — and the
reporter is told when it changes, which is the first thing in this platform
that genuinely needs the notifications in `PLAN.md` Phase 2.

**The new infrastructure this needs is media storage**, and it is the only
genuinely new infrastructure in this document: a Supabase Storage bucket per
organisation, row-level security on the objects mirroring the work order's
own, a hard cap on video length, and a retention policy. Photographs of a
fault are cheap and worth keeping; video is neither, and a venue that uploads
thirty-second clips of every dripping tap will fill a bucket and a bill.

### Maintenance buys its own things

Engineering's suppliers are not the kitchen's. The supplier table is already
shared and already correct — what is missing is a scope: a supplier belongs to
one or more business units, and a unit's ordering screens show its own.

The chain is unchanged and that is the point: engineering raises a requisition
against its own unit, it follows the same approval thresholds, becomes the
same purchase order, and lands in the same invoice matching. Finance sees one
spend picture. A separate engineering stores ledger is how a venue stops
knowing what it owns.

---

## 4. The dashboard hierarchy

Today `/` is a food-cost dashboard. That is the right dashboard for a chef and
the wrong one for an owner.

```
/                     Executive overview   — one tile per unit, exceptions first
/kitchen              Culinary             — today's `/`, unchanged
/bar                  Beverage
/housekeeping         (exists)
/maintenance          (exists)
/finance  /people  /marketing  …
```

**The executive overview is not a bigger version of the culinary dashboard.**
It answers one question per department and nothing else — the CEO reading of a
business, which is "where is something wrong today". Each tile shows one
headline number, one exception count, and a link.

| Unit | Headline | Exception |
|---|---|---|
| Culinary | Food cost % against target | Dishes off target |
| Beverage | Pour cost % | Lines due a clean |
| Housekeeping | Rooms sellable | Rooms held by engineering |
| Maintenance | PM compliance % | Statutory inspections late |
| Hygiene | Checks completed today | Breaches without a corrective action |
| People | Headcount against rota | Shifts unfilled tomorrow; certificates lapsing |
| Purchasing | Committed spend against budget | Invoices unmatched |
| Finance | Margin this period | Approvals waiting |

The rule that keeps it useful: **a tile earns its place by being able to go
red.** A number that is always green is a report, and reports belong inside
the department.

Each departmental dashboard is the same shape, scoped by unit — which the two
axis model in §2 gives for free.

---

## 5. The departments to add

Ordered by how much is already there.

### Bar / beverage — mostly exists, needs separating
A bar is a kitchen with different arithmetic. Recipes, costing, stock,
suppliers and the allergen registry all apply unchanged. What differs:

- **Pour cost rather than food cost**, and the reduced-VAT question from
  `PROGRESS.md` bites here first: in most EU member states restaurant food sits
  on a reduced rate and alcohol on the standard one, so a single rate is wrong
  for one of the two menus from day one.
- **Measures and yields**: a 700 ml bottle at 25 ml a measure is 28 pours, and
  the loss between 28 and what the till recorded is the whole of beverage
  control. This is the same variance calculation as theoretical-vs-actual
  usage in `PLAN.md` Phase 3, and it should be built once for both.
- **Licensing** as a certificate with an expiry, which the supplier-certificate
  machinery already does.

Not a new module. A unit scope, a second cost basis, and its own dashboard.

### Stewarding — small, and the missing link in hygiene
Dishwashing, chemicals, waste and pest control. It owns the machine
temperatures that the kitchen's HACCP file depends on and currently records
without owning: a final rinse below 82 °C is a stewarding fault with a kitchen
consequence. Needs: its own HACCP forms, its own chemical inventory (COSHH),
and the link that raises an engineering job when a machine fails a check.

### Finance — the real gap
Purchasing ends at a matched invoice. Nothing pays it, nothing posts it, and
nothing produces a margin. Needs: payment runs, a cost-centre P&L rolled up
from what already exists, and an export to an accounting package rather than a
general ledger of our own — `COMPETITIVE_ANALYSIS.md` already recommends
QuickBooks and Xero, and building a ledger to compete with them would be the
largest and least differentiated thing in this repository.

Owns, rather than shares: approval thresholds, tax rates, budgets.

### IT — a worked example of needing no new module
An IT asset is an asset; a broken laptop is a work order; a software
subscription is a supplier with a renewal date and a certificate-shaped
expiry. IT is a business unit with a scope on Maintenance and Purchasing, an
asset category, and its own supplier list. If the two-axis model is right, IT
costs nothing to add — and if it turns out to need a module, the model is
wrong. It is worth building as the test.

### Front office / reception — the PMS boundary
Where a hotel's occupancy would actually come from. Today housekeeping records
it by hand and says so. This is the department that either integrates with a
PMS or becomes one, and that is a strategic decision rather than a feature.
Until it is made, front office is arrivals and departures typed in, which is
what exists.

### Marketing — the smallest useful version
Menus with sections (already Phase 4 in `PLAN.md`), publication to channels,
promotions with a start and end date, and review monitoring. The part worth
having early is the one that ties back: a promotion has a cost, and menu
engineering already knows what each dish contributes.

### Also worth a unit, not a module
Security, spa and leisure, laundry, and — for a group — a Head Office unit
that is the parent of every venue's units and the reason the tree in §1 has a
`parent_id`.

---

## 6. Hygiene, expanded

Hygiene today is a kitchen file. It should be the venue's compliance spine,
and it is the module that touches every other department.

- **Forms scoped to a unit.** A form belongs to Kitchen, Bar, Housekeeping or
  Stewarding, and each unit's page leads with its own overdue list rather than
  everybody's.
- **Bar**: glass washer temperatures, ice machine cleaning, draught line
  cleaning dates, spirit measure calibration.
- **Housekeeping**: chemical COSHH sheets, linen handling, room sanitation
  after a reported illness.
- **Stewarding**: final rinse temperature, chemical dosing, waste segregation,
  pest control visits.
- **A failed check raises an engineering job automatically.** An ice machine
  above temperature is both a hygiene non-conformity and a maintenance fault,
  and today somebody has to remember to be both. The mechanism exists —
  `work_orders` with `source = 'INSPECTION'` — and this is the single highest
  value link in the whole document, because it is the one where forgetting has
  a consequence.
- **One compliance view across units**, which is what an inspector asks for
  and what nobody can currently produce.

---

## 7. One application, three sizes

A corner café must not open to twenty sections, and a hotel group must not be
told to use a restaurant app.

`app_sections` is already a table rather than an enum — 0036 chose that
deliberately — so the mechanism is nearly there. What it needs is an
`enabled` flag per organisation, set from a profile at sign-up:

| Profile | Units | Sections on |
|---|---|---|
| **Café / one operator** | one | Recipes, Inventory, Purchasing, Hygiene |
| **Restaurant** | Kitchen, Bar, FOH | the above, plus People, Menu, Production, Traceability |
| **Restaurant group** | per venue, under a head office | the above, plus Finance, Marketing, multi-venue roll-up |
| **Small hotel** | plus Housekeeping, Maintenance, Front office, Stewarding | everything |

The profile picks the starting set. It is not a licence tier and it is not a
one-way door: a café that opens a second site turns units on, and nothing
about its data has to move. Seeding runs through
`seed_organization_defaults()`, which already exists and already knows how to
be extended.

---

## 8. Order of work

1. **Business units.** Merge `departments` and `cost_centres`. Nothing below
   is honest until this is done.
2. **The unit axis on permissions**, and the scoped dashboards that fall out.
3. **Universal raise rights**, starting with reporting a fault — which needs
   media storage, and therefore is the first thing to need Supabase Storage.
4. **Notifications** (`PLAN.md` Phase 2), which the fault reporter makes
   unavoidable: a report nobody is told about is a suggestion box.
5. **Executive dashboard**, once there are units to roll up.
6. **Hygiene by unit**, and the failed-check-raises-a-job link.
7. **Bar**, as the first new unit, and the pour-cost variance shared with
   `PLAN.md` Phase 3.
8. **Finance**, then Stewarding, IT, Marketing, Front office.
9. **Venue profiles**, last, because it is a filter over a finished set and
   filtering an unfinished one hides the gaps.

## 9. Decisions this needs, which are not mine

- **Is the target a hotel platform or a food platform?** Front office and a
  PMS boundary are a different company from recipe costing. The answer changes
  §5 entirely.
- **Finance: export or own ledger?** Recommended: export. It is the largest
  build here and the least differentiated.
- **Does a group need cross-venue consolidation on day one**, or is a venue
  the unit of sale? This decides whether the unit tree has one root or many.
- **The reduced VAT rate**, still open from `PROGRESS.md`, and now blocking
  the bar rather than only the food menu.
