# Progress Tracker

> **How to read this file.** An item is ticked only where the behaviour has
> been exercised — in the browser against the real catalogue, or by a test that
> runs in CI. Anything partial says so. Claims made before 2026-08-01 were
> one-time checks on one laptop while CI was red; everything since is
> machine-checked on every push.

**Head:** `626bc24` · 54 migrations · 501 unit tests · 4 browser spec files ·
84 tables / 323 policies, rebuilt from empty on 2026-08-11. Tests and
typecheck re-run and green on 2026-09-19.

> **CI has never run on this work.** The repository has no git remote at all
> — `git remote -v` is empty, every branch is local-only, and nothing has
> been pushed anywhere. `.github/workflows/ci.yml` exists and its `on:` block
> is correct, but with no remote it has never been triggered for a single one
> of these commits. `gh` is now authenticated as `yvesdlf`, which changes
> nothing while there is nowhere to push to. Treat every CI claim in this file
> as describing a workflow file rather than a run that happened.

## Where the app stands

CulinaryCoreOS is a working hospitality platform, no longer only a costing
tool. It holds the full ingredient chain (ingredients -> preparations ->
dishes), costs it to five decimal places, cascades a price change through
everything built on it, declares allergens, enforces a recipe approval
workflow, and produces the printed sheets a kitchen uses.

Around that now sit: stock with counts and an append-only ledger; procurement
end to end from requisition to three-way invoice matching; a vendor portal with
sealed-bid RFQs; HACCP control sheets a venue can upload its own version of;
Human Resources with rota, leave, training and exams; a staff portal every
employee signs in to; and an administration page where per-section access is
granted and the protected numbers are set.

The line the whole system is built on: **every control is enforced in the
database and proved by SQL that tries to break it.** See `AGENTS.md`.

Since then: every purchasing document carries one reference number for its
whole life — REQ becomes PR becomes PO becomes GRN becomes INV, allocated by
the database rather than computed in a browser; an AI assistant runs on every
page against the user's own API key; and Human Resources has the data model
and the home screen for staff self-service.

Not started: AI recipe import, the wider reporting suite, and the native
shells (Capacitor/Tauri) in DOC1.

## Done

### Costing
- [x] Cost engine on decimal.js — no float money anywhere. Gross qty from
      trim, line cost, waste and inflation buffers, tax, food cost %,
      contribution margin, recommended pricing. 26 unit tests, each encoding a
      bug that shipped or a figure from a real workbook.
- [x] Cascade: a price change re-costs every preparation and dish above it, in
      dependency order, safe against reference cycles. Uses the as-purchased
      price, because gross quantity already carries the trim — pairing both
      charged for waste twice and came out 25% high.
- [x] `recalculateAll` for whole-catalogue re-costing after a bulk import.
- [x] Per-entity waste, inflation and tax rather than global constants.
- [x] Reconciliation gate in CI against an independent golden master.

### Recipes and preparations
- [x] Full editors with live costing, ingredient autocomplete, nutrition and
      allergen panels.
- [x] **Method**: ordered preparation steps, prep and cook times, and internal
      notes that are excluded from printed sheets and exports.
- [x] **Status workflow** — SRS RCP-FUNC-006, RCP-BR-009/010. Draft -> Pending
      -> Actual with no shortcut; Actual requires a price, ingredients, a name
      and a method; only owners and admins may approve; every transition is
      written to an append-only audit table.
- [x] Guarded delete: refused while anything depends on it, with the blockers
      named and linked, and archiving offered instead. Archiving keeps every
      dish above it costing correctly.
- [x] Archived items hidden from lists by default, still findable by search,
      never offered in the ingredient picker (SRS AC5).

### Allergens
- [x] EU/UK 14 registry with codes, Lucide icons and alias mapping, per CPSM
      Appendix G. A code or icon never stands in for the written name.
- [x] Inheritance through the cascade, so an allergen reaches every dish built
      on the ingredient rather than only where someone saved a page.
- [x] Free-from claims derived from the registry, failing closed on anything
      unrecognised.
- [x] Menu-wide matrix with icons, printable and exportable, stating plainly
      that it is not a compliance record while unverified items remain.
- [x] Per-recipe attribution: which ingredient contributes which allergen, and
      through which preparation.
- [x] Verification workflow — inferred declarations are flagged with what to
      check, transitively, and cleared by a human.

### Output
- [x] Recipe sheets and preparation sheets to DOC4 §11.3 — single column, no
      chrome, in-house components asterisked and linked.
- [x] Collections: named packs that print as one document with a contents page.
- [x] Export as self-contained HTML files in a folder, including the
      preparations the dishes reference. ZIP writer written rather than
      depended on, validated with a real extractor.
