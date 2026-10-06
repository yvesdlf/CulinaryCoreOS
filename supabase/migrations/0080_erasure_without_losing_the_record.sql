-- ---------------------------------------------------------------------------
-- 0080 · Erasing a person without erasing the records the law says to keep
-- ---------------------------------------------------------------------------
-- Deleting an employee cascaded into their working time, leave, pay rates and
-- HR cases — records a venue is legally required to keep — and left their
-- email address copied into some sixty `*_email` columns across fifty tables,
-- untouched. It was wrong in both directions at once: it destroyed what must
-- be kept and kept what should go.
--
-- GDPR does not ask for the ledgers to go. Art. 17(3)(b) and (e) exempt
-- records kept under a legal obligation or for legal claims; Art. 5(1)(e)
-- asks that they stop identifying anybody once identity is no longer needed.
-- So the statutory rows now refuse to be deleted with the employee, and a
-- person is anonymised instead: one owner-only function, citing the request
-- it answers, recorded in a ledger of its own.
--
-- Done now because the tables are empty. Changing a cascade later means
-- deciding what to do with rows already deleted by it.
--
-- Not done here, and named in docs as the next step: replacing the copied
-- `*_email` columns with a reference to one `actors` table, so there is one
-- place to anonymise instead of sixty. Until then this function finds the
-- copies by name.
-- ---------------------------------------------------------------------------

create or replace function public.auth_is_owner(org uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
     where m.user_id = (select auth.uid())
       and m.organization_id = org
       and m.role = 'OWNER'
  );
$$;

-- 1 · Statutory records refuse to go with the employee ------------------------

do $$
declare r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tbl, a.attname
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.confrelid = 'public.employees'::regclass
       and c.contype = 'f'
       and c.conrelid in ('public.time_entries'::regclass, 'public.leave_requests'::regclass,
                          'public.pay_rates'::regclass, 'public.hr_cases'::regclass)
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s add constraint %I foreign key (%I)
                      references public.employees(id) on delete restrict',
                   r.tbl, r.conname, r.attname);
  end loop;
end $$;

-- 2 · The ledger of what was erased -------------------------------------------

/*
 * What was done, under which request, and how many rows it touched — never
 * what was removed. Append-only like every other ledger here (AGENTS.md §4):
 * no update or delete grant, and owners only may read it.
 */
create table public.privacy_actions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  action       text not null check (action in ('ANONYMISE_PERSON', 'DELETE_SICK_NOTE')),
  subject      text not null,
  request_ref  text not null check (btrim(request_ref) <> ''),
  rows_touched jsonb not null default '{}'::jsonb,
  done_by      uuid not null,
  done_at      timestamptz not null default now()
);
alter table public.privacy_actions enable row level security;
revoke all on public.privacy_actions from anon, authenticated;
grant select on public.privacy_actions to authenticated;
create policy privacy_actions_read on public.privacy_actions
  for select to authenticated using (public.auth_is_owner(org_id));

/*
 * Files are deleted through the Storage API by a service-role job, not from
 * SQL — the same split `expired_attachments()` uses for media. This is that
 * job's queue.
 */
create table public.storage_deletions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  bucket       text not null,
  path         text not null,
  reason       text not null,
  requested_at timestamptz not null default now(),
  deleted_at   timestamptz
);
alter table public.storage_deletions enable row level security;
revoke all on public.storage_deletions from anon, authenticated;

create sequence public.former_person_seq;

-- 3 · Anonymising a person ------------------------------------------------------

/*
 * Owner only, and a request reference is required: the function's only
 * caller should be somebody answering an erasure request or closing a
 * retention period, and the ledger needs to say which.
 *
 * What it changes: the name becomes "Former employee #n"; contact fields
 * and the account link are cleared; `employee_private` goes; every
 * `*_email` copy of their work or sign-in address becomes a pseudonym; their
 * sick-note files are queued for deletion. What it leaves: every statutory
 * row, now about "Former employee #n". The ledgers are updated here and only
 * here — the one sanctioned exception to append-only, and it runs as the
 * owner rather than by granting anybody update.
 */
create or replace function public.anonymise_person(p_employee uuid, p_request_ref text)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  e record;
  addresses text[];
  n bigint;
  pseudonym_name text;
  pseudonym_email text;
  col record;
  touched jsonb := '{}'::jsonb;
  changed integer;
  hit boolean;
  quiet text[] := array['employees', 'employee_private', 'leave_attachments'];
  tbl text;
