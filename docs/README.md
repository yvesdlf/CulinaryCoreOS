# Documentation

## Living records — current state

| File | What it is |
| --- | --- |
| [PROGRESS.md](PROGRESS.md) | **Start here.** What is built, what is not, and the known gaps. |
| [DECISIONS.md](DECISIONS.md) | Decision log — the choices and why. |
| [SETUP.md](SETUP.md) | Running the app and the local Supabase stack. |
| [NAMING.md](NAMING.md) | Naming rationale (CulinaryCoreOS / CCOS). |
| [COMPETITIVE_ANALYSIS.md](COMPETITIVE_ANALYSIS.md) | Where this sits against Apicbase, Meez, MarketMan et al. |

## Specifications — original design intent

Written from an analysis of the two source workbooks before implementation
began, and **not revised since**. They record the reasoning behind the design;
they do not describe what currently exists. Where they disagree with the code,
the code is what is true — see `PROGRESS.md`.

Known divergences already: currency is IDR with Indonesian PPN at 11% rather
than AED with VAT at 5%, and the schema has gained multi-tenancy with row level
security.

| File | Scope |
| --- | --- |
| [DOC1 — Software Requirements](DOC1_SOFTWARE_REQUIREMENTS_SPECIFICATION.md) | Modules, personas, user stories |
| [DOC2 — Database Design](DOC2_DATABASE_DESIGN.md) | Full target schema, well beyond what is migrated so far |
| [DOC3 — Business Rules](DOC3_BUSINESS_RULES.md) | The costing and nutrition formulas, as read from the workbooks |
| [DOC4 — UI/UX Specification](DOC4_UI_UX_SPECIFICATION.md) | Screens and platform-specific designs |
| [DOC5 — AI System Design](DOC5_AI_SYSTEM_DESIGN.md) | Provider abstraction, recipe import pipeline |
| [DOC6 — Development Plan](DOC6_LOVABLE_DEVELOPMENT_PLAN.md) | Phased build plan |

The `DOC{n}_` prefixes are load-bearing: the documents cross-reference each
other by those names, so renaming them would break those links.

`DOC1` supersedes the earlier `SRS.md`, which was the same document without
Appendix H and has been removed to avoid two competing copies.