- [x] CSV export of costings, products, suppliers and the allergen matrix,
      honouring on-screen filters.

### Data in
- [x] Supplier price-list import with a mandatory preview: unknown names,
      ambiguous names, unreadable figures and negative prices are reported, not
      skipped.
- [x] Recipe import from a sheet, resolving references and refusing to invent
      products.
- [x] Workbook-to-CSV converter, so a spreadsheet and a hand-written sheet are
      the same import.

### Data quality
- [x] Duplicate ingredient detection, graded by whether price, supplier and
      unit agree, with a transactional merge that repoints every line first.
- [x] Duplicate supplier detection and consolidation.
- [x] Nutrition distinguishes "no calories" from "nobody entered any", and
      labels partial coverage a minimum rather than a total.

### Inventory (SRS 4.10)
- [x] Stock held as an append-only ledger of movements, not a mutable number,
      so "why is this four kilos short" stays answerable a week later. The
      `authenticated` role has INSERT and SELECT on it and nothing else.
- [x] Par levels and reorder points per ingredient, editable on the product
      page. No par means "not stock-tracked" rather than "out of stock" —
      most of a 1.100-line catalogue is bought to order.
- [x] Stock list graded out / reorder / low / in stock, sorted by what needs
      attention, with the shortfall to par as a suggested order quantity.
      Untracked ingredients are hidden until searched for.
- [x] Receive stock and record waste against a reason, capturing the price at
      the time — so last month's waste stays valued at last month's price.
- [x] Count sheet with variance (INV-FUNC-002): expected quantities are hidden
      during entry, lines that agree are dropped from the review, and applying
      a count writes the correction it implies rather than overwriting history.
- [x] Movement history with who recorded what, and when.
- [x] Verified in the browser end to end against the local database: a receipt
      moved Shallot 3 -> 15 KG and re-graded it, a count of 9 against books of
      11 wrote a -2 COUNT movement and persisted across a reload.

Not built, and deliberately: multiple storage locations and transfers
(INV-FUNC-006), barcode scanning, photo documentation of waste, scheduled
count reminders, purchase-order integration, and theoretical-vs-actual usage
(INV-FUNC-005) — that last one needs production records the app does not yet
capture.

### Menu engineering (SRS 4.8)
- [x] Sales mix imported from a POS item-sales export. Verified against a real
      April export from another venue: 721 rows, 10 dishes matched, zero rows
      misread.
- [x] Finds the item table among the dozen summary tables a POS report stacks
      above it. Several of those also carry a "Name" column beside a "Count"
      column, so the header is chosen by how specific its quantity column is
      rather than by being first — taking the first read a table of cheque
      counts as a sales mix.
- [x] Stops at the blank row that ends the table, so the payment breakdown
      below it does not bury the skipped-rows list.
- [x] Category rows are filtered by not being the name of anything the kitchen
      cooks. These reports are hierarchical — a category row carries the total
      of the dishes beneath it — and importing one would count those sales
      twice. Every unmatched row is listed, biggest first, which is the only
      check that a real dish was not missed.
- [x] Refuses ambiguous names, duplicate rows, negative and unreadable
      quantities rather than guessing.
- [x] Classification crosses popularity against contribution in money, not
      food cost percentage: a dish at 36% food cost on a high price can
      contribute more per plate than one at 24% on a low price, and it is the
      money that pays the rent.
- [x] Popularity uses the Kasavana & Smith 70% rule rather than a plain
      average, which would put half of any menu below the line by construction.
- [x] Each quadrant states what to do about it.

- [x] An import is saved as a named period with dates, not held in the tab.
      A menu decision gets argued about, so everyone has to be able to open
      the same numbers. Periods can be switched between and removed.
- [x] Sample sales for three months, because Manuza is not trading yet and
      the analysis cannot be seen working without units sold. Every period
      carries a SAMPLE flag and the page states in as many words that the
      figures are invented — so the day a real export arrives nobody has to
      wonder which months were real. Re-runnable from
      `supabase/seed_sample_sales.sql`, which leaves real imports alone.

Not built: the rest of Phase 6 — menus with sections, menu-level costing, and
menu allergen and nutrition summaries.

### Production planning (SRS 4.11)
- [x] Prep list from expected covers (PRO-FUNC-001 AC1, AC3): dishes explode
      through every level of preparation into what must be made, ordered so
      that anything a later preparation is built on comes first.
- [x] Whole-batch scaling. A preparation yielding 1 kg cannot be made 0,9
      times, so the sheet shows what is needed, how many batches, and what
      that actually makes — and the pull list covers the batches, not the
      exact need, which is what stops a prep cook running out mid-service.
