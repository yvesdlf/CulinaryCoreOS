-- ---------------------------------------------------------------------------
-- Hygiene templates a venue can bring its own copy of
-- ---------------------------------------------------------------------------
-- Two things, both about the same table.
--
-- First, the same one-off seed defect 0038 fixed for parameters. The twenty-four
-- control sheets in 0035 were inserted with a SELECT over the organisations
-- that existed when the migration ran, and migrations run before any
-- organisation exists — so a database rebuilt from its own migrations came up
-- with an empty Hygiene page, and any venue created later had no forms at all.
-- Same fix: the defaults live in a function, called on organisation creation
-- and for everything already there.
--
-- Second, `fields` has been on this table since 0035 and nothing has ever
-- written to it. Every form asked for one free-text reading and a tick box
-- marked "something was outside its limit" — which is exactly the judgement a
-- control sheet exists to take away from a tired cook at eleven at night. A
-- form that carries its own fields and their limits can decide for itself: a
-- chiller log that knows 5 °C is the limit flags 9,2 °C whether or not anybody
-- ticks anything.
--
-- The seeded forms are given their fields here. Uploaded templates carry their
-- own, which is the point of letting a venue upload one.
-- ---------------------------------------------------------------------------

-- The outstanding view never selected `fields`, so a form's own layout could
-- not reach the screen that fills it in.
create or replace view haccp_outstanding as
  select
    f.id as form_id,
    f.org_id,
    f.code,
    f.section,
    f.title,
    f.frequency,
    f.is_ccp,
    (select max(r.covers_date) from public.haccp_records r where r.form_id = f.id)
      as last_completed,
    current_date - coalesce(
      (select max(r.covers_date) from public.haccp_records r where r.form_id = f.id),
      current_date - 365) as days_since,
    -- Appended rather than placed beside is_ccp where it belongs: replacing a
    -- view can only add columns at the end, and dropping this one to reorder
    -- it would take its grants with it for no gain.
    f.fields
  from public.haccp_forms f
  where f.active and f.org_id in (select public.auth_org_ids());

grant select on haccp_outstanding to authenticated;

-- A template is edited and replaced, not only created, so uploading a revised
-- sheet updates the form of the same code rather than duplicating it.
create unique index if not exists idx_haccp_forms_code
  on haccp_forms(org_id, lower(code));

/*
 * The venue's own sheets, numbered as their paperwork numbers them.
 *
 * Idempotent: a form that already exists is left exactly as it is, because by
 * then it may have been edited or replaced by an uploaded template and this
 * function must never quietly undo that.
 */
