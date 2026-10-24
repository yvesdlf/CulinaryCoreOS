-- ---------------------------------------------------------------------------
-- Stock is somewhere
-- ---------------------------------------------------------------------------
-- `stock_movements` has an organisation and a business unit and no idea
-- where anything physically is. So "we have 40 kg of beef" is the only
-- answer the system can give, when the question a chef asks at six in the
-- morning is "is it in the walk-in or still in the dry store", and the
-- question a stocktake asks is "what should be on these shelves, in this
-- room, right now".
--
-- Without it a count has to be of everything at once, which is why counts
-- stop happening: nobody shuts a venue to count it. A count of one chiller
-- takes twenty minutes.
--
-- `locations` already exists as a tree (0021, 0024) with kinds for sites,
-- floors, guest rooms and plant. It had no kinds for the places food is
-- actually kept, so those are added here rather than inventing a second
-- table — a walk-in is a location, and hanging it off the outlet it belongs
-- to is what the tree is for.
--
-- The column is nullable and stays nullable. Every movement written before
-- today has no location and inventing one would be a lie; `product_stock`
-- keeps answering the venue-wide question it always answered, and the new
-- view answers the per-room one. A later migration can tighten it once
-- somewhere is actually set up, which is a decision for a venue rather than
-- for this file.
--
-- Transfers are the reason this is more than a column. Moving a case of wine
-- from the cellar to the bar is not a change in how much there is; it is two
-- movements that must both exist or neither, and until now `TRANSFER` was a
-- kind with no way to say where from and where to.
-- ---------------------------------------------------------------------------

alter type location_kind add value if not exists 'STORE_ROOM';
alter type location_kind add value if not exists 'CHILLER';
alter type location_kind add value if not exists 'FREEZER';
alter type location_kind add value if not exists 'DRY_STORE';
alter type location_kind add value if not exists 'BAR_STORE';

alter table stock_movements
  add column if not exists location_id uuid references locations(id) on delete set null,
  /*
   * The other half of a transfer.
   *
   * Both legs carry the same id, so a report can show one line rather than a
   * mysterious pair, and an auditor can see that nothing was created or
   * destroyed in the move.
   */
  add column if not exists transfer_id uuid;

create index if not exists idx_stock_movements_location
  on stock_movements(org_id, location_id, product_id);
create index if not exists idx_stock_movements_transfer
  on stock_movements(transfer_id) where transfer_id is not null;

comment on column stock_movements.location_id is
  'Where it physically moved. Null on every movement written before 0096, and on anything venue-wide.';

/*
 * A movement belongs to one of this venue's own places.
 *
 * `enforce_stock_movement_unit` already does this for the business unit and
 * is extended rather than replaced — it is a small function with one job and
 * the job just grew. The alternative, a second trigger, would run in
 * alphabetical order against the first for no benefit.
 */
create or replace function public.enforce_stock_movement_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.business_unit_id is not null
     and not public.business_unit_in_org(new.business_unit_id, new.org_id)
  then
    raise exception 'that department belongs to another organisation';
  end if;

  if new.location_id is not null
     and not exists (select 1 from public.locations l
                      where l.id = new.location_id and l.org_id = new.org_id)
  then
    raise exception 'that location belongs to another organisation';
  end if;

  return new;
end;
$$;

/*
 * On hand, per place.
 *
 * Alongside `product_stock` rather than instead of it. Everything that asks
 * "how much is there" keeps working, and the rows with no location are
 * reported as such instead of being quietly folded into whichever room
 * sorted first.
 */
create or replace view product_stock_by_location
with (security_invoker = true) as
  select
    m.org_id,
    m.product_id,
    p.name            as product_name,
    m.location_id,
    l.name            as location_name,
    l.kind            as location_kind,
    sum(m.quantity)::numeric(18,5) as on_hand,
    max(m.occurred_at)             as last_movement_at
  from public.stock_movements m
  join public.products p on p.id = m.product_id
  left join public.locations l on l.id = m.location_id
  group by m.org_id, m.product_id, p.name, m.location_id, l.name, l.kind
  having sum(m.quantity) <> 0;

grant select on product_stock_by_location to authenticated;

comment on view product_stock_by_location is
  'On hand per product per place. A null location is shown as such, not folded into a room. See 0096.';

/*
 * Moving stock from one place to another.
 *
 * Two movements in one statement, sharing a `transfer_id`, so there is no
 * window in which the wine has left the cellar and not arrived at the bar.
 * Doing this as two client calls is how stock goes missing between them.
 *
 * Refuses a transfer to the same place — which is not a transfer, and
 * writing the pair would leave two movements cancelling out and an audit
 * trail suggesting something happened.
 */