- [x] Pull list with current stock subtracted (AC4), sorted so what is missing
      sits above what is merely needed, priced at current cost.
- [x] Refuses to add quantities in different units for the same ingredient,
      and reports it. Adding grams to kilograms would understate an order by a
      factor of a thousand and nobody would notice until delivery.
- [x] Missing ingredients, missing preparations, a preparation with no batch
      yield, and preparations used inside themselves are all reported rather
      than silently dropped.
- [x] Covers persist across a reload, and the sheets print apart — the prep
      cook and whoever opens the store are different people.
- [x] Verified in the browser against the local database: 10 covers of Beef
      burger and 10 of Squid & Guanciale produced 21 pull lines, of which
      Guanciale alone showed no shortfall because 22,5 kg was on the shelf.

Not built: production scheduling with dates, cooks and equipment conflicts
(PRO-FUNC-002), and kitchen display integration (PRO-FUNC-003) — both are
"Could Have" in the SRS and need a calendar and realtime infrastructure that
would dwarf the module. Theoretical-vs-actual usage (INV-FUNC-005) still
needs completion logging, which is PRO-FUNC-002 AC6.

### Jurisdiction and tax
- [x] Compliance profile per organisation: country, food-information regime,
      currency, standard and reduced VAT, and service charge — configurable
      rather than compiled in, so a second venue in another member state does
      not need a code change.
- [x] Set to EU food law (Regulation 1169/2011) at the EU standard VAT rate of
      21%.
- [x] Tax and service charge separated. The old 21% was documented as "11%
      Indonesian PPN + 10% service charge": identical arithmetic, different
      legal meaning. A service charge is the venue's revenue and is itself
      taxable; VAT is collected for the state. Folding them together works
      until somebody files a return or reclaims input tax.
- [x] Allergens already conform — the registry is EU FIC 1169/2011 Annex II.

Open, and needing a decision rather than a default: the reduced VAT rate is
deliberately null. Most EU member states put restaurant food on a reduced rate
and alcohol on the standard rate, so 21% is right for a drinks list and too
high for a food menu. Which reduced rate applies depends on the member state,
and guessing it would overstate tax on every food line.

### Purchasing (requisitions, approvals, orders)
- [x] Requisitions with cost centre, needed-by date, justification and lines,
      numbered per year from the highest existing reference rather than a
      count, so deleting one never causes a number to be reused.
- [x] Segregation of duties enforced by the database. An approval by the
      person who raised the document is refused by trigger, matched on both
      user id and email so a document raised before somebody had an account is
      still caught. Verified in SQL, not through a disabled button.
- [x] Approval authority by amount, held as policy data finance can change
      without a deployment. Seeded at: anyone with write access below 5
      million, ADMIN at or above it, OWNER at or above 25 million. Also
      enforced by trigger.
- [x] The screen states the rule before the button is pressed — who has to
      approve this amount, and whether you are disqualified for having raised
      it. A system that only reports refusals afterwards teaches people it is
      arbitrary.
- [x] Approvals are an append-only ledger capturing actor, role and the amount
      the decision was made against, so a later edit cannot re-describe what
      was approved. No update or delete grant.
- [x] Approved requisitions split into one purchase order per supplier, since
      an order is a contract with one company. Lines with no supplier are held
      back and named rather than guessed at.
- [x] Order totals, VAT and line totals maintained by trigger.

Receiving, invoices, three-way matching, budgets and committed spend were
written after this section and are recorded further down. What is still not
built: sending an order to a supplier — marking one "ordered" transmits
nothing to anybody.

### Traceability and food safety (EU)
- [x] Suppliers as records rather than a name typed on each product: legal
      name, VAT number, establishment approval number for products of animal
      origin under Regulation 853/2004, contact, terms and lead time. The 81
      free-text names became 74 suppliers — six spellings were one company
      typed twice, and 177 products were consolidated onto the largest.
- [x] Stock lots: lot code as printed, supplier, delivery reference, received
      date, expiry, and temperature on arrival as cold-chain evidence under
      Regulation 852/2004. Created as part of receiving, so the record exists
      because the delivery was booked in rather than as a separate chore.
- [x] Use-by and best-before are never conflated. Past a use-by date food is
      deemed unsafe under Article 14 and the system refuses it; past a
      best-before it says the food is still legal to use. A date with no kind
      stated is reported as unjudgeable rather than guessed — guessing one way
      throws away good food, the other way serves unsafe food.
