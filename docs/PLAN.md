# The roadmap

> Written 2026-09-19 at `6ae2e6f`. This is the only ordering in the
> repository. `PROGRESS.md` says what exists, `PLATFORM.md` says what shape it
> should take, `UI_REVIEW.md` is an outside critique of the screens.
>
> Written to be read by whoever is paying for it, not only by whoever is
> building it. Where a technical name matters it is in brackets.
>
> Sizes are rough: **S** a day or two · **M** about a week · **L** two to
> four weeks. They assume one person working on it.

---

## Part A — Every gap, and how it gets closed

Thirty-four things. Nothing is hidden in here; if it is not on this list it is
either done or nobody has noticed it.

### A1 · Can we trust it to keep working? (Stage 0)

| # | What is wrong | What that means in practice | How it gets fixed |
|---|---|---|---|
| 1 | **About forty safety rules are never re-checked** | Rules like *you cannot approve your own purchase order*, *you cannot send an uncertified technician to a gas job*, *you cannot mark a room clean while engineering has it open*. Each was tested once, by hand. If somebody breaks one next month, nothing notices until it matters. | Turn each hand-test into an automatic one that runs on every change, alongside the 537 that already do. |
| 2 | Code style checker not installed | The command exists and fails, so it reports nothing and looks fine. | Install it. |
| 3 | **Never put online** | It runs on one laptop. No supplier, technician or manager outside the building has ever opened it. | Deploy it. The instructions exist and have never been run, so they are guesswork until they are. |
| 4 | Work sitting on a side branch | Seventeen commits are on a branch and an open pull request, not on the main line. | Merge it. |

### A2 · The structure underneath (Stage 1)

| # | What is wrong | What that means in practice | How it gets fixed |
|---|---|---|---|
| 5 | **Two separate lists of departments** | One list for staff, one for money, and they disagree — three departments have no money code, one money code has no department. So *"what did the bar spend on wages"* cannot be asked at all. | Merge them into one list of business units. Thirteen places refer to them, so it is done carefully and behind its own tests. |
| 6 | **Permissions are all-or-nothing** | You can give somebody access to "People", but not to "the kitchen's people". So a head chef either manages everybody's staff records or nobody's. | Add *which department* to each permission. Blank means all, so nothing anybody has today stops working. |
| 7 | **No standard way to add a department** | Adding Security or a bakery is a custom job every time. | Write the recipe once — see Part C. |
| 8 | One very large file | `repository.ts` is 4.627 lines, 9% of the front end. Not broken, but slow to work in and easy to break. | Split it by area. Mechanical, and the compiler catches mistakes. |

### A3 · Information the platform simply does not have (Stage 2)

| # | What is wrong | What that means in practice | How it gets fixed |
|---|---|---|---|
| 9 | **No pay rates** | Hours are recorded properly — clocked in, clocked out, corrections and all. There is nowhere to put a wage, so there is no labour cost, so there is no profit figure for anything. | Add rates with start dates, so last month stays calculated at last month's rate. **Needs your decision — D1.** |
| 10 | **No daily takings** | The platform knows what everything cost and nothing about what came in. | Either somebody types the day's takings, or it reads them from the till. **Needs your decision — D2.** |
| 11 | **No record of what the kitchen actually made** | So *what should have been used* cannot be compared with *what was used* — the number that finds over-portioning, waste and theft. Also blocks tracing a batch forward to the plate. | Record production against the prep list. One job, three problems solved. |
| 12 | **No photos or video anywhere** | A fault cannot be reported with a picture, waste cannot be evidenced, an inspection cannot be illustrated. | Add file storage, with the same privacy rules as the record it belongs to, and a cap on video length. |

### A4 · The platform cannot tell anybody anything (Stage 3)

| # | What is wrong | What that means in practice | How it gets fixed |
|---|---|---|---|
| 13 | **Nothing is ever sent to anyone** | An invitation is not emailed. An approver is never told there is something waiting. An order marked "sent" transmits nothing to the supplier. | The events are already generated internally — they just go nowhere. Build the part that actually sends, email first. |
| 14 | **No shift handover** | What broke, who is coming, which guest is unhappy — all of it lives in WhatsApp, which is exactly what this is meant to replace. | Build it. Small, and probably the most-used screen in the product. |
| 15 | **Nothing chases an ignored request** | A request nobody answers sits forever. | Escalate up the department tree after a set time. |
| 16 | WhatsApp, email and the AI assistant have never connected | All three are written and none has made a single real call. | Prove each against a live account. |

