# What this changes

<!-- One or two sentences. What can somebody do now that they could not before,
     or what stopped being wrong. -->

## Why

<!-- The problem, not the solution. If this fixes a bug, describe the failure a
     user would have seen. -->

## How it was proved

<!-- Not "tested locally". Name what was actually exercised:
     - which flow was driven in the browser, and what it produced
     - which SQL was run to try to break a rule, and what the database said
     - which tests were added, and what defect each one encodes -->

- [ ] `pnpm -C apps/web exec tsc --noEmit` passes
- [ ] `pnpm -C apps/web exec vitest run` passes
- [ ] Migrations rebuild from an empty database (see AGENTS.md)
- [ ] Behaviour exercised in the browser, or a reason it cannot be

## Anything a reviewer should push back on

<!-- Assumptions made, scope deliberately left out, anything that felt wrong
     while writing it. An empty section here is usually a PR nobody read. -->