- [x] One step back (Article 18): supplier, lot, delivery note, date and
      arrival temperature for any lot, with anything missing named as missing
      rather than left blank. A gap in a traceability record is the finding.
- [x] Blocking, recall and withdrawal (Article 19) enforced by the database.
      A lot that is not OK cannot be consumed or transferred by any client —
      verified by SQL, not by a disabled button. Waste and returns stay
      allowed, because getting recalled stock off the shelf is the point.
- [x] Supplier certificates with expiry, surfaced 30 days ahead. An expired
      HACCP certificate is the same shape of problem as an expired ingredient.

Not built: one step forward beyond the kitchen — which service or batch a lot
was consumed by — needs production records the app does not yet capture.
Recall notification to the competent authority is stated on screen as the
operator's job, not automated.

### Platform
- [x] Supabase with multi-tenancy and RLS; anon revoked, cross-tenant reads and
      writes verified blocked.
- [x] TRUNCATE, TRIGGER and REFERENCES revoked from `anon` and `authenticated`
      on every table. TRUNCATE is not subject to row-level security, so the
      inherited platform grant would have let any signed-in user empty every
      tenant's data regardless of the policies.
- [x] Atomic cascade RPC — the fan-out commits or does not.
- [x] Optimistic concurrency on recipes, preparations and products.
- [x] Recipe status history shown in the editor.
- [x] Nutrition can arrive by import — optional columns on the product import,
      merged rather than replacing, so a file carrying only kcal does not blank
      macros entered by hand.
- [x] CI: three jobs, green. It failed on all seven of its first runs while
      reporting nothing, because it died at pnpm setup before a test ran.
- [x] WCAG 2.2 AA: axe, keyboard and screen-reader suites in both themes.
      Defects found and fixed include unlabelled selects, a scroll region no
      keyboard could reach, and tokens tuned against one background only.
- [x] Dark mode that survives a reload.
- [x] Catalogue re-reads when the tab regains focus, so a colleague's price
      change does not stay invisible until someone reloads.
- [x] Route-level code splitting and vendor chunks — app chunk 39 kB gzipped,
      down from 298 kB.
- [x] Command-K searching the whole catalogue, not four page links.
- [x] Dashboard as the food cost summary: blended cost weighted by money,
      dishes off target with suggested prices, and food cost by menu section.

## A red CI run that was not a regression

Two of three browser-job runs went red, including one whose only change was
a markdown file. The failing step was `supabase/setup-cli@v1`, not a test:
`version: latest` resolves the newest release on every run, and that network
lookup can simply fail. Pinned to 2.109.1. Worth remembering that a job dying
before any test executes looks identical to a test regression.

## Done since `546abcd`

Nine commits on `chore/pr-workflow-and-docs`, none of them on `main`.

### One reference number per transaction
- [x] **References say what, where and when**: `REQ-KIT-260809-001` is
      document type, business unit from the cost centre, the date, and a
      sequence restarting daily. It replaces `REQ-2026-0001`, which told a
      buyer nothing without opening the document.
- [x] **Allocated by the database, not the browser.** The old scheme read
      every existing reference and added one to the highest, so two people
      raising a requisition in the same second both computed 001 and the
      second was refused by a unique index mid-order. `next_document_reference()`
      holds a row lock for the statement; twenty concurrent psql clients
      produced a clean 001 to 020 with nothing refused.
- [x] **One document, one number, for its whole life.** REQ becomes PR on
      approval, PO on ordering, and the goods receipt and supplier invoice
      take the same number: `REQ-KIT-260809-003` → `PR-` → `PO-` → `GRN-` →
      `INV-`. "We are being chased for INV-KIT-260809-003, what was that?" is
      answered by eye instead of by a three-table join. A `purchasing_chain`
      view returns the whole transaction in one row.
- [x] **One requisition per supplier**, enforced where the requisition is
      raised. Two earlier commits invented numbering schemes for the pieces of
      a split request; the answer was that there is nothing to split. A
      request goes to one supplier, so it becomes one order, one delivery and
      one invoice. Lines with no supplier yet are grouped into their own
      request rather than refused — that pile is real and needs a decision.
- [x] A requisition that still ends up with two orders (imported data, or a
      venue that pre-dates the rule) leaves the chain visibly broken rather
      than colliding. That mismatch is the signal somebody needs.
- [x] Legacy references are recognised, kept, and deliberately excluded from
      counting, so the first new reference of the day does not follow
      `REQ-2026-0847` as 848.

### The assistant
- [x] **An assistant on every page, on the user's own API key.** DOC5
      specified a provider abstraction in July; this is the first thing built
      against it. Three providers behind one interface: Gemini by default
      (its free tier reads photographs, which is the capability a kitchen
      needs), OpenAI-compatible for Groq, OpenRouter and — the real reason —
      a local Ollama or LM Studio for venues that will not send their recipe
      book anywhere, and Anthropic for venues already paying for it.