create or replace function public.transfer_stock(
  p_product uuid,
  p_from uuid,
  p_to uuid,
  p_quantity numeric,
  p_unit text,
  p_note text default null
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  org uuid;
  transfer uuid := gen_random_uuid();
  available numeric;
begin
  select p.org_id into org from public.products p where p.id = p_product;
  if org is null then
    raise exception 'no such product';
  end if;
  if not public.can_write_section('INVENTORY', org) then
    raise exception 'you do not have edit access to INVENTORY' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'a transfer moves a positive quantity';
  end if;
  if p_from is null or p_to is null then
    raise exception 'a transfer has a place it came from and a place it went to';
  end if;
  if p_from = p_to then
    raise exception 'that is the same place';
  end if;

  /*
   * Checked, but only as a warning in the shape of a refusal.
   *
   * Moving more than the books say is there is usually a sign the books are
   * wrong rather than that the move did not happen, so this names the figure
   * instead of silently allowing it. A venue that really is in that position
   * counts the room, which is what 0091 is for.
   */
  select coalesce(sum(m.quantity), 0) into available
    from public.stock_movements m
   where m.product_id = p_product and m.location_id = p_from;

  if available < p_quantity then
    raise exception 'only % there to move, not %', available, p_quantity
      using hint = 'Count the room if that is wrong.';
  end if;

  insert into public.stock_movements
    (org_id, product_id, kind, quantity, unit, location_id, transfer_id,
     reason, note, actor_id, actor_email, occurred_at)
  values
    (org, p_product, 'TRANSFER', -p_quantity, p_unit, p_from, transfer,
     'transfer out', p_note, (select auth.uid()), auth.jwt() ->> 'email', now()),
    (org, p_product, 'TRANSFER',  p_quantity, p_unit, p_to,   transfer,
     'transfer in',  p_note, (select auth.uid()), auth.jwt() ->> 'email', now());

  return transfer;
end $$;

revoke all on function public.transfer_stock(uuid, uuid, uuid, numeric, text, text) from public;
grant execute on function public.transfer_stock(uuid, uuid, uuid, numeric, text, text) to authenticated;

/*
 * A count can now be of one room.
 *
 * Rewritten rather than extended because the change is to what it selects,
 * and `stocktakes.location_id` has been sitting there unused since 0091.
 * With a location set the lines are the products that place actually holds
 * and the expected figures are that place's; without one it behaves exactly
 * as before, which is what every existing caller and test expects.
 */
create or replace function public.open_stocktake(p_stocktake uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  n integer;
begin
  select * into s from public.stocktakes where id = p_stocktake;
  if s is null then
    raise exception 'no such count';
  end if;
  if not public.can_write_section('INVENTORY', s.org_id) then
    raise exception 'you do not have edit access to INVENTORY' using errcode = '42501';
  end if;
  if s.status <> 'OPEN' then
    raise exception 'this count has already been opened';
  end if;

  if s.location_id is null then
    -- The whole venue, as before 0096.
    insert into public.stocktake_lines
      (org_id, stocktake_id, product_id, expected_qty, count_unit)
    select s.org_id, s.id, p.id,
           coalesce((select sum(m.quantity) from public.stock_movements m
                      where m.product_id = p.id
                        and m.occurred_at <= s.snapshot_at), 0),
           coalesce(p.stock_unit, p.total_unit, p.pack_unit)
      from public.products p
     where p.org_id = s.org_id
       and p.status = 'ACTIVE'
       and coalesce(p.stock_unit, p.total_unit, p.pack_unit) is not null
    on conflict (stocktake_id, product_id) do nothing;
  else
    /*
     * One room. Only what that room has ever held, because a count sheet
     * listing the entire catalogue is a count sheet nobody finishes — and a
     * product that is not kept there has no expected figure to vary from.
     */
    insert into public.stocktake_lines
      (org_id, stocktake_id, product_id, expected_qty, count_unit)
    select s.org_id, s.id, p.id,
           coalesce((select sum(m.quantity) from public.stock_movements m
                      where m.product_id = p.id
                        and m.location_id = s.location_id
                        and m.occurred_at <= s.snapshot_at), 0),
           coalesce(p.stock_unit, p.total_unit, p.pack_unit)
      from public.products p
     where p.org_id = s.org_id
       and p.status = 'ACTIVE'
       and coalesce(p.stock_unit, p.total_unit, p.pack_unit) is not null
       and exists (select 1 from public.stock_movements m
                    where m.product_id = p.id and m.location_id = s.location_id)
    on conflict (stocktake_id, product_id) do nothing;
  end if;

  get diagnostics n = row_count;
  update public.stocktakes set status = 'COUNTING' where id = p_stocktake;
  return n;
end;
$$;

/*
 * And its adjustment lands in the room that was counted.
 *
 * Rewritten for the same reason: without the location the correction to a
 * chiller's count would appear as a venue-wide adjustment and the chiller
 * would still be wrong.
 */
create or replace function public.post_stocktake(p_stocktake uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  n integer := 0;
begin
  select * into s from public.stocktakes where id = p_stocktake;
  if s is null then
    raise exception 'no such count';
  end if;
  if not public.can_write_section('INVENTORY', s.org_id) then
    raise exception 'you do not have edit access to INVENTORY' using errcode = '42501';
  end if;
  if s.status <> 'APPROVED' then
    raise exception 'a count is posted after it is approved'
      using hint = 'It has to be approved first.';
  end if;

  insert into public.stock_movements
    (org_id, product_id, kind, quantity, unit, reason, note,
     actor_id, actor_email, occurred_at, business_unit_id, location_id)
  select s.org_id, l.product_id, 'COUNT',
         l.counted_qty - l.expected_qty,
         l.count_unit,
         'stocktake',
         'Count ' || coalesce(s.reference, s.id::text),
         (select auth.uid()), auth.jwt() ->> 'email',
         s.snapshot_at, s.business_unit_id, s.location_id
    from public.stocktake_lines l
   where l.stocktake_id = s.id
     and l.counted_qty is not null
     and l.counted_qty <> l.expected_qty;

  get diagnostics n = row_count;
  update public.stocktakes set status = 'POSTED', posted_at = now()
   where id = p_stocktake;
  return n;
end;
$$;

comment on function public.transfer_stock(uuid, uuid, uuid, numeric, text, text) is
  'Moves stock between places as a pair of movements sharing a transfer_id, in one statement. See 0096.';
