# Production deployment and billing: what is actually missing

Written 2026-11-01, against migrations 0001–0120.

Two items on the PROGRESS.md list read like one problem — "it isn't live and
it can't charge" — and they are not. One is three-quarters done and blocked
on a decision. The other does not exist at all and is blocked on a design
choice that is easy to get wrong in a way that corrupts the audit trail.

---

## 1. Production deployment

### What already works

Not "nothing is deployed". `vercel.json` is in the repository, Vercel builds
and deploys every pull request, and the deployment check was green on #15.
CI starts Supabase, applies all 120 migrations to an empty schema, runs the
1,364 database controls, runs the browser suites, and asserts the production
build loads under the production headers. The build side of deployment is in
better shape than most of the application.

### The one thing that is genuinely dangerous

`apps/web/.env.example` says it plainly: **without `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` the build still succeeds.** The application checks
`isSupabaseConfigured` and falls back to its in-memory mock catalogue.

So the failure mode is not a red build. It is a deployment that looks
perfectly healthy and serves invented data as though it were the venue's.
Somebody reads a food cost off a mock catalogue and acts on it.

Nothing currently asserts against this, and it is the only part of
deployment that needs no decision from anyone. Fix it in three places:

1. **Fail the production build when the variables are absent.** A check in
   the Vite config that throws when `import.meta.env.PROD` and the
   variables are unset. A preview build may still mock; a production build
   must not.
2. **Make the mock visible when it is in use.** A persistent banner, not a
   console warning. If the application is showing invented data it should
   say so on every screen.
3. **Assert it in CI.** A build with the variables stripped must fail. This
   is the control; the other two are the behaviour it protects.

### The decision that blocks the rest

**Where the production database lives has never been chosen.** Everything
below depends on it and none of it can start without it:

- Supabase hosted project, which region, which plan. Region matters because
  the venues are in Indonesia and the latency is paid on every write by
  people on the floor.
- Whether staging is a second project or a branch of the first.
- Backups. Supabase takes automatic backups on paid plans; **a restore has
  never been rehearsed here.** An untested backup is not a backup.
- Error monitoring. There is none. Sentry or equivalent, with the DSN as a
  build variable.
- Auth: SMTP for invitations and password resets, which is the same
  unanswered "sending things" question that blocks purchase orders.

### Order of work

| | Needs a decision? |
|---|---|
| Fail the build without variables; banner the mock; assert in CI | No — do it now |
| Create the production project, apply migrations, seed the catalogue | **Yes — region and plan** |
| Rehearse a restore from backup and write down what it took | After the project exists |
| Error monitoring | No, once a project exists |
| SMTP / invitation channel | **Yes — same open question as POs** |

---

## 2. Billing

### What exists

Nothing. Not "partially" — there is no subscriptions table, no plan
entitlement, no metering, no invoice, and nothing that can cut anybody off.
`ai_allowances` (0115) is the only commercial table and it is set by hand
with the service role.

What does exist, and is the reason this is tractable, is the seam:
`docs/commercial/PRICING.md` sells **module packs** (Core, Kitchen, Supply,
People, Property, Revenue) and those packs are exactly groupings of
`app_sections`. The thing to be sold is already the thing the access control
is built around.

### The mistake to avoid

The tempting implementation is to express entitlement through
`member_access` — unsell a pack, remove the grants. **Do not.** Three
reasons, each of which shows up later as a support call:

1. **"Not sold" and "not permitted" are different facts.** Folding them
   together means an unpaid invoice is indistinguishable from a manager
   revoking a permission, and the audit trail now lies about why somebody
   lost access.
2. **Re-selling has to restore the previous state.** If unselling destroyed
   the grants, nobody can say what they were. A venue that lapses for a
   month and comes back expects their permissions back, not a rebuild.
3. **Lapsing must not make records unreachable.** HACCP sheets, payroll
   records and traceability lots carry statutory retention. A venue that
   stops paying for Kitchen still has a legal duty to produce its hygiene
   records, and holding them hostage is not a position to be in. **A lapsed
   module goes read-only and stays exportable. It does not go dark.**

So entitlement is a **third gate**, beside `auth_can_write(org_id)` and
`require_section_write(section)` — not a rewrite of either.

### Shape

