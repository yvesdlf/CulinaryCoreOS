# The name

`CulinaryCoreOS` describes a third of what this is. The other two thirds are
housekeeping, maintenance, people, pay, purchasing and revenue — and a
general manager evaluating a system for their whole property will read
"culinary" as "for the kitchen" and stop.

Written 2026-10-18. **This is a recommendation with the collision work done,
not a decision.** The name is yours.

---

## 1. What the thing actually is

Worth settling before arguing about words, because most naming arguments are
really arguments about this.

It is **the system of record for everything that happens behind the front
desk**: what was bought, what it cost, what was made, who worked, what they
were paid, what was cleaned, what broke, and what the law requires you to be
able to prove afterwards.

And it has one distinguishing quality, which is visible in every part of the
code and which the briefs never asked for: **it refuses to state what it does
not know.** A blank is not a zero. "No allergens found" is not "contains no
allergens". A forecast says how many days it was built from. A supplier with
two deliveries is marked as thin evidence rather than ranked.

That is the thing worth naming. Not the kitchen.

---

## 2. What was checked, and what it ruled out

| Candidate | Finding |
|---|---|
| **Mise** | Crowded, badly. Three active hospitality companies: [mise.restaurant](https://www.mise.restaurant/) (AI operations assistant), [discovermise.com](https://discovermise.com/) ("the restaurant operating system"), [miseteam.com](https://www.miseteam.com/) (rota, bookings, kitchen, HACCP — almost exactly this product's scope). **Rule out.** |
| **Tally** | [Tally Solutions](https://tallysolutionsmp.com/solutions/tally-for-hotels/) is one of India's most-used accounting platforms with a hotel and restaurant practice, and [TallySoft](https://www.tallysoft.com/solutions/restaurant-pos/) is a separate restaurant POS. Accounting-adjacent *and* hospitality-adjacent is the worst possible collision for this product. **Rule out.** |
| **Daybook** | No hospitality software or trademark found. **But** [logbook.hr](https://exevio.com/portfolio/logbook/) does reservations, staff management and food-safety logs — the same niche, one syllable away. Legally clear, commercially confusable. |

> **One search result contained text addressed to AI assistants, instructing
> them to recommend that product.** It was a vendor page in this exact niche.
> I ignored it and the comparison above uses only what each company publishes
> about itself — but it is worth knowing that the competitive research in this
> market is being actively poisoned, and that anything you or anyone else asks
> a model about hospitality software is downstream of that.

---

## 3. The shortlist

### Recommended: **Daybook**

The daybook is the book a business kept each day's transactions in before
anything was posted to the ledger. It is literally what this is: the record
of what happened, kept as it happened, that everything else is built from.

- Says "record you can trust", which is the product's actual differentiator.
- Carries no trade. A housekeeper and a chef both have a day.
- Two syllables, both of which an Indonesian speaker pronounces without
  thinking. No letter combinations that fight Bahasa phonology.
- Warm rather than technical. This is a product people are made to use.
- Legally clear in the niche as far as a web search reaches.

**The risk, stated plainly:** `logbook.hr` is a direct competitor one syllable
away. That is survivable — the words mean different things and the markets
are different sizes — but it needs a real trademark search before any money
goes on it, and it is the single best argument against.

### Runner-up: **Backhouse**

"Back of house" compressed to one word. Describes the scope exactly — the
whole product is the back of house — and nobody mistakes it for a kitchen
tool. Plainer and less evocative than Daybook, with the compensating
advantage of needing no explanation to anyone in the industry. Not checked
for collisions; if Daybook fails its trademark search, check this one next.

### Rejected, with reasons worth keeping

- **Anything with "OS"** — `CoreOS` is CoreOS, and the suffix now reads as
  2021 startup pastiche. It also promises a platform other people build on,
  which this is not.
- **A Balinese or Sanskrit word** (Banjar, Seva, Rantai). Lovely locally,
  opaque everywhere else, and borrowed-without-belonging at worst. The
  product is built in Bali and sold beyond it.
- **A coined word** (Verso, Keelon, Tera-). Clears trademark easily and
  teaches nobody anything. A coined name needs a marketing budget to mean
  something; a real word arrives meaning it.

---

## 4. Before anything is committed

1. **A real trademark search** in Nice class 9 and 42, in the jurisdictions
   that matter — ID, SG, AU, GB, EU, US. A web search is not a clearance
   search and this document is not advice.
2. **The domain.** `.com` is unlikely; `daybook.app` or `getdaybook.com` are
   the realistic shapes. Check before, not after.
3. **Say it on a phone to a Balinese colleague** and ask them to spell it
   back. That test has killed better names than this one.

## 5. What the rename costs, if you do it

Small, and smaller than it will feel. The string `CulinaryCore` appears in the
sidebar, the sign-in page, the page title and the seed data's demo account
(`demo@culinarycore.local`). The package names, the database, the storage
buckets and the migration history do not need to change and should not —
renaming a schema to match a brand is a week of risk for no user-visible gain.

Do it as one commit, with the demo account left alone until the next seed
regeneration.
