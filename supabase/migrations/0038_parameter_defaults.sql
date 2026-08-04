-- ---------------------------------------------------------------------------
-- Give every venue its parameters, including the ones created tomorrow
-- ---------------------------------------------------------------------------
-- 0036 seeded venue_parameters with a one-off INSERT ... FROM organizations.
-- That covered the organisations that happened to exist the moment the
-- migration ran and nothing since. A venue created afterwards has no target
-- food cost, no waste allowance and no approval thresholds — so its Parameters
-- screen is empty and its purchase orders have no limit to exceed.
--
-- Rebuilding the database from migrations alone made this obvious: migrations
-- run before any organisation exists, so the seed inserted nothing at all and
-- every venue came up with zero parameters.
--
-- The defaults now live in a function, called both for the organisations that
-- exist now and by a trigger for every one created later. Existing values are
-- never overwritten: a venue that has changed its target food cost keeps it.
-- ---------------------------------------------------------------------------

create or replace function public.seed_venue_parameters(p_org uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.venue_parameters
    (org_id, code, name, description, value, unit, min_value, max_value)
  select p_org, p.code, p.name, p.descr, p.val, p.unit, p.lo, p.hi
  from (values
    ('TARGET_FOOD_COST','Target food cost','What a dish should cost as a share of its menu price.',25,'percent',5,60),
    ('FOOD_COST_TOLERANCE','Food cost tolerance','How far from target is acceptable before a dish is flagged.',2,'percent',0,20),
    ('RECIPE_WASTE','Dish waste allowance','Added to a dish''s cost to cover trim and spillage at service.',0,'percent',0,25),
    ('SUB_RECIPE_WASTE','Preparation waste allowance','Added when costing a batch.',5,'percent',0,25),
    ('RECIPE_INFLATION','Dish inflation buffer','Added to cover price movement between costing and service.',4,'percent',0,25),
    ('EXPIRY_WARNING_DAYS','Expiry warning','How many days ahead an expiring lot is flagged.',7,'days',1,90),
    ('CERT_WARNING_DAYS','Certificate warning','How many days ahead a lapsing certificate is flagged.',30,'days',1,180),
    ('PO_APPROVAL_ADMIN','Order approval — administrator','Orders at or above this need an administrator.',5000000,'currency',0,null),
    ('PO_APPROVAL_OWNER','Order approval — owner','Orders at or above this need an owner.',25000000,'currency',0,null)
  ) as p(code, name, descr, val, unit, lo, hi)
  on conflict (org_id, code) do nothing;
$$;

create or replace function public.seed_venue_parameters_on_create()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_venue_parameters(new.id);
  return new;
end;
$$;

drop trigger if exists organizations_seed_parameters on organizations;
create trigger organizations_seed_parameters
  after insert on organizations
  for each row execute function public.seed_venue_parameters_on_create();

-- And for everything that already exists.
do $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.seed_venue_parameters(o.id);
  end loop;
end $$;

comment on function public.seed_venue_parameters(uuid) is
  'Default venue parameters. Idempotent — never overwrites a value a venue has set.';