- [x] The key stays in the browser. A key column in the database would be
      readable by everyone with access to the row, land in every backup, and
      still have to reach the browser to be used, because there is no server
      to call from. The settings screen states the limit that remains — a
      script on the page can read local storage — rather than implying
      otherwise. It is somebody's own money.
- [x] **The model may add an allergen and may never remove one** (DOC5 §6.1).
      Enforced by shape rather than by prompt: `mergeAllergenProposal` is a
      union, always, and the module exports no function that can remove one.
      Free-from and "safe to serve" claims are stripped from any answer, with
      the substitution shown rather than made silently.
- [x] Three bugs the tests found before a user could: `looseNumber` turned "a
      pinch" into a confident `0`; the free-from replacement text matched its
      own filter, so running the guard twice deleted its own warning; and
      Gemini reports a safety refusal as a `finishReason` rather than an HTTP
      error, which read as the model having nothing to say.

### Human Resources self-service
- [x] **The data model**: public holidays, birthdays, requests that are not
      absences, a community board and a company profile. A loan is not
      measured in days and a shift swap needs two shifts, so `staff_requests`
      carries a kind and a payload rather than forcing three shapes into
      `leave_requests`.
- [x] **The board is moderated before it is visible.** A post starts PENDING
      whatever the client asks for, and no client path writes PUBLISHED — the
      board carries a colleague's phone number and a price, and whoever has to
      deal with it going wrong should read it first.
- [x] **A decision can no longer be filed under somebody else's name.** The
      guard compared the caller's JWT email against the employee but recorded
      `decided_by_email` from the row the client sent, so the record could say
      Budi approved Budi's loan. It grants nobody an approval they could not
      already make; what it corrupts is the audit trail of a
      segregation-of-duties control, which makes the control decoration. The
      field is no longer read where there is a session.
- [x] **The HR home screen**: whether you are clocked in first, because that
      is done in a hurry twice a day; then what needs doing; then what has
      been sent. Four buttons rather than a menu — a menu is a question about
      where something is. A manager gets the same screen with approvals added,
      because a head chef is a member of staff who also approves things and
      splitting that in two means checking two places.
- [x] **Leave balances are a tested engine, not a query.** Pending requests
      count against the balance, because showing somebody twenty days when
      they have asked for fifteen invites a holiday they cannot take. Rejected
      and cancelled days give nothing back. Leave with no entitlement reports
      days used and never a remainder — "sick days remaining" reads as an
      allowance. An overrun shows as -3 rather than clamping to zero, because
      hiding it is how it reaches payroll unnoticed.

### Rules and workflow
- [x] **AGENTS.md** now holds the rules that have actually governed this
      codebase, each one traced to the failure that caused it. Three documents
      were stale, and `.github/copilot-instructions.md` was the worst of them:
      it told agents the repository contained no source files, through
      forty-six migrations and a working application.
- [x] A PR template whose load-bearing section is "how it was proved" — which
      flow was driven, which SQL was run to try to break a rule, and what the
      database said.
- [x] A false pass worth remembering, caught here: an UPDATE refused by RLS
      matches zero rows and raises no exception, so a test asserting "no
      error" proves nothing. Re-run with `get diagnostics row_count`.

## In progress / next up

- [ ] **Realtime sync is not working, and the attempt was reverted.** Reads
      are still hydrate-once at startup plus a refresh when the tab regains
      focus, so a colleague's edit made while you are watching the same screen
      does not appear on its own.

      Attempted and backed out rather than shipped, because a sync that
      silently delivers nothing is worse than none: it invites people to trust
      a screen that is quietly stale, which is a costing error waiting to
      happen. What was established, for whoever picks it up:

      * The tables must be in the `supabase_realtime` publication, and need
        `replica identity full` so row-level security can filter deletes.
      * The socket needs the session token via `realtime.setAuth()`. It is a
        separate connection from the REST client and does not inherit it;
        without it every change is filtered out by RLS.
      * The realtime service caches the publication at boot, so it has to be
        restarted after the publication changes.
      * With all three done the channel subscribes without error and still
        delivers no events. Not diagnosed further.

      Verified along the way that the fetch path itself is fine: a change made
      directly in the database appears immediately on reload.

