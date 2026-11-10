// ---------------------------------------------------------------------------
// The venue's own mark
// ---------------------------------------------------------------------------
// 0128. `organizations.logo_path` holds where the file is, inside a private
// `branding` bucket, and the client asks for a signed URL when it needs one.
//
// Storing the URL instead would have stored something that expires, and the
// first person to notice would have been whoever printed a report with a
// broken image on it — a month after the upload, with nothing on the screen
// connecting the two.
//
// Every write here is refused for anybody but an administrator of the venue,
// by the bucket's policies and by the column's, and that is where the rule
// lives. Nothing in this file decides who may do what; the UI hides the
// controls as a courtesy, and the database is what makes it true.
// ---------------------------------------------------------------------------

import { requireSupabase } from "@/lib/supabase";
import { fail } from "./_shared";

/** What the bucket accepts. Stated here too, so the refusal is in words. */
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const LOGO_MAX_BYTES = 512 * 1024;

const BUCKET = "branding";

/** An hour: long enough to open a print view, read it and print it. */
const SIGNED_FOR_SECONDS = 3600;

async function currentOrgId(): Promise<string | null> {
  const { data } = await requireSupabase().rpc("auth_default_org_id");
  return (data as string | null) ?? null;
}

/**
 * The venue's logo as something an `<img>` can show, or null.
 *
 * Null for every ordinary reason — no logo set, no venue, no database — so a
 * caller renders nothing rather than a broken image. A venue that has never
 * uploaded one is not an error state.
 */
export async function fetchLogoUrl(): Promise<string | null> {
  const db = requireSupabase();
  const orgId = await currentOrgId();
  if (!orgId) return null;
  const { data, error } = await db
    .from("organizations").select("logo_path").eq("id", orgId).maybeSingle();
  if (error) fail("fetchLogoUrl", error);
  const path = (data as { logo_path?: string | null } | null)?.logo_path;
  if (!path) return null;
  const signed = await db.storage.from(BUCKET)
    .createSignedUrl(path, SIGNED_FOR_SECONDS);
  // A path that no longer has a file behind it is a venue with no logo, not a
  // failure: the row and the object can only be removed one at a time.
  return signed.error ? null : signed.data.signedUrl;
}

/**
 * Replace the venue's logo.
 *
 * `upsert`, and the path carries the extension rather than a name the caller
 * chooses: one logo per venue, at a predictable place, so uploading a second
 * one cannot leave the first behind as an orphan nobody can see or delete.
 */
export async function uploadLogo(file: File): Promise<void> {
  const db = requireSupabase();
  const orgId = await currentOrgId();
  if (!orgId) throw new Error("No venue is selected.");

  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) {
    throw new Error("A logo has to be a PNG, JPEG or WebP image.");
  }
  if (file.size > LOGO_MAX_BYTES) {
    throw new Error(
      `That file is ${Math.round(file.size / 1024)} KB. The limit is ${LOGO_MAX_BYTES / 1024} KB — ` +
        "a logo is printed about two centimetres wide.",
    );
  }

  const extension = file.type === "image/png" ? "png"
    : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${orgId}/logo.${extension}`;

  const { error: uploadError } = await db.storage.from(BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) fail("uploadLogo", uploadError);

  /*
   * The row last. If the column were written first and the upload then
   * failed, every surface would point at a file that does not exist — and
   * `fetchLogoUrl` would quietly return null, so the venue would see no logo
   * and no error either.
   */
  const { error } = await db.from("organizations")
    .update({ logo_path: path }).eq("id", orgId);
  if (error) fail("uploadLogo(record)", error);

  // Any logo in another format is now unreachable. Removed rather than left,
  // since only an administrator can ever delete it and they have no screen
  // that lists it.
  const stale = ["png", "jpg", "webp"]
    .map((e) => `${orgId}/logo.${e}`)
    .filter((p) => p !== path);
  await db.storage.from(BUCKET).remove(stale);
}

/** Take the logo off. The documents fall back to the venue's name in text. */
export async function removeLogo(): Promise<void> {
  const db = requireSupabase();
  const orgId = await currentOrgId();
  if (!orgId) return;
  const { error } = await db.from("organizations")
    .update({ logo_path: null }).eq("id", orgId);
  if (error) fail("removeLogo", error);
  await db.storage.from(BUCKET)
    .remove(["png", "jpg", "webp"].map((e) => `${orgId}/logo.${e}`));
}
