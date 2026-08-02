-- ---------------------------------------------------------------------------
-- Lost-update protection for products
-- ---------------------------------------------------------------------------
-- Recipes and preparations carry a version, and a save that does not match it
-- is refused so the second writer is told rather than silently winning.
-- Products had none, which is the wrong way round: a product is the row two
-- people are most likely to touch at once, because a price import and a chef
-- correcting a pack size are the same kind of routine act.
-- ---------------------------------------------------------------------------

alter table products add column if not exists version int not null default 1;

-- Bumped in the database rather than by the client, so an update that arrives
-- from anywhere — the app, a script, psql — still moves it.
create or replace function public.bump_product_version()
returns trigger
language plpgsql
as $$
begin
  new.version := coalesce(old.version, 0) + 1;
  return new;
end;
$$;

drop trigger if exists products_bump_version on products;
create trigger products_bump_version
  before update on products
  for each row execute function public.bump_product_version();

comment on column products.version is
  'Incremented on every update. A save matching a stale value is refused.';
