# UI/UX review — received 2026-09-19

> A third-party review of the interface, with two concept mockups: a
> role-aware general manager overview, and a Team & HR workspace with grouped
> vertical navigation instead of a tab row.
>
> **Status: noted, not accepted.** Nothing here is scheduled. This file exists
> so the review is not lost, and so that when the interface work does happen
> it starts from an assessment rather than from a screenshot. One item in it
> was a defect and has been fixed; the rest is recorded below with what the
> reviewer could not have known from the outside.

## The summary judgement, which is fair

> "Most screens currently resemble a polished database interface: identical
> white cards, flat navigation, long tab rows, and large empty areas."

That is accurate and it is measurable. The sidebar is twenty flat items. The
People page carries eleven tabs and Purchasing six. Several empty states are
one sentence in the middle of a screen. None of that is in dispute.

## Where it agrees with decisions already taken

Two of the highest-impact suggestions are things this repository had already
concluded independently, which is worth recording because it raises confidence
in both.

- **Group the sidebar by work area.** Proposed in the hierarchy review the
  same day, with the same five groups — Today, Culinary, Supply, Operations,
  People, System. The review adds "users should only see sections permitted
  for their role", which is `PLATFORM.md` §5.
- **Make the dashboard role-aware.** This is exactly `PLATFORM.md` §5:
  a role is a capability at a scope, so there is one dashboard and it renders
  what the person's access grid says. The reviewer arrived at the same place
  from the outside.

## What the review could not see

- **The semantic palette it recommends already exists.** `--status-danger`,
  `--status-warning`, `--status-success`, `--status-info`, each with a `-soft`
  and a `-border` variant, in both themes. The recommendation to add "amber
  for warnings, muted red for critical, slate blue for information" is a
  recommendation to use tokens that are already defined and already used.
- **Shadow tokens are specified** in DOC4 §, four steps. The flatness is a
  drift from the specification rather than the specification.
- **The sample sales data is deliberately marked as invented.** The review
  asks to "populate the sales demo" so the app does not feel unfinished. That
  is reasonable, with one condition that is not negotiable: every sample
  period carries a `SAMPLE` flag and the page states in as many words that the
  figures are made up, because a menu decision gets argued about and nobody
  should later have to work out which months were real. Demo data that looks
  real and is not flagged would undo a decision taken on purpose.

## The one thing that was a defect, and is fixed

Route slugs were rendering as page titles: `human-resources`, `housekeeping`,
`maintenance`, `administration`. The breadcrumb falls back to the raw path
segment when a route has no label, and five routes had none — two of which
were added the same day this review was written. Fixed in the commit that adds
this file.

## Constraints any restyle has to respect

These are not objections. They are the things that will make a visual pass
expensive if they are discovered halfway through it.

1. **WCAG 2.2 AA is enforced in CI, in both themes.** Contrast is the most
   common failure and the two themes have independent colour values.
   `PROGRESS.md` already records tokens tuned against one background only as a
   defect that shipped once. A "warm off-white background" changes the
   contrast denominator for every token on every page.
2. **The visual regression suite has committed snapshots.** A restyle
   invalidates all of them at once. Regenerating them wholesale removes the
   safety net for exactly the commit that needs it most, so the restyle should
   be one deliberate commit whose snapshot diff is reviewed rather than
   accepted.
3. **Hiding an action is not authorisation** (Design Bible §14.7). Role-aware
   navigation must hide things for clarity, never for security — the database
   refuses the write regardless, and a viewer who cannot see why they cannot
   save is a worse outcome than one who sees a disabled control with a reason.
4. **One design system, applied once.** The review's closing point, and the
   right one. Restyling page by page produces twenty dialects.

## What is buildable now, and what is not

Worth separating, because the GM concept looks more blocked than it is.

**Concept 1 is almost entirely buildable today.** Its tiles map to facts that
already exist: approvals awaiting, hygiene checks due and overdue, purchasing
committed against budget, rooms still to clean, food cost against target,
staff on shift. Every one of those has a table and a view behind it.

What is *not* buildable is anything with a margin or a labour cost in it —
`PLATFORM.md` §6: there is no pay rate and no revenue per unit in the schema.
So a general manager's overview can be built now; a CFO's cannot.

**Concept 2 is buildable now**, and solves a measured problem rather than a
stylistic one: eleven tabs on People is past what a tab row can carry.

## If and when this is picked up

Rough order, cheapest and least risky first:

1. Breadcrumb and title labels — done.
2. Sidebar grouping. No new components, and it is the change with the largest
   ratio of relief to risk.
3. People and Purchasing: vertical grouped navigation instead of tab rows.
4. Empty states: explanation, primary action, and what the screen will show
   once it has data.
5. Top bar context — venue, date, service, covers. Covers already exist in
   Production; the venue is the organisation.
6. Table density, avatars, status chips, sticky filters.
7. The token pass — background, elevation, header treatment — as one commit,
   with the axe sweep and the snapshot diff both reviewed.
8. The role-aware dashboard, which is `PLATFORM.md` work rather than visual
   work and should follow the unit and scope axes, not precede them.
