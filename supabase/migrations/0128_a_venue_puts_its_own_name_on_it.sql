-- ---------------------------------------------------------------------------
-- A venue puts its own name on it
-- ---------------------------------------------------------------------------
-- Every sheet this app prints says CulinaryCoreOS in the footer and nothing
-- about the venue but its name in text. That is the wrong way round: the
-- costing is ours, the document is theirs, and it goes to an accountant, a
-- landlord or a supplier who has never heard of us.
--
-- ── Four decisions ────────────────────────────────────────────────────────
--
-- 1 · A path, not a URL.
--
--    `logo_path` stores where the file is, and the client asks for a signed
--    URL when it needs one. Storing a URL would store something that expires,
--    and the first time anybody noticed would be a report printed with a
--    broken image on it.
--
-- 2 · The bucket is not public.
--
--    A logo is not a secret — it is on the venue's own shopfront. But a
--    public bucket is a cross-tenant read surface whose contents are
--    enumerable from an organisation id, and 0122 is the migration that
--    exists because this repository had one too many of those. The cost of
--    keeping it private is one signed URL.
--
-- 3 · No SVG.
--
--    The bucket takes PNG, JPEG and WebP. An SVG is not a picture, it is a
--    document: it can carry script and reference things off the page. It is
--    inert inside an `<img>`, which is the only way this is ever rendered —
--    but the destination here is a PDF somebody emails outside the venue, and
--    "safe because of how we happen to render it today" is a thinner promise
--    than "it is a raster image". A venue with only an SVG exports a PNG once.
--
-- 4 · Whoever may change the venue's parameters may change its logo.
--
--    No new rule: `organizations_update` is already `auth_is_admin(id)`, and
--    the logo is a venue parameter like the VAT rate. The storage policy
--    below says the same thing in the other place it has to be said, because
--    a column somebody cannot write and a file they can is not a control.
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column if not exists logo_path text;

comment on column public.organizations.logo_path is
  'Path inside the private `branding` bucket, as <org_id>/logo.<ext>. Null '
  'means no logo and every surface falls back to the venue name in text.';

/*
 * 512 KB. A logo is drawn two centimetres wide on paper; anything larger is
 * a photograph somebody has mistaken for a logo, and it would be embedded in
 * every PDF the venue sends out.
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', false, 524288,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

/*
 * Read: anybody in the venue. The logo appears on screens every member sees
 * and on sheets they print, so gating it by section would mean a chef
 * printing a recipe card without the venue's own mark on it.
 */
drop policy if exists branding_read on storage.objects;
create policy branding_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'branding'
    and public.storage_path_org(name) in (select public.auth_org_ids())
  );

/*
 * Write, change and remove: an administrator of that venue, and only in
 * their own venue's folder. `storage_path_org` returns null for a path that
 * is not shaped `<uuid>/…`, and `auth_is_admin(null)` is not true, so a file
 * dropped at the root of the bucket is refused rather than orphaned.
 */
drop policy if exists branding_write on storage.objects;
create policy branding_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'branding'
    and public.auth_is_admin(public.storage_path_org(name))
  );

drop policy if exists branding_replace on storage.objects;
create policy branding_replace on storage.objects
  for update to authenticated
  using (
    bucket_id = 'branding'
    and public.auth_is_admin(public.storage_path_org(name))
  );

drop policy if exists branding_remove on storage.objects;
create policy branding_remove on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'branding'
    and public.auth_is_admin(public.storage_path_org(name))
  );

/*
 * Audited like the other venue parameters (0126). Who replaced the logo on
 * the venue's invoices, and when, is exactly the kind of question the edit
 * history exists for — and the one surface where a silent change reaches
 * people outside the venue.
 */
insert into public.audited_fields (table_name, column_name)
values ('organizations', 'logo_path')
on conflict do nothing;