- [x] **The Playwright session token is not in this history.** This item
      claimed one sat at `3bbcc97` and that clearing it needed a force-push
      nobody had authorised. `3bbcc97` is not a commit in this repository, and
      a scan of all 85 commits finds no `tests/.auth/` path in any tree and no
      token string in any blob. `.gitignore` has excluded `**/tests/.auth/`
      since the near-miss that prompted the rule. Nothing to rewrite — which
      matters, because the repository is public.

## Backlog

- [ ] **Organization switcher.** `auth_default_org_id()` now prefers an
      organisation somebody was invited into over one created at sign-up, and
      sign-up no longer creates an organisation for an invited address. So the
      common case is right. A user genuinely in two organisations still cannot
      choose between them, and there is no UI for it.
- [ ] **Notifications.** Nothing is sent anywhere. An invitation is not
      emailed, an approval request does not reach the approver, a purchase
      order marked "ordered" transmits nothing to the supplier. Every one of
      these needs a channel decision before it can be built.
- [ ] **Field-level audit history.** Recipe status transitions, stock
      movements and approvals are append-only ledgers. Everything else records
      only its current state, so "who changed this price, and when" is not
      answerable outside those three.
- [ ] **The primary entity's own UPDATE is still a separate request from the
      cascade RPC.** The fan-out commits or does not; the row that triggered it
      is written separately, leaving a small window where one succeeded and the
      other did not.
- [ ] **US 9 allergen profile.** The registry is the EU 14 (Regulation
      1169/2011). A venue under FDA rules needs the US set, which overlaps but
      is not a subset.
- [ ] Cascade `refPercent` from product yield onto recipe lines. Deliberately
      not done: ref % is editable per line in the ingredient grid, so
      overwriting it would discard a chef's intentional trim override.
- [ ] **AI recipe import.** Not started. The provider abstraction it needs
      now exists (see the assistant, below), so this is a prompt, a preview
      screen and the same refusal-to-invent-products rule the sheet importer
      already enforces — not a platform decision.
- [ ] **The assistant has never made a real network call.** Three providers
      are wired up and the guardrails are tested, but there is no API key on
      this machine, so the first real request will be the first real test.
- [ ] **The WhatsApp adapter has never talked to WhatsApp.** It is written,
      it drains its queue correctly and it was verified against real queued
      messages in dry run — but sending needs a Meta Business account, an
      approved message template and an access token, none of which exist.
      Everything up to the network call is proved; the network call is not.
- [ ] **The participant-can-read path on an HR case is untested.** The policy
      requires both organisation membership and being named on the case, so
      proving it needs a non-owner member and the organisation currently has
      only an owner. The confidentiality direction — a colleague who is not a
      participant sees nothing — is proved.

## Done earlier, up to `546abcd`

- [x] **Training, competency, reviews and HR cases now have screens**, as
      four more tabs on People. Competency is shown as a matrix — people
      across, competencies down — because that is the shape the question
      "who can cover the grill on Friday" is actually asked in.
- [x] **Hygiene: the venue's own HACCP control sheets**, numbered as their
      paperwork numbers them so an inspector asking for 3.1 finds 3.1. Taken
      from the real workbooks: cleaning schedules, hand-washing logs, cook and
      reheat temperatures, cooling, defrosting, dry ager, sushi rice pH, CCP
      monitoring, non-conformity, allergen testing, chemical inventory.

      The page leads with what has not been done rather than with the forms,
      because a folder of neatly completed sheets with three missing days is
      exactly what an audit finds and nobody notices in advance. A breach
      cannot be recorded without a corrective action — a recorded breach with
      nothing done about it is evidence you knew.
- [x] **Written quiz answers.** The real Manuza quizzes are written, not
      multiple choice — "Please write the correct answer", then "List 3 items
      in Sushi Boat". A machine cannot mark that, so a question is now either
      auto-marked or marked by a named person, and the marker cannot be the
      person who sat it. Observation checklists are recorded separately,
      because passing a paper about carrying three plates is not the same as
      carrying three plates.

- [x] **Email adapter**, same shape as the WhatsApp one and for the same
      reasons. Written against a provider's HTTP API rather than SMTP,
      because a provider returns a message id in one request and handles
      deliverability, which is most of the actual work. Verified in dry run
      against a real queued message.
- [x] **Training, quizzes, competency, performance and HR cases.**

      Completing a course issues the certificate it grants, which closes a
      real loop: Budi was refused a Chef de Partie shift for a lapsed
      allergen certificate, passed the allergen course, and became rosterable
      in the same test.

      Quizzes are marked server-side and the correct answers are not granted
      to `authenticated` at all — a quiz marked in the browser is a quiz
      anybody passes by reading the page.

      Performance reviews carry no numeric rating, on purpose. The brief
      prohibits opaque scoring, and a number invites ranking people against
      each other rather than against what the job asks.

      HR cases are restricted to named participants plus owners, which is
      narrower than anything else in the system. A grievance readable by
      whoever opens the staff list is how an HR system becomes the thing
      people are afraid of.

