-- ---------------------------------------------------------------------------
-- A request can be photographed, and a venue starts with somewhere to send one
-- ---------------------------------------------------------------------------
-- The second half of 0066, in its own file for one reason that is not taste:
-- `alter type ... add value` cannot be followed by a *use* of the new value in
-- the same transaction, and Supabase runs each migration in one. 0066 adds
-- `REQUEST` to `attachment_parent`; everything that mentions it is here.
--
-- What this is really testing is 0059's claim. That migration chose a
-- polymorphic attachment — one table with a parent type and a parent id —
-- over a foreign key per parent, and justified the lost foreign key by saying
-- the list would grow as departments arrived: "the next departments arrive as
-- data and share one front door, so the list grows." This is the first growth.
-- It cost four function bodies and a retention default, with no change to the
-- storage policies, the bucket, the size caps or the append-only rule. The
-- alternative shape would have cost an ALTER of a table two row-level-security
-- policies read.
-- ---------------------------------------------------------------------------

-- ── The photograph attaches to the report ───────────────────────────────────

/*
 * REQUESTS, not the receiving department's section.
 *
 * A photograph of a leaking tap is part of the report, and the report is
 * readable by the whole venue — the raiser has to be able to see what they
 * sent. Scoping the picture to Maintenance would hide it from the porter who
 * took it, which is the one person certain to want it back.
 */
