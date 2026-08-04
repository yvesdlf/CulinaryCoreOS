-- ---------------------------------------------------------------------------
-- Files: training material, and sick notes
-- ---------------------------------------------------------------------------
-- Two private buckets. Neither is public, and the difference between them is
-- who may read a file once it is there.
--
--   staff-documents  what HR sends out. Anybody at the venue with People
--                    access can read it, and a member of staff can read the
--                    ones addressed to them.
--
--   sick-notes       a photograph of a doctor's note. This is health data
--                    about a named person, which is a special category under
--                    Article 9 of the GDPR: the lawful basis is employment
--                    obligation, and the corresponding duty is that it is not
--                    readable by "everybody in the organisation". Readable by
--                    the person it belongs to, and by whoever administers
--                    People. Not by their colleagues, and not by their line
--                    manager through this route.
--
-- Both are keyed on the first path segment being the organisation id, so a
-- path is checkable without joining to the row that references it — an object
-- policy that had to look up its own document row would let a file exist in a
-- state nothing could read.
--
--   staff-documents/<org_id>/<document_id>/<filename>
--   sick-notes/<org_id>/<employee_id>/<filename>
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('staff-documents', 'staff-documents', false, 26214400,
   array['application/pdf','image/jpeg','image/png','image/webp',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.openxmlformats-officedocument.presentationml.presentation',
         'text/plain','text/markdown']),
  -- Photographs, because a sick note arrives as a picture of a piece of paper
  -- taken on a phone. 10 MB covers a modern camera without inviting video.
  ('sick-notes', 'sick-notes', false, 10485760,
   array['image/jpeg','image/png','image/heic','image/webp','application/pdf'])
on conflict (id) do nothing;

/** The organisation a storage path belongs to. */
create or replace function public.storage_path_org(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

grant execute on function public.storage_path_org(text) to authenticated;

-- ── staff-documents ─────────────────────────────────────────────────────────

drop policy if exists staff_documents_read on storage.objects;
create policy staff_documents_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'staff-documents'
    and (
      -- Somebody who runs the venue.
      public.storage_path_org(name) in (select public.auth_org_ids())
      -- Or a member of staff, for a document addressed to them. The document
      -- id is the second path segment, which is what ties the file to the row.
      or exists (
        select 1
          from public.staff_document_recipients r
         where r.employee_id = public.auth_employee_id()
           and r.document_id::text = split_part(name, '/', 2)
      )
    )
  );

drop policy if exists staff_documents_write on storage.objects;
create policy staff_documents_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'staff-documents'
    and public.auth_can_write(public.storage_path_org(name))
    and public.can_write_section('PEOPLE', public.storage_path_org(name))
  );

drop policy if exists staff_documents_remove on storage.objects;
create policy staff_documents_remove on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'staff-documents'
    and public.can_write_section('PEOPLE', public.storage_path_org(name))
  );

-- ── sick-notes ──────────────────────────────────────────────────────────────

drop policy if exists sick_notes_read on storage.objects;
create policy sick_notes_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'sick-notes'
    and (
      -- The person it is about. Their employee id is the second segment.
      public.auth_employee_id()::text = split_part(name, '/', 2)
      -- Or whoever administers People. Deliberately not "any member": a
      -- doctor's note is not something the whole venue may read.
      or public.can_write_section('PEOPLE', public.storage_path_org(name))
    )
  );

/*
 * Uploading one is the employee's own act.
 *
 * Restricted to their own folder, so somebody cannot file a note against a
 * colleague. HR may also upload on their behalf — a note handed in on paper
 * still has to get into the system.
 */
drop policy if exists sick_notes_write on storage.objects;
create policy sick_notes_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'sick-notes'
    and (
      public.auth_employee_id()::text = split_part(name, '/', 2)
      or public.can_write_section('PEOPLE', public.storage_path_org(name))
    )
  );

-- No delete policy at all. A sick note is evidence for an absence that was
-- paid; removing it is a records question for an administrator with database
-- access, not a button.

comment on function public.storage_path_org(text) is
  'The organization id from the first segment of a storage path. Null if absent.';
