// ---------------------------------------------------------------------------
// The platform key, and the only place it exists
// ---------------------------------------------------------------------------
// Bring-your-own-key does not need this: the browser holds the venue's own
// key, calls the provider directly, and the bill is theirs. That is still the
// default and still the cheaper, more private option, and
// `stores/ai-store.ts` sets out why.
//
// A platform key cannot work that way. A key the browser can read is a key
// the venue has been given — one `localStorage` dump and it is on somebody
// else's project, billed to us. So it lives here, as a function secret, and
// never enters the database either: a key in a table is in every backup and
// every screen-share of a console.
//
// Three rules this function exists to hold:
//
//   Claim before calling. `claim_ai_call` checks the venue's allowance and
//   writes the attempt in one statement. A cap the browser enforces is not a
//   cap — one venue in a retry loop would bill the platform for all of them,
//   and the first anybody would know is the invoice.
//
//   Record what the provider said it used, not an estimate. A meter that
//   drifts from the invoice is a meter nobody can charge from.
//
//   Never return the key, never log it, never put it in an error. The
//   response carries text and token counts and nothing else.
//
// The caller's own JWT is used for the claim, deliberately: the allowance is
// per venue, and `auth.uid()` is how the database knows which venue is
// asking. Taking an org id from the request body would let anybody spend
// anybody's allowance.
// ---------------------------------------------------------------------------

import { createClient } from "jsr:@supabase/supabase-js@2";

const PROVIDERS: Record<string, {
  url: (model: string) => string;
  headers: (key: string) => Record<string, string>;
  body: (model: string, prompt: string, maxTokens: number) => unknown;
  read: (json: any) => { text: string; input: number | null; output: number | null };
}> = {
  gemini: {
    url: (model) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    headers: (key) => ({ "x-goog-api-key": key, "content-type": "application/json" }),
    body: (_model, prompt, maxTokens) => ({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
    read: (json) => ({
      text: json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
      input: json?.usageMetadata?.promptTokenCount ?? null,
      output: json?.usageMetadata?.candidatesTokenCount ?? null,
    }),
  },
  anthropic: {
    url: () => "https://api.anthropic.com/v1/messages",
    headers: (key) => ({
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    }),
    body: (model, prompt, maxTokens) => ({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
    read: (json) => ({
      text: json?.content?.[0]?.text ?? "",
      input: json?.usage?.input_tokens ?? null,
      output: json?.usage?.output_tokens ?? null,
    }),
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const auth = req.headers.get("authorization");
  if (!auth) return json({ error: "not signed in" }, 401);

  const { providerId, model, prompt, task, maxTokens } = await req.json()
    .catch(() => ({}));

  const provider = PROVIDERS[providerId];
  if (!provider) return json({ error: `unknown provider "${providerId}"` }, 400);

  /*
   * The key, from the environment. Absent means the platform has not been
   * set up for this provider — which is a configuration answer, not a quota
   * answer, and the venue should be told to use their own key rather than
   * left thinking they are out of allowance.
   */
  const key = Deno.env.get(`AI_KEY_${providerId.toUpperCase()}`);
  if (!key) {
    return json({
      error: "the platform has no key for that provider",
      useOwnKey: true,
    }, 501);
  }

  // As the caller, so the database knows whose allowance this is. Their JWT,
  // not the service role: an org id taken from the body would let anybody
  // spend anybody's.
  const asCaller = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { authorization: auth } } },
  );

  const { data: org, error: orgError } = await asCaller.rpc("auth_default_org_id");
  if (orgError || !org) return json({ error: "no venue for this account" }, 403);

  const { data: claimRows, error: claimError } = await asCaller
    .rpc("claim_ai_call", { p_org: org, p_provider: providerId, p_task: task ?? null });
  if (claimError) return json({ error: claimError.message }, 500);

  const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
  if (!claim?.allowed) {
    // 402 rather than 429: this is not "slow down", it is "that is the
    // allowance". A client that retries a 429 would hammer a wall.
    return json({ error: claim?.reason ?? "refused", useOwnKey: true }, 402);
  }

  let answer: { text: string; input: number | null; output: number | null };
  try {
    const res = await fetch(provider.url(model), {
      method: "POST",
      headers: provider.headers(key),
      body: JSON.stringify(provider.body(model, prompt, maxTokens ?? 1024)),
    });
    const body = await res.json();
    if (!res.ok) {
      // Recorded as a failure, with no tokens: the claim was spent and the
      // call did not happen, and an invoice has to be able to tell those
      // apart. The provider's own message is deliberately not forwarded —
      // it can carry the key back in an echo of the request.
      await asCaller.rpc("record_ai_usage", {
        p_claim: claim.claim_id, p_model: model,
        p_input: null, p_output: null, p_outcome: "PROVIDER_ERROR",
      });
      return json({ error: `the provider refused the request (${res.status})` }, 502);
    }
    answer = provider.read(body);
  } catch (_e) {
    await asCaller.rpc("record_ai_usage", {
      p_claim: claim.claim_id, p_model: model,
      p_input: null, p_output: null, p_outcome: "NETWORK_ERROR",
    });
    return json({ error: "could not reach the provider" }, 504);
  }

  await asCaller.rpc("record_ai_usage", {
    p_claim: claim.claim_id, p_model: model,
    p_input: answer.input, p_output: answer.output, p_outcome: "OK",
  });

  return json({
    text: answer.text,
    model,
    inputTokens: answer.input,
    outputTokens: answer.output,
  });
});