### A5 · Known faults and half-finished things (Stage 5)

| # | What is wrong | What that means in practice | How it gets fixed |
|---|---|---|---|
| 17 | **Live updating does not work** | A colleague's change does not appear on your screen until you reload. It was built, could not be made to work, and was removed rather than shipped broken. | Retry once it is online — the local setup is the remaining suspect. |
| 18 | Only six records keep a history | Stock, approvals, recipe status, rooms, work orders, meters. Everything else answers "what is it now", not "who changed this price". | Extend change history to the rest. |
| 19 | A two-step save that could half-fail | Recalculating everything is safe; the row that triggered it saves separately. | Make it one step. |
| 20 | No way to switch organisation | Somebody genuinely in two cannot choose. | Add the switcher. |
| 21 | US allergen list missing | The list is the EU fourteen. A US venue needs a different set. | Add it. |

### A6 · Things the platform cannot yet do (Stages 4–5)

| # | What is missing | What that means in practice | How it gets fixed |
|---|---|---|---|
| 22 | **Finance stops at a matched invoice** | Nothing pays it, nothing posts it, nothing produces a profit figure. | Payments, profit per department, and an export to an accounting package rather than building an accounting package. |
| 23 | **Bar has no pour cost** | A bottle is costed like an ingredient. The gap between 28 measures and what the till says is the whole of beverage control. | Add a second cost basis. Same calculation as #11, built once. |
| 24 | **Hygiene is kitchen-only** | The bar, housekeeping and stewarding have no forms of their own, though they all have legal obligations. | Scope forms per department, and make a failed check raise an engineering job by itself. |
| 25 | Only one stock location | A workshop store is not the kitchen store, so engineering spares cannot be held. | Add locations and transfers. |
| 26 | No menus as a thing | Dishes exist; a menu with sections, its own costing and its own allergen summary does not. | Build it. |
| 27 | Missing departments | Security, bakery, stewarding, IT, front office, marketing. | If Part C is right, these are data entry, not building. |
| 28 | Occupancy is typed in | Housekeeping is driven by who is arriving and leaving, and that normally comes from a booking system. | Decide whether to connect to one. **D4.** |
| 29 | No phone or tablet app | The shells exist and are empty. The first real need is scanning a QR code on a machine. | Build when #12 and #27 land. |

### A8 · From reviewing Q3 Aurelia (Singapore, operating in Indonesia)

A regional peer doing back-office finance, payments and integrations for
hotels and F&B. They overlap with this platform only at purchasing and
inventory; what follows is what they have that we do not, and what is worth
taking. Their allergen, food-safety, traceability, HR, maintenance and
housekeeping coverage is nil, which is where this platform's advantage sits
and where it should not be diluted.

| # | What is missing | Why it matters | How it gets fixed |
|---|---|---|---|
| 35 | **E-invoicing to the tax authority** | Not a feature — a legal requirement, and the one genuinely new obligation this review turned up. Malaysia's IRBM mandate is live, Singapore runs InvoiceNow on Peppol, Indonesia has e-Faktur. A platform that issues and receives invoices in this region has to file them. | Build against Peppol first, since Singapore and Malaysia both reach it, then country adapters. Stage 4, beside Finance. |
| 36 | **Revenue arrives from more than a till** | Their reporting consolidates POS *and* GrabFood, FoodPanda and Easi. In Indonesia a venue's takings are split across delivery platforms, and a revenue figure that only reads the till is wrong by whatever the aggregators took. | Gap 10 is widened: revenue by unit, by day, **by channel**. Changes the shape of the table, not the size of the job. |
| 37 | **The daily revenue report** | Revenue by outlet and meal period is the report a hospitality manager actually opens each morning. We have no equivalent. | Falls out of gap 36 once revenue carries a unit and a meal period. |
| 38 | **Fixed assets have no depreciation** | They keep a full fixed-asset register — depreciation, disposal, transfer, write-off. We have an asset register already, built for maintenance, carrying a purchase cost and doing nothing financial with it. | One asset, two readers: maintenance sees faults and downtime, finance sees book value. Cheap, because the register exists. Stage 4. |
| 39 | **No barcode scanning on a stock count** | They have it; we deferred it deliberately. A count sheet typed by hand is slower and wrong more often. | Comes with the phone app, gap 29. |
| 40 | **Single currency** | Fine for one venue, wrong for a group buying in two currencies. | With Finance, Stage 4. |
| 41 | **No standard chart of accounts** | Hotel finance runs on USALI, the uniform system for the lodging industry. Inventing our own account codes would make every export a translation exercise. | Align to USALI when Finance is built, rather than afterwards. |
| 42 | **Real-time stock across outlets** | They sell it as a headline. We cannot do it because of gap 5 and gap 6. | Already Stage 1. This confirms its priority rather than adding work. |

