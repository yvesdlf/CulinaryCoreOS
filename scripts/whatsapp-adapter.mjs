#!/usr/bin/env node
// ---------------------------------------------------------------------------
// WhatsApp adapter
// ---------------------------------------------------------------------------
// Drains `message_deliveries` and sends the WhatsApp ones through the Meta
// Cloud API.
//
// Runs outside the database on purpose. A trigger must never make a network
// call: a slow provider would hold a transaction open, and a failing one would
// roll back the delivery that caused it. So the database queues and this
// sends.
//
// It needs the service role key, which is why it is a script you run and never
// anything the browser loads. The access token is read from the environment
// and is deliberately not stored in the database — a secret in a table half
// the organisation can read would undo every access control in the system.
//
//   WHATSAPP_TOKEN=...          from your Meta app
//   SUPABASE_URL=...            e.g. https://xyz.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=...
//
//   node scripts/whatsapp-adapter.mjs            send for real
//   node scripts/whatsapp-adapter.mjs --dry-run  show what would be sent
//   node scripts/whatsapp-adapter.mjs --once     one pass, then exit
// ---------------------------------------------------------------------------

const DRY_RUN = process.argv.includes("--dry-run");
const ONCE = process.argv.includes("--once") || DRY_RUN;
const POLL_MS = Number(process.env.POLL_INTERVAL_MS ?? 15_000);
const BATCH = 25;
/** Give up after this many attempts so one bad number cannot spin forever. */
const MAX_ATTEMPTS = 4;

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is required.");
  process.exit(1);
}
if (!WHATSAPP_TOKEN && !DRY_RUN) {
  console.error("WHATSAPP_TOKEN is required unless running with --dry-run.");
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
  // Ordered oldest first so a backlog drains in the order it happened rather
  // than newest-first, which would leave the oldest message never sent.
  const res = await rest(
    `message_deliveries?status=eq.PENDING&kind=eq.WHATSAPP` +
      `&attempts=lt.${MAX_ATTEMPTS}&order=queued_at.asc&limit=${BATCH}` +
      `&select=id,notification_id,channel_id,destination,attempts`,
  );
  if (!res.ok) throw new Error(`claim failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function loadContext(delivery) {
  const [n, c] = await Promise.all([
    rest(`notifications?id=eq.${delivery.notification_id}&select=subject,body,kind`).then((r) => r.json()),
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

/**
 * Send one message.
 *
 * A template is used rather than free text because WhatsApp only allows an
 * unprompted business message through an approved template. The subject and
 * body go in as parameters.
 */
async function sendWhatsApp(destination, notification, config) {
  const phoneNumberId = config.phone_number_id;
  if (!phoneNumberId) throw new Error("no phone_number_id configured on the channel");

  const body = {
    messaging_product: "whatsapp",
    to: destination.replace(/[^\d+]/g, ""),
    type: "template",
    template: {
      name: config.template ?? "ccos_notification",
      language: { code: config.language ?? "en" },
      components: [{
        type: "body",
        parameters: [
          { type: "text", text: notification.subject },
          { type: "text", text: notification.body ?? "" },
        ],
      }],
    },
  };

  const res = await fetch(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${text}`);
  let id = null;
  try { id = JSON.parse(text)?.messages?.[0]?.id ?? null; } catch { /* keep null */ }
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
      const externalId = await sendWhatsApp(d.destination, notification, config);
      await markDelivery(d.id, {
        status: "SENT", sent_at: new Date().toISOString(),
        external_id: externalId, attempts: d.attempts + 1, last_error: null,
      });
      console.log(`  sent → ${d.destination}`);
    } catch (err) {
      const attempts = d.attempts + 1;
      // Left PENDING until the attempt cap, so a transient outage retries and
      // a permanently bad number eventually stops rather than looping.
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
  console.log(
    `WhatsApp adapter against ${SUPABASE_URL}${DRY_RUN ? " (dry run)" : ""}`,
  );
  if (ONCE) { await pass(); return; }
  for (;;) {
    try { await pass(); } catch (err) { console.error(err.message ?? err); }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
