-- ---------------------------------------------------------------------------
-- Every venue gets its starting data — including the ones created tomorrow
-- ---------------------------------------------------------------------------
-- 0038 and 0039 each fixed one instance of the same defect. This fixes the
-- class.
--
-- Seven migrations seed starting data with `insert ... select ... from
-- organizations`. That runs once, over the organisations that exist at the
-- moment the migration is applied — and on a database built from its own
-- migrations, that is none, because migrations run before anybody has signed
-- up. Every venue created afterwards gets nothing either.
--
-- Rebuilding from empty made the scale of it visible. Zero cost centres, zero
-- approval policies, zero matching tolerances, zero budgets, zero tax rates,
-- zero message channels, zero leave types, zero onboarding checklists. Several
-- of those are not cosmetic: with no approval policy, nothing needs approving;
-- with no matching tolerance, three-way matching has nothing to compare
-- against.
--
-- The defaults now live in functions, called for every existing organisation
-- and by one trigger for every new one. All are idempotent and none overwrites
-- a value a venue has changed — a kitchen that set its own tax rate keeps it.
--
-- The rule this establishes: starting data belongs in a function called on
-- organisation creation, never in a bare INSERT in a migration body.
-- ---------------------------------------------------------------------------

create or replace function public.seed_purchasing_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Who may approve what. Without these, nothing needs approving at all.
  insert into public.approval_policies (org_id, document_type, min_amount, required_role)
  select p_org, d.t, v.amt, v.role::public.org_role
  from (values ('REQUISITION'), ('PURCHASE_ORDER')) as d(t)
  cross join (values (0, 'CHEF'), (5000000, 'ADMIN'), (25000000, 'OWNER')) as v(amt, role)
  on conflict do nothing;

  insert into public.cost_centres (org_id, code, name)
  select p_org, c.code, c.name
  from (values ('KITCHEN', 'Kitchen'), ('BAR', 'Bar'), ('FOH', 'Front of house')) as c(code, name)
  on conflict do nothing;

  -- Three-way matching compares against these. With no row, an invoice has no
  -- tolerance to be inside or outside of.
  insert into public.matching_tolerances (org_id) values (p_org)
  on conflict do nothing;

  insert into public.budgets (org_id, cost_centre_id, name, period_start, period_end, amount)
  select c.org_id, c.id,
         'FY' || extract(year from current_date)::text || ' ' || c.name,
         date_trunc('year', current_date)::date,
         (date_trunc('year', current_date) + interval '1 year - 1 day')::date,
         case c.code when 'KITCHEN' then 2000000000
                     when 'BAR' then 800000000
                     else 200000000 end
  from public.cost_centres c
  where c.org_id = p_org
  on conflict do nothing;
end;
$$;

create or replace function public.seed_tax_and_channels(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A starting point, not an answer: every rate here is editable, and a venue
  -- sets its own member state's reduced rate.
  insert into public.tax_rates (org_id, name, percent, is_default, note)
  select p_org, v.name, v.pct, v.def, v.note
  from (values
    ('Standard', 21.0, true,  'Applies where nothing more specific does. Alcohol is usually standard-rated.'),
    ('Reduced',  21.0, false, 'Most EU member states reduce restaurant food. Set this to your state''s rate.'),
    ('Zero',      0.0, false, 'Where a supply is zero-rated or outside scope.')
  ) as v(name, pct, def, note)
  on conflict do nothing;

  insert into public.message_channels (org_id, kind, name, enabled, config)
  select p_org, c.kind, c.name, c.kind = 'IN_APP', c.cfg::jsonb
  from (values
    ('IN_APP',   'In the app',  '{}'),
    ('WHATSAPP', 'WhatsApp Business', '{"phone_number_id":"","template":"ccos_notification","default_recipient":null}'),
    ('EMAIL',    'Email',       '{"from":"","default_recipient":null}')
  ) as c(kind, name, cfg)
  on conflict do nothing;
end;
$$;

create or replace function public.seed_people_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.departments (org_id, code, name, cost_centre_id)
  select p_org, d.code, d.name, c.id
  from (values ('KITCHEN','Kitchen'), ('BAR','Bar'), ('SERVICE','Service'), ('ADMIN','Administration')) as d(code,name)
  left join public.cost_centres c on c.org_id = p_org and c.code = d.code
  on conflict do nothing;

  -- The same five 0023 defines. Where 0023 already ran against a venue this
  -- does nothing; the annual entitlement is the Directive 2003/88/EC minimum
  -- of four weeks, which a venue raises to its own contract.
  insert into public.leave_types
    (org_id, code, name, paid, annual_entitlement_days, max_carryover_days)
  select p_org, t.code, t.name, t.paid, t.days, t.carry
  from (values
    ('ANNUAL',   'Annual leave',     true,  20,   5),
    ('SICK',     'Sick leave',       true,  null, null),
    ('UNPAID',   'Unpaid leave',     false, null, null),
    ('PARENTAL', 'Parental leave',   true,  null, null),
    ('LIEU',     'Time off in lieu', true,  null, null)
  ) as t(code, name, paid, days, carry)
  on conflict do nothing;
end;
$$;

/*
 * One place that knows what a new venue needs.
 *
 * Calling the existing seeders too, so there is a single answer to "what does
 * an organisation start with" rather than four triggers nobody can enumerate.
 */
create or replace function public.seed_organization_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_venue_parameters(p_org);
  perform public.seed_purchasing_defaults(p_org);
  perform public.seed_tax_and_channels(p_org);
  perform public.seed_people_defaults(p_org);
  perform public.seed_haccp_forms(p_org);
end;
$$;

create or replace function public.seed_organization_on_create()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_organization_defaults(new.id);
  return new;
end;
$$;

-- Replaces the two single-purpose triggers with one, so the set of defaults is
-- readable in one place.
drop trigger if exists organizations_seed_parameters on organizations;
drop trigger if exists organizations_seed_haccp on organizations;
drop trigger if exists organizations_seed_defaults on organizations;
create trigger organizations_seed_defaults
  after insert on organizations
  for each row execute function public.seed_organization_on_create();

do $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.seed_organization_defaults(o.id);
  end loop;
end $$;

comment on function public.seed_organization_defaults(uuid) is
  'Everything a new venue starts with. Idempotent; never overwrites a changed value.';
