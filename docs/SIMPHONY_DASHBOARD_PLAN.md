# Plan: a Simphony-grade dashboard and report library for CCOS

Derived from `docs/research/simphony-vs-ccos.md`. Covers only the gaps that are
buildable with data CCOS already has — no POS feed, no owner decision needed.
Each item is sized like the six reports that came before it: migration +
invoker-rights function + database test (proved by breaking it) + data layer +
UI + browser verification + PR. Run as the GSD loop; ship means a PR.

Blocked gaps (daypart, per-employee sales, voids/discounts/tenders, loyalty,
gift cards, multi-currency) are **not** here — they are owner decisions and
most are the queued P2 POS brief. See §4 of the comparison.

## Gate (must clear first)
- [ ] The six report PRs (#23–#28) and the two fixes merge to `main`. This
      needs the `git push --force-with-lease` the owner must authorise. Every
      item below extends the dashboard or the Reports page the reports stack
      builds, so building before the stack lands means rebasing onto sand.
      **Nothing below starts until main carries the reports.**

## P0 — The dashboard (the owner's stated focus)
- [ ] **D1 Comparison tiles.** Net sales, gross profit, cost of goods as
      *today vs same-day-last-week vs same-day-last-year, with variance %*.
      Reuse the period engine's `sameTimeLastYear`. New `overview_comparison`
      view or RPC; a `ComparisonTile` component; place on the dashboard.
- [ ] **D2 Forecast tiles.** Net-sales pace (last 7 / next 7 days) from
      `daily_forecasts`, actual-vs-forecast overlaid, current trading period
      marked. Hand-rolled SVG like `trend-chart.tsx` (no new chart dep).
- [ ] **D3 Customisable dashboard.** Role-default tile set + per-person
      override and ordering, mirroring Simphony's Role/Person model and CCOS's
      own `member_access` section model. A `dashboard_tiles` registry +
      `member_dashboard` preference, gated so a tile a reader can't see never
      renders. This is the frame D1/D2 live in; design it before building them.
- [ ] **D4 Drill-through.** Each tile links into the matching Reports tab with
      the period pre-set — the "Run Daily Operations" pattern.

## P1 — Net-new reports (slot into the existing Reports page)
- [ ] **R1 Sales Variance** — net sales for a date vs previous week vs previous
      year with variance. Native period-engine output; invoker-rights RPC.
- [ ] **R2 Sales / Service by Weekday** — takings and covers by weekday and
      daypart-where-available; "which days make money".
- [ ] **R3 Labour pack** — Clock-in status, Time-card summary (hours & pay by
      job code), Payroll summary, from rota/shifts/clock-ins/pay rates. Gated
      on Pay for the money columns.
- [ ] **R4 Posting Calendar** — red/green calendar of which business dates have
      posted takings/sales; a data-health view in the honest-caveats spirit.

## P2 — The library (reorganises, build last)
- [ ] **L1 Report library** — lift the 14 hardcoded Reports tabs into a
      searchable, categorised list with per-role curation and personal
      favourites; "My Reports" = the subset a role/user has added. Same
      Role/Person shape as D3, so share it.

## Definition of done (every item)
Works through the UI and the database; permissions enforced in the database,
not the screen; a test that fails when the control is broken; tsc + lint +
unit + database + build pass; the comparison tile's arithmetic asserted in
full (not against itself); browser-verified; `docs/PROGRESS.md` updated.

## Parallelism (for the agent fan-out, once the gate clears)
D3 is the spine and D1/D2/D4 and L1 all depend on its shape — it is sequential
and first. Once D3's registry exists, D1, D2 and R1–R4 are independent of each
other and can run in parallel (separate migrations, separate Reports tabs or
tiles, no shared files beyond the registry). L1 comes after, since it
reorganises the Reports page the R-items extend.