**What the review confirms rather than changes.** Their accounting product is
a full ledger — payables, receivables, general ledger, bank reconciliation,
trial balance. `COMPETITIVE_ANALYSIS.md` already recommends exporting to an
accounting package rather than building one, and seeing a competitor's ledger
up close does not change that: it is the largest and least differentiated
thing we could build. Their payments products confirm the same for payments.

**What it says about positioning.** They integrate with Oracle Opera and
Simphony as a first-class product. That is the market's answer to where
revenue and occupancy come from — decisions D2 and D4 — and it is worth
noticing that a company of their size treats integration as a product rather
than a feature.

### A7 · The screens (Stage 0.5)

| # | What is wrong | How it gets fixed |
|---|---|---|
| 30 | Sidebar is twenty items in one flat list | Group into six: Today, Culinary, Supply, Operations, People, System. |
| 31 | Two pages have far too many tabs | People has eleven, Purchasing six. Replace with a side menu inside the page. |
| 32 | Empty screens say one sentence | Explain what the screen is for, offer the action that fills it, show what it will look like. About fifteen of them. |
| 33 | No overview screen per role | An owner, a finance manager and a head chef all get the same food-cost page. | One screen that shows what *you* are responsible for — Stage 4. |
| 34 | Visual polish has drifted | Identical white cards, no hierarchy. The colours and shadows it needs are already defined and unused. | One deliberate pass, one commit. |
| 35b | **Service periods are not configured anywhere** | The top bar should say which service is running. It can only be guessed from the clock, and no venue has told the platform when its services run — printing "Dinner" at six because six is usually dinner is the guess this codebase refuses elsewhere. | A unit carries its service periods. Falls out of Stage 1. |
| 36b | **Covers are one browser's working figure** | The production page keeps expected covers in local storage, so they are personal rather than the venue's. Showing them in a shared header would present a private number as an agreed fact. | Covers become a shared record per unit per day, alongside revenue in Stage 2. |

---

## Part B — The stages

Each stage says what you can do at the end of it that you could not do before.

### Stage 0 · Make it safe to work on — **M**

- [x] Turn the forty hand-tested safety rules into automatic tests *(gap 1)* — 98 checks, in CI
- [x] Install the code style checker *(2)* — and fixed the 29 pieces of dead code and one impure render it found
- [x] Merge the outstanding branch *(4)*
- [ ] Put it online for real *(3)* — `vercel.json` landed and the build passes; the Supabase project and the two dashboard settings are the owner's to do

**You get:** confidence that nothing already built can break silently, and a
version other people can actually open. **Nothing here needs a decision.**

### Stage 0.5 · Make it feel like a product — **M**, runs alongside Stage 0

- [x] Group the sidebar *(30)*
- [x] Replace the two overloaded tab bars with side menus *(31)*
- [x] Rewrite the empty screens *(32)* — 25 of them, and zero one-line empty states remain
- [x] Add the date to the top bar — service and covers deliberately left out, see gaps 35b and 36b
- [x] Tables: avatars, status chips, a density toggle and headers that stay put
- [x] The visual pass — background, headers, spacing, shadows *(34)*

**You get:** something you would be comfortable demonstrating.
**Nothing here needs a decision.**

### Stage 1 · One list of departments, and who sees what — **L**

- [x] Merge the two department lists into one *(5)* — `business_units` is the
      department, the cost centre and the owner of a location. The old names are
      writable views and nothing was dropped; 0058.
- [x] Add "which department" to permissions *(6)* — one nullable column, null
      meaning every unit so no existing grant changed. Two grants stack and the
      wider one wins. A move between units needs standing in both, which is the
      escape the control suite found; 0062.
- [x] Write the add-a-department recipe *(7)* — Part C below, now a test rather
      than a claim: `12_department_contract.sql` adds Security as one row and
      exercises every bullet, and the Numbers tab has the form.
