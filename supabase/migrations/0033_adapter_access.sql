-- ---------------------------------------------------------------------------
-- Let the adapter read its queue, and stop queueing in-app deliveries
-- ---------------------------------------------------------------------------
-- Two things found by running the adapter rather than by reasoning about it.
--
-- `service_role` bypasses row-level security but still needs a table grant,
-- and every migration so far granted only to `authenticated`. So the adapter
-- got a flat 403 on its own queue. Grants are limited to the three tables it
-- actually touches rather than handed out across the schema.
--
-- And the in-app channel was queueing delivery rows that nothing would ever
-- send, because the notification row IS the in-app delivery. They sat PENDING
-- for ever, or SKIPPED when no recipient was configured, and made the health
-- figures on the settings page meaningless.
-- ---------------------------------------------------------------------------

grant select, update on message_deliveries to service_role;
grant select on notifications to service_role;
grant select on message_channels to service_role;
grant select on suppliers to service_role;

create or replace function public.queue_notification_deliveries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare ch record; dest text;
begin
  for ch in
    select * from public.message_channels
     where org_id = new.org_id and enabled
       -- In-app needs no delivery row: the notification is the delivery, and
       -- a queue entry nothing will ever send is noise in the health figures.
       and kind <> 'IN_APP'
       and (cardinality(kinds) = 0 or new.kind = any(kinds))
  loop
    dest := null;
    if new.supplier_id is not null then
      select s.whatsapp_number into dest
        from public.suppliers s where s.id = new.supplier_id;
      insert into public.message_deliveries
        (org_id, notification_id, channel_id, kind, destination, status, last_error)
      values (new.org_id, new.id, ch.id, ch.kind, dest,
              case when dest is null then 'SKIPPED' else 'PENDING' end,
              case when dest is null then 'no number recorded for this supplier' end);
    else
      insert into public.message_deliveries
        (org_id, notification_id, channel_id, kind, destination, status)
      values (new.org_id, new.id, ch.id, ch.kind,
              ch.config ->> 'default_recipient',
              case when ch.config ->> 'default_recipient' is null
                   then 'SKIPPED' else 'PENDING' end);
    end if;
  end loop;
  return null;
end;
$$;
