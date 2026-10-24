// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------
// The staff portal first, and only the staff portal, which is a deliberate
// order rather than how far anybody got.
//
// The people who need this app in Bahasa Indonesia are the ones clocking in,
// reading a handover and asking for leave — not the ones reading a food cost
// variance report, who chose to work in a system whose reports are in
// English. Translating the management app first would have produced a
// hundred translated strings nobody reading them needed.
//
// English is the fallback and also the source: an English phrase missing from
// `id` shows in English rather than as a key. The management app is therefore
// not broken by being untranslated — it is untranslated, which is a different
// and honest state. `docs/METRICS.md` and the gap list both say so.
//
// Keys are namespaced by where they appear and read as what they say, so a
// grep for a phrase on a screen finds the entry.
// ---------------------------------------------------------------------------

import type { Dictionary } from "./core";

export const en: Dictionary = {
  "lang.label": "Language",

  "portal.tab.home": "Home",
  "portal.tab.inbox": "Inbox",
  "portal.tab.training": "Training",
  "portal.tab.rota": "My rota",
  "portal.tab.leave": "Leave",
  "portal.tab.report": "Report",
  "portal.tab.checks": "Checks",
  "portal.tab.rooms": "Rooms",
  "portal.reportsTo": "reports to {name}",

  "portal.signOut": "Sign out",
  "portal.loading": "Loading…",

  "portal.clock.in": "Clock in",
  "portal.clock.out": "Clock out",
  "portal.clock.since": "Clocked in since {time}",
  "portal.clock.notIn": "Not clocked in",

  "portal.leave.title": "Leave",
  "portal.leave.daysLeft": "days left",
  "portal.leave.taken": { one: "{count} day taken", other: "{count} days taken" },
  "portal.leave.pending": {
    one: "{count} day awaiting a decision",
    other: "{count} days awaiting a decision",
  },
  "portal.leave.ofAllowance": "of {allowance}",
  "portal.leave.carried": "includes {days} carried from last year",
  "portal.leave.carriedUntil": "includes {days} carried from last year, until {date}",
  "portal.leave.used": "{name}: {count} days used",
  "portal.leave.request": "Ask for leave",

  "portal.shift.next": "Next shift",
  "portal.shift.none": "Nothing rostered",
  "portal.documents.unread": { one: "{count} unread", other: "{count} unread" },
  "portal.documents.toSign": {
    one: "{count} to acknowledge",
    other: "{count} to acknowledge",
  },
  "portal.training.outstanding": {
    one: "{count} course outstanding",
    other: "{count} courses outstanding",
  },
  "portal.requests.open": { one: "{count} open", other: "{count} open" },
  "portal.requests.new": "Raise a request",
};

/*
 * Indonesian.
 *
 * `sif` rather than `shift` because that is what a Balinese kitchen says, and
 * `cuti` for leave because it is the word on the form the government expects.
 * Where the two languages name a thing differently, the Indonesian name wins
 * here — translating the English word back into Indonesian produces a phrase
 * nobody uses.
 *
 * No plural forms: Indonesian does not inflect for number, so each count
 * carries one wording. `core.ts` knows that and never asks for `one`.
 */
export const id: Dictionary = {
  "lang.label": "Bahasa",

  "portal.tab.home": "Beranda",
  "portal.tab.inbox": "Kotak masuk",
  "portal.tab.training": "Pelatihan",
  "portal.tab.rota": "Jadwal saya",
  "portal.tab.leave": "Cuti",
  "portal.tab.report": "Lapor",
  "portal.tab.checks": "Pemeriksaan",
  "portal.tab.rooms": "Kamar",
  "portal.reportsTo": "melapor kepada {name}",

  "portal.signOut": "Keluar",
  "portal.loading": "Memuat…",

  "portal.clock.in": "Absen masuk",
  "portal.clock.out": "Absen keluar",
  "portal.clock.since": "Absen masuk sejak {time}",
  "portal.clock.notIn": "Belum absen masuk",

  "portal.leave.title": "Cuti",
  "portal.leave.daysLeft": "hari tersisa",
  "portal.leave.taken": { other: "{count} hari diambil" } as never,
  "portal.leave.pending": { other: "{count} hari menunggu keputusan" } as never,
  "portal.leave.ofAllowance": "dari {allowance}",
  "portal.leave.carried": "termasuk {days} sisa tahun lalu",
  "portal.leave.carriedUntil": "termasuk {days} sisa tahun lalu, sampai {date}",
  "portal.leave.used": "{name}: {count} hari terpakai",
  "portal.leave.request": "Ajukan cuti",

  "portal.shift.next": "Sif berikutnya",
  "portal.shift.none": "Tidak ada jadwal",
  "portal.documents.unread": { other: "{count} belum dibaca" } as never,
  "portal.documents.toSign": { other: "{count} perlu konfirmasi" } as never,
  "portal.training.outstanding": { other: "{count} pelatihan belum selesai" } as never,
  "portal.requests.open": { other: "{count} terbuka" } as never,
  "portal.requests.new": "Buat permintaan",
};

export const dictionaries = { en, id };
