# Plan: what to build next

> Written 2026-09-19 at `294deca`. Companion to `PROGRESS.md`, which records
> what exists. This records what does not, in the order it should be built and
> with the reason for that order. Every item here traces to a gap named in
> `PROGRESS.md`, except the last two sections, which are new scope.

## The idea the order is based on

Most of what is missing is not missing for want of effort. Four things are
blocked behind one prerequisite each, and building the prerequisite collapses
several items at once:

| Prerequisite | What it unblocks |
|---|---|
| Production completion records | Theoretical-vs-actual usage (INV-FUNC-005), one-step-forward traceability (Art. 18), PM completion evidence |
| A second person in the organisation | The HR-case participant policy, and every segregation-of-duties test that needs two humans |
| One notification channel | Invitations, approval requests, sending a purchase order, proving the WhatsApp and email adapters |
| A deployed instance | Realtime sync, mobile, anything a supplier or a technician touches from outside the building |
| Multiple stock locations | Engineering spare parts, linen stores, anything EMS or housekeeping holds |

So the sequence below is not "easiest first". It is "unblocks the most, first".

---

## Phase 0 — Close what is already open

Small, and all of it removes a lie or a block rather than adding a feature.

- [ ] **Merge PR #1.** Thirteen commits sit on `chore/pr-workflow-and-docs`,
      CI green. `main` has not moved since 2026-08-11. Note that the workflow
      fires on `pull_request` and on pushes to `main` only — a branch pushed
      with no PR open is checked by nothing, so long-lived branches are a
      blind spot rather than a safe harbour.
- [ ] **Install eslint.** `pnpm lint` fails because it is not there. A lint
      script that cannot run is worse than no lint script: it reports green by
      never reporting.
- [ ] **Put a second person in the organisation.** One owner is why the
      participant-can-read path on an HR case is still untested, and it caps
      what any segregation-of-duties test can prove. A seeded non-owner member
      is a fixture, not a feature, and it unblocks a category of test.
- [ ] **Make one real assistant call.** Three providers are wired up and the
      allergen guardrail is tested, but no request has ever left the browser.
      One key, one call, one screenshot, and the claim becomes true.
- [ ] **Decide the reduced VAT rate.** Deliberately null. Most EU member
      states put restaurant food on a reduced rate and alcohol on the
      standard, so 21% is right for a drinks list and overstates every food
      line. This needs the member state, which needs the launch market — see
      the open questions at the end of `PROGRESS.md`.

## Phase 1 — Deploy it

Nothing below this line can be finished on a laptop.

- [ ] **Deploy.** `DEPLOY.md` has never been executed and is therefore
      fiction until it is. A hosted Supabase project and a static host for the
      web app.
- [ ] **Re-attempt realtime on the hosted instance.** The revert note lists
      three things already established: tables in the `supabase_realtime`
      publication, `replica identity full` so RLS can filter deletes, and
      `realtime.setAuth()` on the socket because it does not inherit the REST
      client's token. With all three done locally the channel subscribes and
      delivers nothing. The local realtime container is the remaining
      untested variable — hosted either reproduces it, which is a real bug
      worth filing upstream, or it does not, which means the diagnosis was the
      container all along.

## Phase 2 — Notifications

The largest single gap in the product: an invitation is not emailed, an
approver is never told, a purchase order marked "ordered" transmits nothing.

The leverage here is that **the events already exist**. The communication
cycle raises them by trigger rather than from the pages, so this is a worker
that drains a queue, not new event plumbing.

- [ ] **Pick one channel and finish it: email.** WhatsApp needs a Meta
      Business account, an approved template and an access token, none of
      which exist, and it will still need email underneath for anyone without
      WhatsApp. Email is the one that unblocks the most for the least.
- [ ] **Send a purchase order to its supplier**, with the vendor portal
      acknowledgement closing the loop that is already built and already
      proved in SQL.
- [ ] Then, and only then, revisit WhatsApp — the adapter is written and
      drains correctly in dry run; what it has never had is a network.

## Phase 3 — Production records

The keystone. One feature, three unblocked.

- [ ] **Log what was actually produced**: which preparation, what batch size,
      when, by whom, against which prep list.
- [ ] **Theoretical vs actual usage (INV-FUNC-005).** What the recipes say
      should have been consumed, against what the ledger says was. This is the
      number that finds theft, over-portioning and a mis-costed recipe, and it
      is the single most valuable report the system does not have.
