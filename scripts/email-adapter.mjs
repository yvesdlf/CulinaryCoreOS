#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Email adapter
// ---------------------------------------------------------------------------
// The same shape as the WhatsApp adapter and for the same reasons: the
// database queues, this sends, and the access key lives in the environment
// rather than in a table.
//
// Written against a provider's HTTP API rather than SMTP. SMTP would mean
// holding a connection, handling TLS and reading multi-line reply codes to
// find out whether a message was accepted; a provider returns a message id in
// one request and handles deliverability, which is most of the actual work in
// getting email to arrive.
//
// Resend is the default because its API is one POST. Any provider with a
// similar shape can be used by changing EMAIL_API_URL and the body builder.
//
//   EMAIL_API_KEY=...              provider key
//   EMAIL_FROM=kitchen@venue.com   must be a verified sender
//   SUPABASE_URL=...
//   SUPABASE_SERVICE_ROLE_KEY=...
//
//   node scripts/email-adapter.mjs --dry-run
// ---------------------------------------------------------------------------

const DRY_RUN = process.argv.includes("--dry-run");
const ONCE = process.argv.includes("--once") || DRY_RUN;
const POLL_MS = Number(process.env.POLL_INTERVAL_MS ?? 15_000);
const BATCH = 25;
const MAX_ATTEMPTS = 4;

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL_API_KEY = process.env.EMAIL_API_KEY;
const EMAIL_API_URL = process.env.EMAIL_API_URL ?? "https://api.resend.com/emails";

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is required.");
  process.exit(1);
}
if (!EMAIL_API_KEY && !DRY_RUN) {
  console.error("EMAIL_API_KEY is required unless running with --dry-run.");
  process.exit(1);
}

const rest = (path, init = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

async function claimPending() {
  const res = await rest(
    `message_deliveries?status=eq.PENDING&kind=eq.EMAIL` +
      `&attempts=lt.${MAX_ATTEMPTS}&order=queued_at.asc&limit=${BATCH}` +
      `&select=id,notification_id,channel_id,destination,attempts`,
  );
  if (!res.ok) throw new Error(`claim failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function loadContext(delivery) {
  const [n, c] = await Promise.all([
    rest(`notifications?id=eq.${delivery.notification_id}&select=subject,body,kind`)
      .then((r) => r.json()),
    delivery.channel_id
      ? rest(`message_channels?id=eq.${delivery.channel_id}&select=config`).then((r) => r.json())
      : Promise.resolve([{ config: {} }]),
  ]);
  return { notification: n[0], config: c[0]?.config ?? {} };
}

async function markDelivery(id, patch) {
  const res = await rest(`message_deliveries?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) console.error(`  could not mark ${id}: ${await res.text()}`);
}

/** Escape anything going into the HTML body — a supplier name is not markup. */
const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));

async function sendEmail(destination, notification, config) {
  const from = config.from || process.env.EMAIL_FROM;
  if (!from) throw new Error("no from address configured on the channel");

  const res = await fetch(EMAIL_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${EMAIL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [destination],
      subject: notification.subject,
      // Both parts: a plain-text alternative stops the message scoring as
      // spam and is what a phone in a kitchen will show anyway.
      text: `${notification.subject}\n\n${notification.body ?? ""}`,
      html:
        `<p><strong>${escapeHtml(notification.subject)}</strong></p>` +
        (notification.body ? `<p>${escapeHtml(notification.body)}</p>` : ""),
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`email ${res.status}: ${text}`);
  let id = null;
  try { id = JSON.parse(text)?.id ?? null; } catch { /* keep null */ }
  return id;
}

async function pass() {
  const pending = await claimPending();
  if (pending.length === 0) return 0;
  console.log(`${pending.length} to send`);

  for (const d of pending) {
    const { notification, config } = await loadContext(d);
    if (!notification) {
      await markDelivery(d.id, { status: "FAILED", last_error: "notification missing" });
      continue;
    }
    if (!d.destination) {
      await markDelivery(d.id, { status: "SKIPPED", last_error: "no destination" });
      continue;
    }
    if (DRY_RUN) {
      console.log(`  [dry run] → ${d.destination}: ${notification.subject}`);
      continue;
    }
    try {
      const externalId = await sendEmail(d.destination, notification, config);
      await markDelivery(d.id, {
        status: "SENT", sent_at: new Date().toISOString(),
        external_id: externalId, attempts: d.attempts + 1, last_error: null,
      });
      console.log(`  sent → ${d.destination}`);
    } catch (err) {
      const attempts = d.attempts + 1;
      await markDelivery(d.id, {
        status: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
        attempts, last_error: String(err.message ?? err),
      });
      console.error(`  failed → ${d.destination}: ${err.message ?? err}`);
    }
  }
  return pending.length;
}

async function main() {
  console.log(`Email adapter against ${SUPABASE_URL}${DRY_RUN ? " (dry run)" : ""}`);
  if (ONCE) { await pass(); return; }
  for (;;) {
    try { await pass(); } catch (err) { console.error(err.message ?? err); }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