create or replace function public.attachment_parent_section(p_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'WORK_ORDER'     then 'MAINTENANCE'
    when 'HACCP_RECORD'   then 'HYGIENE'
    when 'STOCK_MOVEMENT' then 'INVENTORY'
    when 'REQUEST'        then 'REQUESTS'
  end;
$$;

create or replace function public.attachment_parent_org(p_type text, p_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case p_type
    when 'WORK_ORDER'     then (select w.org_id from public.work_orders w where w.id = p_id)
    when 'HACCP_RECORD'   then (select h.org_id from public.haccp_records h where h.id = p_id)
    when 'STOCK_MOVEMENT' then (select m.org_id from public.stock_movements m where m.id = p_id)
    when 'REQUEST'        then (select r.org_id from public.requests r where r.id = p_id)
  end;
$$;

/*
 * Still SECURITY INVOKER, which is the one thing about this worth reading
 * twice: the parent table's own policy answers, so the attachment and the
 * record it illustrates cannot drift apart. `requests` is readable by anybody
 * in the venue, so its photographs are too — deliberately, and it is the only
 * parent of the four for which that is true.
 */
create or replace function public.can_see_attachment(p_type text, p_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    case p_type
      when 'WORK_ORDER'     then exists (select 1 from public.work_orders w where w.id = p_id)
      when 'HACCP_RECORD'   then exists (select 1 from public.haccp_records h where h.id = p_id)
      when 'STOCK_MOVEMENT' then exists (select 1 from public.stock_movements m where m.id = p_id)
      when 'REQUEST'        then exists (select 1 from public.requests r where r.id = p_id)
    end, false);
$$;

/*
 * And attaching needs what writing to the parent needs.
 *
 * For a request that is deliberately *not* the receiving department's grant:
 * the person photographing the tap is the one reporting it, and 0066 made
 * raising open to the venue for exactly that reason. So a request's attachment
 * asks only that the caller may write at this venue at all, which is the same
 * question raising the request asked.
 */
create or replace function public.can_attach_to(p_type text, p_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.can_see_attachment(p_type, p_id)
     and public.auth_can_write(public.attachment_parent_org(p_type, p_id))
     and (p_type = 'REQUEST'
          or public.can_write_section(
               public.attachment_parent_section(p_type),
               public.attachment_parent_org(p_type, p_id)));
$$;

/*
 * Two years, which is the work-order figure rather than the food-safety one.
 *
 * A request is evidence of an operational conversation — it was reported, it
 * was ignored for three days, it was fixed. That supports an insurer's
 * question and a manager's, and is of no interest after the second audit. A
 * request that *became* a work order has its own photographs on the job.
 */
create or replace function public.seed_media_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.attachment_retention (org_id, parent_type, kind, keep_days)
  values
    (p_org, 'WORK_ORDER',     'IMAGE', 1095),
    (p_org, 'WORK_ORDER',     'VIDEO', 90),
    (p_org, 'HACCP_RECORD',   'IMAGE', 1825),
    (p_org, 'HACCP_RECORD',   'VIDEO', 180),
    (p_org, 'STOCK_MOVEMENT', 'IMAGE', 730),
    (p_org, 'STOCK_MOVEMENT', 'VIDEO', 90),
    (p_org, 'REQUEST',        'IMAGE', 730),
    (p_org, 'REQUEST',        'VIDEO', 90)
  on conflict (org_id, parent_type, kind) do nothing;
end;
$$;

do $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.seed_media_defaults(o.id);
  end loop;
end $$;

-- ── What a venue starts with ────────────────────────────────────────────────
/*
 * Five kinds, chosen to be the five shapes Part C named rather than a guess at
 * what a venue wants. Each points at a department that every venue has from
 * `seed_business_units`, so the list works on a venue that has added nothing.
 *
 * A venue that adds Security gets to add "Security incident" itself, which is
 * the Part C claim stated as starting data: the kinds are rows, the departments
 * are rows, and neither needs a programmer.
 */
create or replace function public.seed_request_types(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.request_types
    (org_id, code, name, description, to_unit_id, default_priority,
     respond_within_hours, becomes)
  select p_org, t.code, t.name, t.descr,
         (select b.id from public.business_units b
           where b.org_id = p_org and lower(b.code) = lower(t.unit)),
         t.prio::public.work_order_priority, t.hours, t.becomes
    from (values
      ('FAULT', 'Something is broken',
       'A tap, a light, a fridge. Goes to whoever keeps the building working.',
       'ADMIN', 'HIGH', 4, 'WORK_ORDER'),
      ('SUPPLY', 'We have run out',
       'Something the department needs that is not on an order yet.',
       'ADMIN', 'NORMAL', 24, null),
      ('GUEST', 'A guest is unhappy',
       'A complaint that needs somebody to answer it today.',
       'FOH', 'HIGH', 2, null),
      ('CLEAN', 'Somewhere needs cleaning',
       'Outside the normal schedule — a spill, a blocked drain, a smell.',
       'ADMIN', 'NORMAL', 8, null),
      ('PEOPLE', 'We are short-handed',
       'A department asking for somebody, for a shift or for good.',
       'ADMIN', 'NORMAL', 48, null)
    ) as t(code, name, descr, unit, prio, hours, becomes)
   where exists (select 1 from public.business_units b
                  where b.org_id = p_org and lower(b.code) = lower(t.unit))
     and not exists (select 1 from public.request_types r
                      where r.org_id = p_org and lower(r.code) = lower(t.code));
end;
$$;

insert into organization_seeders (ordinal, function_name, note)
values (45, 'seed_request_types', 'The five shapes Part C named. 0067.')
on conflict (ordinal) do nothing;

do $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.seed_request_types(o.id);
  end loop;
end $$;

-- ── Turning one into a job ──────────────────────────────────────────────────
/*
 * A request becomes a work order, in one transaction, keeping both.
 *
 * Two inserts from the browser leave a window in which a request says it was
 * converted and the job does not exist — and the request is the thing somebody
 * is watching, so the window is visible to exactly the wrong person. Same
 * argument as `record_production` in 0060.
 *
 * SECURITY INVOKER: the caller needs Requests on the receiving department to
 * move the request, and Maintenance to raise the job. Running this as its
 * owner would hand both to anybody who could call it.
 */
create or replace function public.convert_request_to_work_order(
  p_request uuid,
  p_note text default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  r record;
  job uuid;
begin
  select * into r from public.requests where id = p_request;
  if r is null then
    raise exception 'there is no such request';
  end if;
  if r.converted_id is not null then
    raise exception 'that request is already %', r.converted_type
      using hint = 'Open the job it became rather than raising a second one.';
  end if;
  if r.status in ('CLOSED', 'REJECTED') then
    raise exception 'a request that is % cannot be turned into a job', lower(r.status::text);
  end if;

  insert into public.work_orders
    (org_id, title, detail, location_id, priority, raised_by_email, source)
  values
    (r.org_id, r.title,
     coalesce(r.detail, '') ||
       case when p_note is null then '' else E'\n\n' || p_note end ||
       E'\n\nRaised as ' || r.reference,
     r.location_id, r.priority, r.raised_by_email, 'REACTIVE')
  returning id into job;

  update public.requests
     set status = 'IN_PROGRESS',
         converted_type = 'WORK_ORDER',
         converted_id = job,
         resolution = coalesce(p_note, 'Turned into a maintenance job')
   where id = p_request;

  return job;
end;
$$;

grant execute on function public.convert_request_to_work_order(uuid, text) to authenticated;

-- ── What the screens read ───────────────────────────────────────────────────

/*
 * The board: everything open, with how long it has been waiting and whether
 * anybody has answered.
 *
 * `security_invoker`, so the caller's own organisation scope applies.
 */
create or replace view request_board with (security_invoker = true) as
  select
    r.id,
    r.org_id,
    r.reference,
    r.title,
    r.detail,
    r.status,
    r.priority,
    r.business_unit_id,
    b.code as unit_code,
    b.name as unit_name,
    t.code as kind_code,
    t.name as kind_name,
    r.raised_by_email,
    rb.name as raised_from_unit,
    l.name as location_name,
    r.owner_employee_id,
    e.first_name || ' ' || e.last_name as owner_name,
    r.created_at,
    r.acknowledged_at,
    r.resolved_at,
    r.respond_by,
    r.resolution,
    r.converted_type,
    r.converted_id,
    -- Hours, to one decimal, because "two days" and "two days and a half" are
    -- different conversations with whoever raised it.
    round(extract(epoch from (now() - r.created_at)) / 3600.0, 1) as hours_open,
    /*
     * Late is a fact about the clock and the promise, and it is null where no
     * promise was made. A request of a kind with no response time is not
     * on time — there is nothing to be on time against, and reporting it as
     * on time is the system agreeing with itself.
     */
    case
      when r.respond_by is null then null
      when r.acknowledged_at is not null then r.acknowledged_at > r.respond_by
      else now() > r.respond_by
    end as answered_late
  from public.requests r
  join public.business_units b on b.id = r.business_unit_id
  join public.request_types t on t.id = r.request_type_id
  left join public.business_units rb on rb.id = r.raised_from_unit_id
  left join public.locations l on l.id = r.location_id
  left join public.employees e on e.id = r.owner_employee_id;

grant select on request_board to authenticated;

/*
 * One line per department: what is waiting on them, and what they are late on.
 *
 * This is the row a department's tile on the overview screen reads, which is
 * the other Part C bullet still open. Built here because the question is about
 * requests, not about dashboards.
 */
create or replace view request_load with (security_invoker = true) as
  select
    b.org_id,
    b.id as business_unit_id,
    b.code as unit_code,
    b.name as unit_name,
    count(*) filter (where r.status not in ('CLOSED', 'REJECTED')) as open_count,
    count(*) filter (where r.status = 'NEW') as unanswered_count,
    count(*) filter (where r.status = 'NEW' and r.respond_by is not null
                       and now() > r.respond_by) as overdue_count,
    count(*) filter (where r.priority = 'EMERGENCY'
                       and r.status not in ('CLOSED', 'REJECTED')) as emergency_count,
    max(r.created_at) filter (where r.status = 'NEW') as oldest_unanswered_at
  from public.business_units b
  left join public.requests r on r.business_unit_id = b.id
  where b.org_id in (select public.auth_org_ids())
  group by b.org_id, b.id, b.code, b.name;

grant select on request_load to authenticated;

comment on table requests is
  'The shared front door. Anybody may raise one; the receiving department answers it.';
comment on column requests.business_unit_id is
  'Copied off the type when raised, never read through it: re-pointing a type must not rewrite where last month''s requests went.';
comment on view request_board is
  'Everything raised, with how long it has waited. "Late" is null where no response time was promised.';
comment on view request_load is
  'One line per department, for its tile: open, unanswered, overdue, emergencies.';