- [ ] **One step forward (Regulation 178/2002 Art. 18).** Which service or
      batch consumed a lot. One step back is done; forward has always been
      blocked on exactly this.

Deliberately not included: scheduling with dates, cooks and equipment
conflicts (PRO-FUNC-002 proper), and kitchen display (PRO-FUNC-003). Both are
"Could Have" and need a calendar and realtime infrastructure that would dwarf
the module. Completion logging is the useful third of PRO-FUNC-002 and can be
had without either.

## Phase 4 — Menus

The rest of SRS Phase 6, and the last obvious hole in the core product.

- [ ] Menus with sections, menu-level costing, and menu allergen and nutrition
      summaries. Menu engineering already classifies dishes; there is still no
      object called a menu.

## Phase 5 — Engineering Maintenance System (EMS) — **built**

> Built on 2026-09-19 as migration 0055, ahead of the order below. The
> sequencing argument still stands and is worth keeping visible: a work order
> that notifies nobody is a paper form, so **Phase 2 is now the thing holding
> this module back**, not the other way round. What exists is proved in SQL;
> what it cannot yet do is tell anybody anything.
>
> Built: the location tree, asset register, work orders on the existing
> reference and approval machinery, the PM scheduler, meters, and the
> management views. Assignment is refused for an uncertified or absent
> technician; sign-off is refused for the person who did the work.
>
> Still not built, as planned: photographs, QR scanning, the Capacitor shell,
> and engineering stock — which still needs multi-location inventory first.

### Original reasoning

