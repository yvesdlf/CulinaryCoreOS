# The platform: what this actually is

> Rewritten 2026-09-19 at `9efb06b`. The first version of this file asked
> whether the target was "a hotel platform or a food platform". That was the
> wrong question and it is withdrawn — see §2. This version starts from what
> the application has actually become.

## 1. Read the history before designing the future

Ninety commits, and a pattern that is not "someone decided to build a hotel
app". Every module here exists because **another module's rule needed a fact
it did not own**:

```
  costing a dish            needed a real price     ->  suppliers
  EU traceability           needed supplier + lot   ->  traceability
  buying something          needed an approval      ->  purchasing, and SoD
  segregation of duties     needed a second person  ->  membership, RBAC
  publishing a rota         needed certificates     ->  HR
  assigning a work order    needed the rota         ->  HR again
  a housekeeping sheet      needed rostered hours   ->  HR again
  releasing a room          needed the fault list   ->  maintenance
```

It started as kitchen costing and grew along the dependency graph of its own
controls. Nothing was added for completeness; each thing was added because a
rule could not be enforced without it.

That matters for what comes next, because it means the unit of design is not
a department and not a venue. It is a **fact, and the rules that read it**.

## 2. What the last version of this document got wrong

It proposed sorting organisations into venue profiles — café, restaurant,
group, small hotel — and asked which one the product was for.

That is a tiering model wearing an analysis costume, and it is wrong twice
over. It is wrong about customers: a beach club is a bar, a restaurant, a
retail shop and a facilities operation at once, and it would have to pick a
box that fits none of it. And it is wrong about the code: there is nothing in
this schema that is hotel-shaped or restaurant-shaped. `work_orders` does not
know what a hotel is. `rooms` is a location with a cleaning standard.

There are no venue types in this design. There are units and capabilities,
and the shape of the business is what they add up to.

## 3. The spine: eight facts everything reads

Underneath every module are eight nouns. Every department is a set of verbs
over some of them, plus a rule or two of its own.

| Fact | Owned by | Read by |
|---|---|---|
| A person | People | rota, work orders, cleaning sheets, approvals, training |
| A place | shared tree | rooms, assets, HACCP forms, cost allocation |
| A thing you buy | Purchasing | recipes, stock, spares, amenities |
| A thing you own | Maintenance | rooms, kitchen, IT, plant |
| A unit of money | Finance | every document with a cost |
| A numbered document | shared sequence | REQ→PR→PO→GRN→INV, WO, and whatever is next |
| A rule about who may act | Access + approvals | every write worth arguing about |
| A record that cannot be rewritten | ledgers | stock, approvals, status, rooms, meters |

The eighth is the one that makes the others trustworthy, and it is already
used five times. Nothing new here should be built without asking which of the
eight it is, and who else will read it.

**Today two of these are split in half and disagree with themselves.** The
department tree (HR) and the cost centre tree (money) are separate tables,
three of five departments have no cost centre, and one cost centre has no
department. So "what did the bar spend on staff" is not a hard query; it is an
unanswerable one. Merging them into one `business_units` table is the first
piece of work, and the riskiest migration in the project — thirteen tables of
foreign keys.

## 4. Capabilities and units, not tiers

An organisation is a **tree of units**. A unit is a place money is spent and
work is owned: a kitchen, a bar, a floor, an engineering shop, a whole venue,
a head office.

A **capability** is a set of verbs over the spine: costing, stock, buying,
people, assets, cleaning, compliance, selling.

An organisation turns on the capabilities its units need. Nobody chooses a
profile. A corner shop café is one unit with four capabilities on, and it is
not "café mode" — it is simply a small tree. A group is the same application
with sixty units and a head office above them. **The same code runs both, and
neither was configured to be what it is.**

The mechanism mostly exists: `app_sections` is a table rather than an enum,
which migration 0036 chose deliberately. It needs an `enabled` flag per
organisation and a sensible default, not a tier list.

## 5. A dashboard is the access grid, rendered

The request named CEO, CFO, HR director, executive chef. The temptation is to
design four dashboards, then six, then one per job title anybody invents.