create or replace function public.seed_haccp_forms(p_org uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.haccp_forms (org_id, code, section, title, frequency, is_ccp, fields)
  select p_org, f.code, f.section, f.title, f.freq::public.haccp_frequency, f.ccp, f.fields
  from (values
    ('1.1','Facilities','Cleaning Schedule Checklist','WEEKLY',false,
      '[{"label":"Area","type":"text"},
        {"label":"Cleaned and checked","type":"yes_no"},
        {"label":"Signed by","type":"text"}]'::jsonb),
    ('1.2','Facilities','Cleaning Supplies Store Check','WEEKLY',false,
      '[{"label":"Store locked","type":"yes_no"},
        {"label":"Decanted bottles labelled","type":"yes_no"},
        {"label":"Signed by","type":"text"}]'::jsonb),
    ('2.1','Personal Hygiene','Grooming Standard Acknowledgement','ANNUAL',false,
      '[{"label":"Employee","type":"text"},
        {"label":"Standard read and understood","type":"yes_no"}]'::jsonb),
    ('2.2','Personal Hygiene','Hand Washing Log','PER_SHIFT',false,
      '[{"label":"Employee","type":"text"},
        {"label":"Time","type":"time"}]'::jsonb),
    ('2.3','Personal Hygiene','Steward Grooming Check','DAILY',false,
      '[{"label":"Employee","type":"text"},
        {"label":"Clean uniform","type":"yes_no"},
        {"label":"No jewellery","type":"yes_no"},
        {"label":"Fit to work","type":"yes_no"}]'::jsonb),
    -- Reg 852/2004 requires cooking to a temperature that makes food safe;
    -- 75 °C at the core is the figure the venue's own HACCP plan uses.
    ('3.1','Temperature','Cook & Reheat Temperature Record','PER_SHIFT',true,
      '[{"label":"Dish","type":"text"},
        {"label":"Core temperature","type":"number","unit":"°C","min":75},
        {"label":"Time","type":"time"}]'::jsonb),
    -- Cooled from 63 °C to 10 °C within 90 minutes; the record is the last
    -- reading, which must be at or below 10 °C.
    ('3.2','Temperature','Cooling Temperature Record','PER_SHIFT',true,
      '[{"label":"Dish","type":"text"},
        {"label":"Temperature at start","type":"number","unit":"°C"},
        {"label":"Temperature after 90 minutes","type":"number","unit":"°C","max":10},
        {"label":"Time started","type":"time"}]'::jsonb),
    ('3.3','Temperature','Defrosting Record','DAILY',true,
      '[{"label":"Item","type":"text"},
        {"label":"Defrosting temperature","type":"number","unit":"°C","min":0,"max":5},
        {"label":"Date started","type":"date"}]'::jsonb),
    ('3.4','Temperature','Dry Ager Temperature & Humidity','DAILY',true,
      '[{"label":"Temperature","type":"number","unit":"°C","min":0,"max":3},
        {"label":"Humidity","type":"number","unit":"%","min":75,"max":85}]'::jsonb),
    ('3.5','Temperature','Food Transfer Traceability','DAILY',false,
      '[{"label":"Item","type":"text"},
        {"label":"From","type":"text"},
        {"label":"To","type":"text"},
        {"label":"Temperature on arrival","type":"number","unit":"°C","max":5}]'::jsonb),
    -- Acidified sushi rice: pH 4,6 or below is what makes it safe at ambient.
    ('3.6','Temperature','Sushi Rice pH Record','PER_SHIFT',true,
      '[{"label":"Batch","type":"text"},
        {"label":"pH","type":"number","unit":"pH","max":4.6},
        {"label":"Time made","type":"time"}]'::jsonb),
    ('3.7','Temperature','Temperature Monitoring','PER_SHIFT',true,
      '[{"label":"Walk-in chiller","type":"number","unit":"°C","min":0,"max":5},
        {"label":"Larder fridge","type":"number","unit":"°C","min":0,"max":5},
        {"label":"Bar fridge","type":"number","unit":"°C","min":0,"max":5},
        {"label":"Freezer","type":"number","unit":"°C","max":-18}]'::jsonb),
    ('4.1','HACCP System','HACCP Team Member Register','ANNUAL',false,
      '[{"label":"Member","type":"text"},
        {"label":"Role on the team","type":"text"},
        {"label":"Training current","type":"yes_no"}]'::jsonb),
    ('4.2','HACCP System','CCP Monitoring Record','DAILY',true,
      '[{"label":"Control point","type":"text"},
        {"label":"Reading","type":"number"},
        {"label":"Within limits","type":"yes_no"}]'::jsonb),
    ('4.3','HACCP System','Food Area Visitor Form','AS_NEEDED',false,
      '[{"label":"Visitor","type":"text"},
        {"label":"Company","type":"text"},
        {"label":"Briefed on hygiene rules","type":"yes_no"},
        {"label":"Time in","type":"time"}]'::jsonb),
    ('4.4','HACCP System','Food Recall Record','AS_NEEDED',true,
      '[{"label":"Product","type":"text"},
        {"label":"Lot or batch","type":"text"},
        {"label":"Quantity affected","type":"number"},
        {"label":"Authority notified","type":"yes_no"}]'::jsonb),
    ('4.5','HACCP System','Non-Conformity Record','AS_NEEDED',false,
      '[{"label":"What was found","type":"text"},
        {"label":"Raised by","type":"text"}]'::jsonb),
    ('4.6','HACCP System','Planning of Change','AS_NEEDED',false,
      '[{"label":"Change proposed","type":"text"},
        {"label":"Effect on the HACCP plan","type":"text"}]'::jsonb),
    ('4.7','HACCP System','Food Waiver Form','AS_NEEDED',false,
      '[{"label":"Item","type":"text"},
        {"label":"Reason","type":"text"},
        {"label":"Authorised by","type":"text"}]'::jsonb),
    ('5.1','Allergens','Allergen Testing Log','MONTHLY',true,
      '[{"label":"Surface or item tested","type":"text"},
        {"label":"Allergen","type":"text"},
        {"label":"Result negative","type":"yes_no"}]'::jsonb),
    ('5.2','Allergens','Menu Allergen Matrix Review','QUARTERLY',true,
      '[{"label":"Dishes reviewed","type":"number"},
        {"label":"Matrix matches the recipes","type":"yes_no"},
        {"label":"Reviewed by","type":"text"}]'::jsonb),
    ('6.1','Chemicals','Chemical Inventory','MONTHLY',false,
      '[{"label":"Chemical","type":"text"},
        {"label":"Quantity","type":"number"},
        {"label":"Safety data sheet held","type":"yes_no"}]'::jsonb),
    ('6.2','Chemicals','Chemical List & Usage','QUARTERLY',false,
      '[{"label":"Chemical","type":"text"},
        {"label":"Used for","type":"text"},
        {"label":"Dilution","type":"text"}]'::jsonb),
    ('6.3','Chemicals','Chemical Store Taking','MONTHLY',false,
      '[{"label":"Chemical","type":"text"},
        {"label":"Counted","type":"number"}]'::jsonb)
  ) as f(code, section, title, freq, ccp, fields)
  on conflict (org_id, lower(code)) do nothing;
$$;

create or replace function public.seed_haccp_forms_on_create()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_haccp_forms(new.id);
  return new;
end;
$$;

drop trigger if exists organizations_seed_haccp on organizations;
create trigger organizations_seed_haccp
  after insert on organizations
  for each row execute function public.seed_haccp_forms_on_create();

do $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.seed_haccp_forms(o.id);
  end loop;
end $$;

-- An uploaded template replaces the form of the same code, so the delete that
-- an edit implies has to be possible. Records already written keep pointing at
-- the form and are unaffected.
grant delete on haccp_forms to authenticated;
create policy haccp_forms_delete on haccp_forms
  for delete to authenticated using (public.auth_can_write(org_id));

comment on function public.seed_haccp_forms(uuid) is
  'The venue''s starting control sheets. Idempotent — never overwrites an edited form.';
comment on column haccp_forms.fields is
  'What the form asks for, with limits. A number outside its limits is a breach.';