begin
  select * into e from public.employees where id = p_employee;
  if e is null then
    raise exception 'no such employee';
  end if;
  if not public.auth_is_owner(e.org_id) then
    raise exception 'only an owner can anonymise a person' using errcode = '42501';
  end if;
  if coalesce(btrim(p_request_ref), '') = '' then
    raise exception 'a request reference is required: the record must say what this answered';
  end if;

  n := nextval('public.former_person_seq');
  pseudonym_name := 'employee #' || n;
  pseudonym_email := 'former-employee-' || n || '@redacted.invalid';

  select array_agg(distinct lower(a)) into addresses
    from unnest(array[
      e.work_email,
      (select u.email from auth.users u where u.id = e.user_id)
    ]) a
   where a is not null and btrim(a) <> '';

  if addresses is not null then
    /*
     * Every column that copies an address — `*_email`, plain `email`, and the
     * outbox's `destination` — in a table that says which venue the row
     * belongs to. Only this venue's rows are touched: the first version of
     * this had no venue filter, and one venue's owner could rewrite another
     * venue's ledgers for any address they named. A table with no venue
     * column is skipped and the skip is recorded, rather than guessed at.
     */
    for col in
      select c.table_name, c.column_name,
             (select v.column_name from information_schema.columns v
               where v.table_schema = 'public' and v.table_name = c.table_name
                 and v.column_name in ('org_id', 'organization_id')
               order by v.column_name desc limit 1) as venue_col
        from information_schema.columns c
        join pg_class k on k.relname = c.table_name
                       and k.relnamespace = 'public'::regnamespace and k.relkind = 'r'
       where c.table_schema = 'public'
         and c.data_type = 'text'
         and (c.column_name like '%\_email' or c.column_name = 'email'
              or (c.table_name = 'message_deliveries' and c.column_name = 'destination'))
    loop
      if col.venue_col is null then
        touched := touched || jsonb_build_object('skipped, no venue column: ' || col.table_name, 0);
        continue;
      end if;
      execute format('select exists (select 1 from public.%I where %I = $1 and lower(%I) = any ($2))',
                     col.table_name, col.venue_col, col.column_name)
        into hit using e.org_id, addresses;
      continue when not hit;
      /*
       * The rows that hold an address are mostly closed: a clocked-out time
       * entry, decided leave, a signed-off review. Their guards refuse any
       * edit, rightly — for everybody but this function. So this function
       * switches off the user triggers on the tables it touches, inside its
       * own transaction: foreign keys and RLS still apply, nothing else sees
       * the gap (the lock is exclusive), and a failure anywhere rolls the
       * switch back with everything else. Possible because the migration
       * role owns the tables, which is also what makes it an owner-only path.
       * The lock covers the table, so other venues wait for it too; this is
       * a rare, owner-initiated operation and the wait is the price of not
       * editing a dozen closed-record guards.
       */
      if not col.table_name = any (quiet) then
        quiet := quiet || col.table_name::text;
      end if;
      execute format('alter table public.%I disable trigger user', col.table_name);
      execute format('update public.%I set %I = $1 where %I = $2 and lower(%I) = any ($3)',
                     col.table_name, col.column_name, col.venue_col, col.column_name)
        using pseudonym_email, e.org_id, addresses;
      get diagnostics changed = row_count;
      if changed > 0 then
        touched := touched || jsonb_build_object(col.table_name || '.' || col.column_name, changed);
      end if;
    end loop;
  end if;

  alter table public.employees         disable trigger user;
  alter table public.employee_private  disable trigger user;
  alter table public.leave_attachments disable trigger user;

  insert into public.storage_deletions (org_id, bucket, path, reason)
  select a.org_id, 'sick-notes', a.file_path, 'anonymised: ' || p_request_ref
    from public.leave_attachments a
    join public.leave_requests l on l.id = a.leave_request_id
   where l.employee_id = p_employee;
  get diagnostics changed = row_count;
  touched := touched || jsonb_build_object('storage_deletions', changed);

  delete from public.leave_attachments a
   using public.leave_requests l
   where l.id = a.leave_request_id and l.employee_id = p_employee;

  delete from public.employee_private where employee_id = p_employee;
  get diagnostics changed = row_count;
  touched := touched || jsonb_build_object('employee_private', changed);

  update public.employees
     set first_name = 'Former', last_name = pseudonym_name,
         work_email = null, work_phone = null, whatsapp_number = null,
         user_id = null, birthday_visible = false
   where id = p_employee;

  foreach tbl in array quiet loop
    execute format('alter table public.%I enable trigger user', tbl);
  end loop;

  insert into public.privacy_actions (org_id, action, subject, request_ref, rows_touched, done_by)
  values (e.org_id, 'ANONYMISE_PERSON', 'Former ' || pseudonym_name, p_request_ref,
          touched, (select auth.uid()));

  return 'Former ' || pseudonym_name;
end;
$$;

-- 4 · Deleting one sick note ----------------------------------------------------

/*
 * Before this, nobody could: no delete grant, no function. A sick note is
 * health data (Art. 9) and the one document an employee is most likely to
 * ask to have removed once it has served its purpose.
 */
create or replace function public.delete_sick_note(p_attachment uuid, p_request_ref text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare a record;
begin
  select * into a from public.leave_attachments where id = p_attachment;
  if a is null then
    raise exception 'no such sick note';
  end if;
  if not public.auth_is_owner(a.org_id) then
    raise exception 'only an owner can delete a sick note' using errcode = '42501';
  end if;
  if coalesce(btrim(p_request_ref), '') = '' then
    raise exception 'a request reference is required';
  end if;

  insert into public.storage_deletions (org_id, bucket, path, reason)
  values (a.org_id, 'sick-notes', a.file_path, 'deleted: ' || p_request_ref);
  delete from public.leave_attachments where id = p_attachment;

  insert into public.privacy_actions (org_id, action, subject, request_ref, rows_touched, done_by)
  -- The attachment's id, not its file name: a file name is often the
  -- person's name, and this ledger is the one record nothing can delete.
  values (a.org_id, 'DELETE_SICK_NOTE', 'sick note ' || a.id, p_request_ref,
          jsonb_build_object('leave_attachments', 1, 'storage_deletions', 1),
          (select auth.uid()));
end;
$$;