Do not. **A role is a capability at a scope**, and that is exactly the two-axis
access model:

```
   capability  ×  scope        =  what you are accountable for
   FINANCE        enterprise   =  CFO
   FINANCE        one venue    =  venue finance manager
   PEOPLE         enterprise   =  HR director
   PEOPLE         kitchen      =  head chef doing their own rota
   CULINARY       enterprise   =  executive chef
   CULINARY       one venue    =  head chef
   everything     enterprise   =  CEO
   everything     one venue    =  general manager
```

So there is one dashboard, and it renders whatever the person's grid says.
A CEO tile and a GM tile are the same component at different scopes. This is
the difference between building seven dashboards and building one — and it is
why the unit axis in §3 has to come first.

Two rules keep it honest:

- **A tile earns its place by being able to go red.** A number that is always
  green is a report, and reports belong inside the department.
- **Every tile links to the thing it is about.** An exception count that
  cannot be opened is a complaint.

## 6. The two facts that stop every executive view from existing

This is the sharpest finding of the re-analysis, and it is not about
architecture.

**The application knows what things cost in extraordinary detail, and almost
nothing about money coming in or the cost of people.**

| | status |
|---|---|
| Hours worked | **exists** — `time_entries`, clocked in and out, corrections, approvals |
| A pay rate | **does not exist anywhere in the schema** |
| Dish revenue | partial — `sales_lines.net_sales`, only for imported POS periods |
| Unit revenue | **does not exist** — no takings per unit per day |
| Budgets | exists, per cost centre |

Labour cost is hours × rate. The hours are there, clocked and corrected and
argued over. There is no rate, so there is no labour cost, so there is no unit
profit and loss, so **the CEO tile and the CFO dashboard cannot be built** —
not for want of a design, but because the two numbers they are made of are not
in the database.

This is a bigger gap than anything in §8, and it should be closed before any
executive dashboard is drawn. What it needs:

- **Pay rates with effective dates**, in the restricted table beside the other
  personal data, with a rate history — because last month's payroll must stay
  computed at last month's rate, the same reasoning that already keeps last
  month's waste valued at last month's price.
- **Overtime and premium rules** as policy data, the way approval thresholds
  already are.
- **Revenue per unit per day**, from the POS, as a first-class fact rather
  than a menu-engineering import.

With those three, everything above becomes arithmetic over facts that exist.

## 7. How departments actually talk to each other

Four mechanisms, and they should be used in this order. The first is best
because it requires no message at all.

**1 — Share the fact.** Neither department sends anything; both read the same
row. A room cannot be released while a high-priority work order stands against
it, and no notification is involved. This is the strongest form of integration
and the one a separate product cannot reach.

**2 — Hand over a document.** One department raises it, another acts on it.
This is already the spine of the app and it is how a kitchen porter reports a
leaking tap: anybody may raise, only the owning department may close.

| Anybody may raise | Lands in | Only they may |
|---|---|---|
| A fault, with a photo and a place | Maintenance, as an OPEN work order | assign, hold, complete, sign off |
| A hygiene concern | Hygiene, as a non-conformity | close, with a corrective action |
| Something to buy | Purchasing, for their own unit | approve, order, receive |
| A request for staff | People, for their own unit | approve, advertise, hire |
| A request about themselves | People | decide |

`hiring_requests` already carries department, role and headcount — "request
staff from HR" is modelled and merely unreachable from anywhere but
Administration.

**3 — Tell somebody.** Events already exist: the communication cycle raises
them by trigger rather than from the pages, deliberately, so an import or a
future mobile client tells the same people. Nothing is delivered anywhere.
This is `PLAN.md` Phase 2 and the fault reporter makes it unavoidable — a
report nobody is told about is a suggestion box.

**4 — Escalate.** A document nobody acts on moves up the unit tree after a
defined time. This is the mechanism that stops mechanism 2 from becoming a
pile, and it does not exist.

**And one that is missing entirely: handover.** "Communicate through the app"
most literally means the shift-to-shift note — what broke, who is coming, what
the late table complained about, which room the guest is unhappy in. Today
there is nowhere to put it, so it lives in WhatsApp, which is exactly where
the app is trying to stop things living. It is small to build and it is
probably the most-used screen in the product.