```
plans                 what is sold: code, name, the packs it includes
plan_sections         pack -> app_sections.code  (the mapping, as data)
subscriptions         org_id, plan, status, period, external ref
subscription_items    per venue, since the price is per venue
org_entitlements      derived: org_id, section_code, level (write/read/none)
```

`org_entitlements` is **derived**, refreshed by a function, exactly as
`app_sections.scopes_by_unit` is derived by `refresh_section_unit_scoping()`.
The same rule applies: never hand-write a derived table.

Then one function — `entitled_level(section)` — consulted by
`require_section_write` before it consults permissions, and by the read
rules in `section_read_rules`. A section the venue has not bought refuses
writes and permits reads. Every one of the 61 control files should keep
passing unchanged, because a fully-entitled org is the default; the new
controls are the ones that prove a *partially* entitled org behaves.

### The decision that blocks it

**Which payment provider, which depends on where the selling entity is
incorporated** — and that is not recorded anywhere in this repository.

It matters more than it looks, and the obvious answer is only half right.
Stripe is the right choice if the selling company is EU, UK, US, Singapore
or Australian. If the selling entity is **Indonesian**, Stripe will open an
account — but an Indonesia-based Stripe account is restricted in ways that
decide the architecture:

- **It settles to an IDR bank account and supports Indonesia bank transfer
  (virtual account).** That is the rail Indonesian venues actually pay with,
  so for domestic subscriptions it works.
- **It does not support cross-border or international transactions.** Stripe's
  own guidance is to open an account in another country to accept payments
  globally. So an Indonesian entity on Stripe cannot charge a card issued
  outside Indonesia — the first non-Indonesian customer has no way to pay.
- **No plugin ecosystem** for Indonesia-based accounts, which matters not at
  all here since this would be a direct API integration anyway.

Verified against Stripe's own Indonesia pages, cited below; third-party
summaries of Indonesia's Stripe status contradict each other and some are
out of date, so confirm current terms with Stripe before signing anything.

That gives three outcomes rather than one:

| Selling entity | Provider | Consequence |
|---|---|---|
| EU / UK / US / SG / AU | Stripe | Cards and international both work; venues pay by card or transfer |
| Indonesian, domestic customers only | Stripe (IDR, virtual account) or Xendit / Midtrans | Works now; **no international customers ever** |
| Indonesian, wants international customers | A second entity abroad, or Xendit for local + Stripe abroad | Two integrations, or a corporate structure decision |

The venues are plainly Indonesian — every money table defaults to `IDR` and
the approval thresholds are seeded in millions. Where the company that
invoices them is registered, and whether it intends to sell outside
Indonesia, is the open question. **The second half of that question is the
one that actually constrains the build**, and it is a commercial decision
rather than a technical one.

Sources: [Stripe — supported payment methods, currencies and businesses for
Indonesia](https://support.stripe.com/questions/supported-payment-methods-currencies-and-businesses-for-stripe-accounts-in-indonesia),
[Stripe — requirements to open an account in
Indonesia](https://support.stripe.com/questions/requirements-to-open-a-stripe-account-in-indonesia),
[Stripe — Indonesia
FAQ](https://support.stripe.com/questions/indonesia-faq).

### Order of work

| | Needs a decision? |
|---|---|
| `plans`, `plan_sections`, `subscriptions`, `subscription_items` | No — provider-agnostic |
| `org_entitlements` + `entitled_level()` + the third gate | No |
| Controls: a partially-entitled org is read-only, not dark | No |
| Webhook handler, checkout, customer portal | **Yes — provider** |
| Reconcile job: provider state -> `subscriptions.status` | After the provider |
| Retire the hand-set `ai_allowances` into plan entitlement | After the above |

The first three rows are the bulk of it and need nobody's permission. The
provider only touches the edge.

---

## 3. What this leaves on the open-questions list

Unchanged, and all three still block real work:

- **Notification channel** — email provider, Supabase auth email, or
  WhatsApp. Blocks invitations, purchase order transmission, and escalation.
- **Production database target** — region, plan, staging topology.
- **Which POS first** — blocks automated takings; the manual path works.

New, and added by this document:

- **Where the selling entity is incorporated, and whether it intends to sell
  outside Indonesia.** Together these decide the payment provider, and the
  second one decides whether Stripe alone can ever be enough.
