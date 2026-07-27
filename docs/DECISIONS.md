# Decision Log

Running record of decisions made during planning and development, so context
isn't lost between sessions. Newest entries at the top.

---

### 2026-07-26 — Working name: CulinaryCoreOS (CCOS)

- Project started from an SRS document that used "CulinaryCore" as a
  placeholder title. Verified it was not derived from the actual restaurant
  data (no occurrence anywhere in the source Excel workbooks).
- Investigated the source workbooks and identified the originating business:
  **Chupacabras** (+ sister venue **Arriba**), a South American prime-meats
  restaurant in Ubud, Bali, under Sensorial Management Group, Executive Chef
  Mauro Santarelli.
- Decision: the product is being built as a **general-purpose, sellable
  hospitality operating platform**, not a restaurant-specific tool — so the
  name should NOT be tied to Chupacabras/Arriba. The workbook data is the
  origin of the requirements, not the brand.
- Brainstormed alternatives (Mise, Kitchara, Passform, Batchly, Yieldworks,
  GastroCore, KitchenOS, Recipeworks, HospitalityStack, etc.) — see
  `docs/NAMING.md` for the full list and rationale.
- **Final call for now: "CulinaryCoreOS" (CCOS)** — adopted as the working
  name to unblock development. Not treated as final; revisit before trademark
  filing or public launch. Claude has a standing reminder to periodically
  check in on this.

### 2026-07-25 — Stack decisions (inherited from SRS Appendix G)

| Decision | Rationale |
|---|---|
| Supabase as backend | RLS, real-time, open source, reduced ops overhead |
| React + TypeScript frontend | Type safety, ecosystem maturity |
| Offline-first architecture | Kitchen connectivity is unreliable |
| AI abstraction layer | Avoid provider lock-in, support on-device AI |
| Single codebase, multi-platform | Maximize code reuse |
| Capacitor for iOS/iPadOS | Better native API access than PWA |
| Tauri for macOS | Lightweight, Rust-based, better than Electron |
| DECIMAL for financial calculations | Floating point rounding errors unacceptable for money |
| Unlimited ingredient lines | Workbook's 26-line limit was arbitrary |

### 2026-07-25 — Environment / division of labor

- Claude (this chat interface) can research, draft files, and scaffold the
  repo, but has no access to the user's Mac, Xcode, Docker, or Supabase CLI.
- **Claude Code** (terminal/desktop app) is the tool for actually driving
  the local toolchain — git, xcodebuild, docker, supabase — on the user's
  machine.
- This repo is being prepared here and handed off for local development.