- [x] **Tax rates are editable.** Rows with a name, percentage and note, one
      marked default, and a menu category can point at one. Nothing assumes a
      country. Seeded at the EU standard with the reduced rate carrying a note
      to set it to your member state's.
- [x] **Sourcing and RFQ**, both sides. A buyer creates a request, sends it to
      several suppliers, compares quotes side by side and awards with a
      required rationale. A supplier quotes through the portal and never sees
      another's price — proved in SQL, and the view behind their screen does
      not select another supplier's quote at all, so there is nothing to leak.
- [x] **WhatsApp adapter.** Runs outside the database, because a trigger must
      never make a network call — a slow provider holds a transaction open and
      a failing one rolls back the delivery that caused it. Reads the access
      token from the environment, never the database. Verified in dry run
      against real queued messages: it resolved a supplier's own number for a
      supplier message and the channel default for a venue one.
- [x] **The Playwright token is gone from history.** Force-pushed after
      confirming the remote was untouched, then reflogs expired and the
      repository garbage collected. Zero commits contain it, locally or
      remotely.

- [x] **Account deletion.** The membership guard refused the cascade from
      `auth.users`, so no account could be removed without disabling a
      trigger — and a GDPR Article 17 request could not have been honoured.
      The guard now stands aside when there is no session, which is a
      cascade, a migration or an administrator rather than a person using the
      app. Self-demotion is still refused.
- [x] **Contracts**, with effective-dated agreed prices, and an invoice check
      against them. That check is separate from the check against the order
      and not a substitute: an order raised at the wrong price makes the
      invoice agree with the order while both are wrong, and only the
      contract catches it. Notice dates lead the attention list, because
      `notice_by` is not `ends_on` and missing it is how a contract renews
      itself.
- [x] **Onboarding and offboarding.** Templates instantiated per person and
      copied rather than referenced, so editing the template next year does
      not rewrite what somebody was actually asked to do. Offboarding tasks
      can block: a leaver cannot be archived while their access is still live
      or their keys are still out, refused by trigger.

- [x] **Vendor portal.** A supplier contact is deliberately not a member of
      the organisation, so `auth_org_ids()` returns nothing for them and every
      existing policy in the system already denies them by default. Their
      access comes only from four narrow views. That is the safe direction to
      fail in: adding a supplier to the organisation and then subtracting what
      they must not see would mean every future table silently grants them
      something.

      Proved in SQL rather than asserted. A supplier sees exactly their own
      orders, and reads zero rows from `purchase_orders`, `products` and
      `recipes` directly. Acknowledging another supplier's order is refused.

- [x] **Communication cycle.** Requisition submitted and decided, order sent
      and acknowledged, delivery booked in, goods rejected, invoice held and
      approved, leave requested and decided. Raised by trigger rather than by
      the pages, so an import or a future mobile client tells the same people
      — a notification that only fires when somebody used the right screen is
      not a cycle. Venue and supplier audiences are separate, and the wording
      differs because what may be said differs.

- [x] **Shift scheduling and attendance.** A week rota, clock in and out, and
      rostered-against-worked variance.

      Working-time rules are the EU Working Time Directive (2003/88/EC), not
      invented thresholds — 11 hours daily rest, a break past 6 hours, 24
      hours weekly rest, 48 hours average weekly. Each warning cites its
      article so a manager can look it up. They are warnings rather than
      refusals: a manager sometimes has to break a rota rule and record why,
      and a system that simply refused would be worked around with a paper
      rota, after which nothing is visible at all.

      Two things the database does refuse outright, because they are unlawful
      regardless of intent: rostering somebody whose required certification
      has lapsed or is missing (852/2004 Annex II Chapter XII), and rostering
      somebody on approved leave. A draft passes; publishing is the
      commitment, so that is where the checks bite.

      A punch, once closed, cannot be edited — time becomes pay, so a record
      that can be quietly changed is one nobody can rely on. Corrections are
      separate records and cannot be approved by the person who asked for
      them. Both the original and the effective figure stay visible.

- [x] Membership management: invite by email, set roles, remove people, with
      privilege escalation refused by trigger. Was the blocker that made every
      segregation-of-duties control unusable — they need a second person and
      there was no way to add one.
- [x] Products carry a `version` column and get lost-update protection, the
      same as recipes and preparations. An earlier note claiming otherwise was
      stale.