## 8. The departments to add, as capabilities

Reframed from the last version: none of these is a venue type, and most are
not modules.

**Beverage.** A unit scope and a second cost basis, not a module. Recipes,
stock, suppliers and allergens apply unchanged. What differs: pour cost rather
than food cost; measures and yields (a 700 ml bottle at 25 ml is 28 pours, and
the gap between 28 and what the till says is the whole of beverage control —
the same variance calculation as theoretical-vs-actual usage in `PLAN.md`
Phase 3, and it should be built once for both); and licences as certificates
with expiries, which the supplier-certificate machinery already does.

**Stewarding.** Small, and the missing link in hygiene. It owns the machine
temperatures the kitchen's HACCP file already depends on without owning — a
final rinse below 82 °C is a stewarding fault with a kitchen consequence.

**Finance.** The real gap, and §6 is most of it. Beyond pay and revenue:
payment runs, unit P&L rolled up from facts that exist, and an export to an
accounting package rather than a ledger of our own. Building a general ledger
to compete with QuickBooks and Xero would be the largest and least
differentiated thing in this repository.

**IT.** Offered as the test of whether §4 is right. An IT asset is an asset, a
broken laptop is a work order, a subscription is a supplier with a renewal
date. If IT needs a module, the capability model is wrong.

**Front office.** Where occupancy would come from. Housekeeping records it by
hand today and says so on the page. This is the boundary with a property
management system, and it is a build-or-integrate decision rather than a
feature.

**Marketing.** Menus with sections (already Phase 4), publication, promotions
with a start and end, reviews. The part worth having early is the tie-back:
a promotion has a cost, and menu engineering already knows what each dish
contributes.

**Also units rather than modules:** security, spa, laundry, retail, events,
and a head office above the rest.

## 9. Hygiene, expanded

Hygiene is a kitchen file today and should be the venue's compliance spine —
it is the capability that touches every other department.

Forms scoped to a unit, so each page leads with its own overdue list. Bar:
glass washer temperatures, ice machine cleaning, line cleaning dates.
Housekeeping: chemical COSHH, linen handling, sanitation after a reported
illness. Stewarding: final rinse, dosing, waste segregation, pest control.

And the highest-value link in this document: **a failed check raises an
engineering job by itself.** An ice machine above temperature is both a
hygiene non-conformity and a maintenance fault, and today somebody has to
remember to be both. The mechanism exists — `work_orders` with
`source = 'INSPECTION'`. Forgetting currently has a consequence; this removes
the forgetting.

## 10. Order of work

1. **Business units.** One tree. Nothing else is honest until this is done.
2. **Pay rates and unit revenue.** §6. Without these there is no executive
   anything, and the design above would be drawn over a hole.
3. **The scope axis on access**, which makes roles and dashboards the same
   mechanism.
4. **Handover**, because it is small, it is used every day, and it is where
   the app currently loses to WhatsApp.
5. **Universal raise rights**, starting with the fault reporter — the first
   thing needing media storage.
6. **Notifications**, which the fault reporter makes unavoidable.
7. **The one dashboard**, rendered by grid, once there are units and money to
   put in it.
8. **Hygiene by unit**, and the failed-check-raises-a-job link.
9. **Beverage**, then Finance, Stewarding, IT, Marketing, Front office.

## 11. Decisions this needs

The venue-type question is withdrawn. What is genuinely open:

- **Pay rates in this system, or only hours out to a payroll provider?**
  Holding rates means holding the most sensitive data in the product and
  taking on payroll's compliance surface. Holding none means no labour cost
  and no unit P&L. A middle exists — rates for costing, payroll elsewhere —
  and it is probably the right one, but it is a decision.
- **Revenue: POS integration, or manual daily takings?** Integration is the
  right answer and needs naming a POS. Manual takings are a day's work and
  unblock everything in §6.
- **Is a venue the unit of sale, or is an enterprise?** This decides whether
  the unit tree has one root or many, and whether cross-venue consolidation is
  day-one or never.
- **Front office: integrate with a PMS, or become one?**
