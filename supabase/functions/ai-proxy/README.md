# ai-proxy

The platform's AI key lives here and nowhere else.

## Why it exists

The assistant is bring-your-own-key by default: the venue's key sits in one
browser's `localStorage`, the call goes straight to the provider, and the bill
is theirs. That remains the cheaper and more private option.

A platform key cannot work that way. A key the browser can read is a key the
venue has been given — one `localStorage` dump and it is on somebody else's
project, billed to us.

## Deploying

```bash
supabase functions deploy ai-proxy
supabase secrets set AI_KEY_GEMINI=...
supabase secrets set AI_KEY_ANTHROPIC=...
```

The key is a **function secret**, not a row. A key in the database is in every
backup, every dump and every screen-share of a console — and it would still
have to reach the browser to be used, so storing it centrally adds the
exposure without removing any.

## What holds the spend down

`claim_ai_call` (0115) checks the venue's allowance and records the attempt in
one statement, before this function reaches for the key. The cap is in the
database because a cap the browser enforces is not a cap: one venue in a retry
loop would bill the platform for all of them, and the first anybody would know
is the invoice.

A venue is **not** allowed by default. `ai_allowances.platform_key_allowed` is
false until somebody sets it, because opt-out would make the platform's bill a
function of how many venues forgot to look.

## Statuses, and what they mean to a client

| Status | Meaning | What the app should do |
|---|---|---|
| 402 | The allowance is used up, or the venue is not set up | Offer their own key. **Do not retry.** |
| 501 | The platform has no key for that provider | Offer their own key |
| 502 | The provider refused | Show it failed; the claim is recorded as such |
| 504 | The provider could not be reached | As above |

402 rather than 429 is deliberate: this is not "slow down", it is "that is the
allowance", and a client that retries a 429 hammers a wall.

The provider's own error text is never forwarded. It can echo the request back,
and the request carried the key.