- [x] Split the oversized file *(8)* — six modules by area behind a barrel, so
      not one import site changed. 5.260 lines became 26; the largest piece is
      1.417. The exported surface is identical, checked by comparing the two
      lists rather than by trusting the compiler.

**You get:** the ability to say "this person manages the kitchen's staff and
nothing else", the ability to ask what any department spent on anything, and a
standard way to add the next one. **This is the riskiest work in the plan** and
is why Stage 0 comes first.

### Stage 2 · The missing numbers — **M**

- [x] Pay rates *(9)* — D1 answered by building the reversible middle: rates for
      costing only, append-only periods, and a rate already in force cannot be
      edited. Its own grant, held by nobody by default; 0064.
- [x] Daily takings *(10)* — D2 answered by building the manual path: per unit
      per day **per channel**, with gross and net kept apart because a figure
      that reads only the till is wrong by whatever the platforms took. Covers
      live here too, which closes gap 36b; 0065.
- [x] Production records *(11)* — what was made, append-only, with the quantity
      generated rather than stated and the consumption in the one stock ledger.
      Theoretical against actual works, and the forward step of Article 18 is
      answerable for the first time; 0060.
- [x] Photo and video storage *(12)* — one bucket, the parent record's own access, and wired into completing a work order. Retention is a column and a query; nothing sweeps it yet.

**You get:** profit per department, the used-versus-should-have-used figure,
and the ability to photograph a fault.

**What you do not yet get, said plainly:** `unit_labour_against_revenue` sets
labour against revenue per unit per day, and that is not a margin — cost of
goods is not in it. Calling it profit would be wrong by the entire food cost.
The platform knows that number; joining the three is a dashboard, and dashboards
are Stage 4.

### Stage 3 · The platform can talk — **L**

- [ ] Send things by email *(13)*
- [ ] One front door for reports — see Part C *(and 12)*
- [ ] Shift handover *(14)*
- [ ] Chase what nobody answers *(15)*
- [ ] Prove WhatsApp and the assistant against live accounts *(16)*

**You get:** an approver who knows there is something waiting, a supplier who
receives the order, a porter who can photograph a leaking tap and be told when
it is fixed, and handover that stops living in WhatsApp.

### Stage 4 · Dashboards, and departments as data — **M**

- [ ] The one overview screen, showing what you are responsible for *(33)*
- [ ] Hygiene per department, and failed checks raising jobs *(24)*
- [ ] Bar pour cost *(23)*
- [ ] Finance: payments and profit per department *(22)*
- [ ] Add Security, Stewarding, IT, Bakery **as data** *(27)*

**You get:** the owner's view, the finance view, the chef's view — all the same
screen, showing different things. And the proof that Part C works.

### Stage 5 · The long tail — ongoing

Multi-location stock *(25)* · menus *(26)* · change history everywhere *(18)* ·
live updating *(17)* · one-step save *(19)* · organisation switcher *(20)* ·
US allergens *(21)* · phone app *(29)* · booking-system connection *(28)*.

---

## Part C — How the platform is future-proofed

**The test:** adding Security, a bakery or a second café should be filling in a
form. If it needs a programmer, the design is wrong.

### What a new department gets automatically

One entry in the department list, and all of this works without code.

**This is no longer a claim.** `supabase/tests/12_department_contract.sql` adds
Security to the venue as one row — the same write the form makes — and then
tries to do each of these. There is no DDL anywhere in the file, so a bullet
that needed a migration fails there rather than being discovered by whoever is
adding department eight.

- [x] Its own code, its manager, and where it sits under another department
- [x] Its own budget and spending limits — it *is* the money code, not a copy of one
- [x] Its own document numbers — `WO-SEC-260919-001` for Security's first job today
- [x] Its people: rota, leave, attendance, certificates, training
- [x] The places it looks after, and every piece of equipment in them
- [x] Its own suppliers, and the full ordering chain through the same approvals
- [x] Its own compliance forms and its own list of what is overdue
- [ ] The ability to raise a request to any other department, and receive theirs
      — **two of five shapes.** It can raise a maintenance job and a
      requisition today. An incident, a complaint and a staff request have no
      shared route, which is the one front door in Stage 3.
- [ ] A tile on the overview screen — the overview is still per-section, not
      per-unit.
- [x] Permissions that can be limited to it