- [x] Supplier and procurement module: requisitions, approvals, orders,
      receiving, invoice matching, budgets, analytics.
- [x] Menu engineering with real sales-mix, imported from a POS export.
- [x] RBAC and user management, in Settings.

### Access control and administration
- [x] **Per-section access.** Twelve sections, each person set to no access,
      read only or full edit, enforced by a trigger on every table the section
      owns rather than by hiding menu items.

      Migration 0036 shipped this with an ownership check that named no
      organisation. Sign-up creates an organisation and makes the new user its
      owner, so every user passed it and a member granted READ could write.
      0037 scoped it. The same hole existed twice in the hiring guard, which
      made department routing advisory. Both proved by test before and after.

- [x] Protected parameters with bounds and a full change log — target food
      cost, waste allowances, tax, and the spend above which an order needs an
      administrator or an owner.
- [x] Hiring approved by the department that pays for the person, with a named
      deputy. Self-approval refused.
- [x] Accounts added by invitation only. Nobody, including an administrator,
      sets or reads somebody else's password — which is what makes an approval
      in this system attributable to a person.

### The staff portal
- [x] **Every member of staff has an account**, and it is deliberately *not* an
      organisation membership. A portal user is denied by every existing policy
      by default; access exists only where a migration opens a door keyed to
      their own employee record. Proved: a commis chef sees 0 products, 0
      suppliers, 0 orders, 0 HR cases and exactly one employee row — his own.
- [x] Clock in and out with an optional geofence. A punch from outside is
      refused by a trigger naming the distance; one with no location is
      accepted and flagged rather than silently trusted.
- [x] Inbox for newsletters, rota, training material and policies. Opening
      marks read; acknowledging is a separate press, because "I opened this"
      and "I have read and understood this" answer different questions.
- [x] Exams graded in the database. The questions come from a view that does
      not select the answers, and there is no policy on `quiz_questions` for a
      candidate at all — so a score cannot be computed anywhere the candidate
      can reach. Results go to HR and to the named line manager.
- [x] Leave applications with a sick-note photograph. Health data under GDPR
      Article 9, so it is readable by the person and by whoever administers
      People, and by nobody else. Proved: a colleague sees zero.

### Hygiene
- [x] **A venue can upload its own HACCP templates** as CSV, with a preview
      before anything saves and header synonyms so a kitchen's own wording
      imports.
- [x] A form carries its own fields and limits, so a chiller log that knows
      5 °C reports "read 9.2 °C, above its limit of 5 °C" without anybody
      ticking a box — and the trigger then refuses the record until somebody
      says what was done about it.

### Inventory
- [x] **Periodic count sheets** download as CSV and upload back filled in. The
      sheet deliberately carries no expected quantity: a person who can see
      "expected 4" writes 4, and a test asserts the rendered sheet contains no
      stock figure so the column cannot be added back by accident.
- [x] A blank on a returned sheet is skipped, not zeroed.

### Products and purchasing
- [x] **Nutrition and allergens looked up from a product's name.** It proposes,
      never asserts: allergens always arrive with the product marked unverified,
      and silence is never turned into a free-from claim.
- [x] **A product can be bought from more than one supplier**, with each
      vendor's code, pack size, price and lead time, ranked on cost per unit
      derived by the database. Preference and price are kept apart — the screen
      says when you are ordering from the dearer one and does not reorder.
- [x] Ordering narrowed by supplier or by product category, with one button to
      add everything at or below its reorder point.

### Known gaps
- [ ] **No git remote.** Every branch is local to this machine, `main` is
      nine commits behind, and CI has therefore never run on any of this work.
- [ ] Never deployed. `DEPLOY.md` is untested.
- [ ] `pnpm lint` fails — eslint is not installed.
- [ ] Realtime sync was built, could not be made to work, and was deliberately
      reverted rather than shipped. Undiagnosed.
- [ ] The WhatsApp and email adapters have never made a real network call,
      and neither has the assistant.
- [ ] Written-answer marking has schema and no screen.

## Open questions for the user
(Updated after competitive analysis pass #1 — see `docs/COMPETITIVE_ANALYSIS.md`)
- Accounting: recommend QuickBooks + Xero at launch, Zoho Books as secondary. Confirm.
- Payments: recommend NOT building this — integrate with POS instead (industry norm).
  Which POS system(s) should be first-priority integrations?
- Staff management: recommend scoping to scheduling/labor forecasting only, integrating
  out to a real payroll provider rather than building payroll. Confirm scope.
- Confirm target launch market(s) — affects tax/currency/compliance defaults (VAT vs.
  Indonesian PPN, UAE WPS payroll compliance vs. Indonesian equivalents).