New scope. The reference point is [emshotels.net](https://emshotels.net) —
work orders, preventive maintenance, a digital logbook, asset management by QR
code, energy and utility monitoring, engineering stock and an AI assistant,
sold to Indonesian hotels, resorts and villas at 4.8M–12.5M IDR per year by
room count.

### Why this is a smaller job than it looks

Roughly two thirds of EMS is composition of things CCOS already has:

| EMS needs | CCOS already has |
|---|---|
| Work orders with approval and sign-off | Requisition machinery: per-unit daily reference numbering (`WO-KIT-260919-001` costs nothing to add), amount-based authority, and a trigger that refuses self-approval |
| Preventive maintenance schedules | HACCP control sheets — recurring forms that lead with what is overdue, require evidence, and refuse a recorded breach with no corrective action. A PM schedule is the same object with a different noun |
| Asset history that cannot be rewritten | The append-only ledger pattern, used three times already |
| Certificate and warranty expiry | Supplier certificates surfaced 30 days ahead |
| Technicians, their tickets and their hours | HR: employees, rota, attendance, and a competency matrix. Rostering already refuses somebody whose certification has lapsed — the same trigger refuses assigning a gas job to an unticketed technician |
| Utility cost allocation | The cost engine, decimal money, and cost centres |
| Contractors and parts suppliers | Suppliers as records, with terms and lead times |

### What is genuinely new

- **An asset register.** Modelled like products: identity, location, supplier,
  commissioning date, warranty, documents.
- **A general PM scheduler.** Generalising the HACCP form scheduler from
  "this venue's control sheets" to "anything with a due date and an owner".
- **Meter readings.** Electricity, water, LPG, fuel — the stock-movement
  ledger shape exactly: append-only, timestamped, attributed.
- **Photo storage.** Nothing in CCOS stores an image today; waste photo
  documentation was explicitly not built. Supabase Storage, with the same
  tenancy rules as everything else.
- **QR scanning, and therefore the mobile shell.** A technician scans a plant
  room asset on a phone. This is the first requirement that genuinely needs
  the Capacitor wrapper, which has been scaffolded and unbuilt since day one.
- **Engineering stock**, which needs **multiple stock locations and
  transfers** (INV-FUNC-006) — currently not built, and a hard prerequisite.
  A workshop store is not the kitchen store.

### Sequencing within EMS

1. Asset register and QR labels (web first — a printed label works before the
   scanner does).
2. Work orders on the existing reference and approval machinery.
3. PM scheduler, generalised out of the HACCP forms.
4. Meter readings and utility cost per cost centre.
5. Multi-location stock, then engineering stock on top of it.
6. Capacitor shell, camera, photos.

Steps 1–4 are worth having on their own and need no mobile app.

### The honest caveat

EMSHotels is a standalone product with 150+ properties. Building EMS inside
CCOS is a bet that one platform across kitchen, purchasing, HR and engineering
beats two good products with an integration between them. That bet is
reasonable — the shared spine is real: one supplier list, one employee record,
one cost centre, one approval rule — but it is a bet, and it should be made
deliberately rather than by drifting into it. A work order that notifies
nobody is a paper form, so **EMS should not start before Phase 2**.

## Phase 6 — Housekeeping — **built, against this plan's own advice**

> Built on 2026-09-19 as migration 0056. This section had recommended buying
> Flexkeeping rather than building, on the grounds that housekeeping runs on
> room status and room status comes from a PMS. That reasoning was not wrong
> and the gap it named is real: **occupancy in this module is recorded, not
> known.** Somebody types it, and every screen says how old the figure is.
>
> What building it bought, and what a purchased product could not have: a room
> cannot be released as clean while engineering has an open emergency or high
> priority job against it, and a sheet cannot exceed the attendant's rostered
> minutes. Both cross module boundaries that two separate products cannot
> reach across.
>
> The honest position: this is a good housekeeping module with no PMS behind
> it. If the venue runs one, an integration that sets occupancy is the single
> highest-value thing to add, and it is a project of its own.

### The market, as surveyed before building

Asked for: an application of the same kind, for housekeepers.

**It is not EMSHotels.** Their feature list is engineering only — work orders,
PM, assets, logbook, energy, engineering stock. There is no housekeeping,
room attendant, linen or lost-and-found module. The counterpart has to come
from somewhere else.

### The candidates

| Product | Shape | Fit |
|---|---|---|
| **[Flexkeeping](https://flexkeeping.com/products/housekeeping-software)** | Housekeeping, maintenance and staff collaboration suites in one platform. Automated room assignment, live room status, digital SOPs, multilingual, mobile, PMS integrations | The closest thing to "EMS, but for housekeeping". Its maintenance suite also overlaps EMSHotels, so it is a candidate to replace rather than sit beside it |
| **[Optii](https://hoteltechreport.com/compare/flexkeeping-housekeeping-vs-optii-housekeeping)** | Housekeeping optimisation and labour forecasting | Aimed at larger, more complex operations. Strongest where labour cost is the problem being solved |
| **[hotelkit](https://hoteltechreport.com/compare/flexkeeping-collaborations-vs-hotelkit-collaboration)** | Internal communication first, with housekeeping and facility modules around it | Most integrations (41). Good if the real complaint is that nobody knows anything |
| **[Quore](https://facilio.com/blog/best-hotel-facilities-management-software/)** | All-in-one engineering and operations | Built around US franchise brand standards; that is its strength and its limit |
| **[Xenia](https://www.xenia.team/hospitality-ops/housekeeping-room-turnover)** | Generic frontline operations, checklists and work orders | Cheapest and most general. Least hotel-shaped |

**Recommendation: Flexkeeping**, and evaluate it against EMSHotels rather than
alongside it. One platform covering both housekeeping and maintenance is worth
more than two, and the comparison is cheap to run — both offer trials.

### Why this one should be bought and EMS should be built

Housekeeping is driven by room status: who is arriving, who is departing, who
is staying over. That comes from a property management system.

**CCOS has no concept of a room, a reservation or a guest, and is not a PMS.**
A native housekeeping module would have to invent room inventory and then
integrate with whatever PMS the property runs, before writing a line of
housekeeping logic. EMS needs none of that — an asset, a work order and a
technician are all things CCOS can already describe.

That asymmetry was the argument: **build EMS, buy housekeeping.** The decision
taken was to build both. The PMS gap did not go away by building around it —
it moved from "a reason not to start" to "the one thing this module is missing",
which is a better place for it to be, and visible on the page rather than in a
plan nobody rereads.

---

## Carried, not scheduled

Real, understood, and not worth a phase of their own yet.

- **Organisation switcher.** The common case is right; a user genuinely in two
  organisations still cannot choose.
- **Field-level audit history.** Three ledgers are append-only. Everything
  else answers "what is it now" and not "who changed this price".
- **The cascade's own UPDATE is a separate request from the RPC.** The fan-out
  commits or does not; the row that triggered it is written separately, so a
  small window exists where one succeeded and the other did not.
- **US 9 allergen profile.** The registry is the EU 14. A venue under FDA
  rules needs a set that overlaps but is not a subset.
- **AI recipe import.** The provider abstraction now exists, so this is a
  prompt, a preview screen and the refusal-to-invent-products rule the sheet
  importer already enforces.
- **Written-answer marking** has schema and no screen.
- **The wider reporting suite**, and the **native shells** — the macOS Tauri
  wrapper has no requirement pulling on it the way EMS pulls on Capacitor.