One thing the test found rather than confirmed: a work order with a unit and no
reference numbered itself `WO-SEC-`, and a requisition raised the same way
raised a not-null violation, because the purchasing screen allocated the number
and nothing else could. The capability was there and only one screen knew the
trick, which is a promise about that screen rather than about the platform.
0063 makes a requisition number itself the way a work order already did.

### The only three things that differ each time

**1. How it measures itself.** Food cost for a kitchen, pour cost for a bar,
cost per room cleaned, cost per patrol hour. One number over another, against a
target. Filled in, not built.

**2. Its own kind of paperwork.** A security incident, a bakery batch, a guest
complaint. This is the one that would otherwise mean building something new
every time — so it gets **one front door** instead.

The platform already has five things that are the same shape with different
names: a maintenance job, a hygiene breach, an HR case, a staff request, a
hiring request. Every one is *something happened, or somebody wants something →
send it to the right department → somebody owns it → close it with evidence.*

So: one place anybody can raise anything, with a photo, a place and a time,
and a rule that routes it. It does not replace what exists — Maintenance still
turns a fault report into a proper job with equipment and a schedule. It just
means every department shares the same front door.

**3. Its own checks.** Already just data — a venue uploads its own forms today.

### Tested against your three examples

| Department | What it needs | New code? |
|---|---|---|
| **Security** | A department, incident reports, patrol logs as forms, CCTV in the equipment list, a rota | **None** |
| **Bakery** | A department, batch recipes and production planning *(both already exist)*, its own hygiene forms, food cost | **None** |
| **Café** | A department. Or, if it is a separate business, its own account with one department | **None** |

If any of those turns out to need a migration, Part C is wrong — and it is
better to find that out at department three than at department eight.

---

## Part D — Decisions, and when they are actually needed

Nothing before Stage 2 needs any of these.

**D1 · Should the platform know what people are paid?** *(building the
middle option — 2026-10-03)*
Unanswered, so the reversible option is being built: rates held **for
calculating cost only**, with effective dates, in the restricted table beside
the other personal data. No payslips, no payments, no filing. If the answer
turns out to be "hours only", the table stays empty and nothing else breaks —
which is the property that made it safe to start.

**The original question**
Holding rates gives you labour cost and real profit per department. It also
means the most sensitive data you own sits in it. A middle option — rates used
only for calculating cost, with actual payroll staying wherever it is now —
gives the numbers without the platform becoming a payroll system.

**D2 · How does it learn the daily takings?** *(building the manual path
— 2026-10-03)*
Unanswered, so takings are being built as something somebody types, per unit
per day **per channel** — the channel because reviewing Q3 Aurelia showed
revenue arriving from delivery platforms as well as the till, and a figure that
reads only the till is wrong by whatever the aggregators took. A POS
integration later writes to the same table.

**The original question**
Somebody types them, which works within a day of building it. Or it reads them
from the till, which is better and needs the till system named. Starting with
typing loses nothing.

**D3 · One venue, or a group?** *(no longer blocking Stage 1 — 2026-10-03)*
Resolved by design rather than by answering it. A business unit is a **tree**
inside an organisation, so a single venue is a shallow tree and a group is a
head office with venues beneath it. Both shapes fit the same table.

What the answer would still change is narrower than it looked: whether two
venues must be separate **tenants** — separate organisations, with no shared
reads at all — which is a data-isolation question rather than a hierarchy one.
That can be answered after Stage 1 without rebuilding it.

Flagging the one case that would still hurt: if a group needs a single sign-in
that reaches several organisations, the organisation switcher in the backlog
becomes a prerequisite rather than a convenience.

**D4 · Housekeeping and the booking system.** *(Stage 5)*
Who is arriving and leaving normally comes from a booking system. Until one is
connected, occupancy is typed in and the screen says so.

**D5 · The reduced tax rate**, still unanswered, and now affecting the bar as
well as the food menu.

---

## Part E — Recommendation

**Continue with what is built.** The expensive part — the rules that stop
people doing the wrong thing — is correct, and three more bugs were found in
it this week by trying to break it. Starting again means finding all of those
again.

What is wrong is fixable without throwing anything away: two lists to merge,
permissions to narrow, numbers to add, one large file to split. None of it
requires rethinking the foundations.

**The one thing that would change that:** if the answer to D3 is "a group,
seeing every venue on one screen, from day one", then the very bottom layer is
built on the wrong assumption, and that is the single case where starting
again would be cheaper than correcting it.
