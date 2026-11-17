-- ---------------------------------------------------------------------------
-- Handover: what each shift left behind, and whether anybody read it
-- ---------------------------------------------------------------------------
-- 0071 built the shift handover and nothing has ever been in it. The board
-- has never shown a row, and neither `handover_report` (0135) nor the
-- dashboard's "unread handovers" figure has had anything to work from.
--
-- ── Five departments that fail in five different ways ─────────────────────
--
-- A seed where every department behaves the same proves only that the report
-- can count. These are deliberately distinct, because the point of the report
-- is that the chain breaks in ways that are not interchangeable:
--
--   Kitchen        keeps it properly — written, published, acknowledged.
--                  The majority case, so the others read as exceptions.
--   Bar            writes them and never publishes. The worst failure and
--                  the one that feels like success: 0071 makes DRAFT mean
--                  nobody else can see it, so the writer believes they
--                  handed over and the next shift got nothing.
--   Front of House publishes faithfully and nobody acknowledges.
--   Housekeeping   has long gaps — whole stretches with nothing at all.
--   Administration publishes handovers with nothing written in them, which
--                  satisfies every check in the system and tells the next
--                  shift nothing.
--
-- ── Dates, not now() ──────────────────────────────────────────────────────
--
-- `published_at` and `acknowledged_at` are written from the handover's own
-- date. 0071 has no trigger setting them from the clock — the constraint
-- only requires that a PUBLISHED handover has one — so unlike the requests
-- seed this one does not have to correct itself afterwards. Worth saying
-- because the two modules differ and the difference is not obvious.
--
-- Deterministic, not random. Safe to run more than once.
-- ---------------------------------------------------------------------------

do $$
declare
  org uuid;
  u record;
  d date;
  i integer;
  k integer;
  hid uuid;
  st text;
  writes boolean;
  publishes boolean;
  acks boolean;
  empty_one boolean;
  n_h integer := 0;
  n_items integer := 0;
begin
  begin
    select id into strict org from public.organizations where name = 'Demo Kitchen';
  exception
    when no_data_found then
      raise exception 'no organisation called "Demo Kitchen"'
        using hint = 'Run seed.sql first, or rename the venue you want seeded.';
    when too_many_rows then
      raise exception 'more than one organisation is called "Demo Kitchen"'
        using hint = 'The seeds cannot tell which venue you mean. Rename all but one.';
  end;

  /*
   * The handovers, and the items cascade with them. Deliberately this way
   * round.
   *
   * 0071 refuses to delete an item from a *published* handover — "the record
   * is what somebody read" — so clearing the items first worked on an empty
   * table and failed on the second run, which is the only run that matters
   * for a seed that claims to be re-runnable. The guard allows the delete
   * once the parent is gone, and `on delete cascade` removes the parent
   * first, so deleting the handover takes its items with it.
   */
  delete from public.handovers where org_id = org;

  for u in
    select id, code, name from public.business_units
     where org_id = org order by code
  loop
    /*
     * Sixty days, not twenty-eight.
     *
     * The Reports page opens on last month, and a twenty-eight-day seed
     * ending today covers only half of it — so the Handover tab opened
     * reporting twenty-six of thirty-one days missing for every department,
     * which is an artefact of the seed's length and not of anything the
     * demo venue did. Sixty days covers any whole month the picker offers.
     */
    for i in 0..59 loop
      d := current_date - i;

      /*
       * Who writes, who publishes, who acknowledges. See the header: each
       * department breaks the chain in its own way, and they are not
       * interchangeable failures.
       */
      writes := case u.code
                  when 'KITCHEN' then (i % 9) <> 4      -- nearly every day
                  when 'BAR'     then (i % 3) = 0
                  when 'FOH'     then (i % 2) = 0
                  -- Housekeeping goes quiet for whole stretches.
                  when 'HSK'     then i < 8 or i > 21
                  else                (i % 7) = 0       -- Administration
                end;

      if not writes then continue; end if;

      publishes  := (u.code <> 'BAR');
      acks       := publishes and case u.code
                                    when 'FOH' then (i % 11) = 0
                                    when 'ADMIN' then (i % 2) = 0
                                    else (i % 8) <> 3
                                  end;
      empty_one  := (u.code = 'ADMIN');

      insert into public.handovers
        (org_id, business_unit_id, on_date, service, status,
         written_by_email, published_at,
         acknowledged_by_email, acknowledged_at, summary)
      values (
        org, u.id, d, 'Evening',
        (case when publishes then 'PUBLISHED' else 'DRAFT' end)::public.handover_status,
        case u.code when 'KITCHEN' then 'sous@venue.test'
                    when 'BAR' then 'barmgr@venue.test'
                    when 'FOH' then 'putu@venue.test'
                    when 'HSK' then 'housekeep@venue.test'
                    else 'gm@venue.test' end,
        case when publishes
             then (d::timestamp + interval '23 hours') at time zone 'UTC' end,
        case when acks then 'chef@venue.test' end,
        case when acks
             -- Read the next morning, which is when a handover is read.
             then ((d + 1)::timestamp + interval '7 hours'
                   + (i % 4) * interval '40 minutes') at time zone 'UTC' end,
        case when empty_one then null
             else 'Quiet service. Nothing outstanding beyond the items.' end
      )
      returning id into hid;
      n_h := n_h + 1;

      -- Administration's are deliberately empty: published, and saying nothing.
      if not empty_one then
        for k in 0 .. (i % 4) loop
          insert into public.handover_items (handover_id, kind, note)
          values (
            hid,
            (case ((i + k) % 6)
               when 0 then 'BROKEN' when 1 then 'GUEST'
               when 2 then 'STOCK'  when 3 then 'PEOPLE'
               -- One in six is a safety item, which the report counts apart.
               when 4 then 'SAFETY' else 'NOTE' end)::public.handover_item_kind,
            case ((i + k) % 6)
              when 0 then 'Glasswasher draining slowly; logged a job.'
              when 1 then 'Table 12 returning tomorrow, allergy noted.'
              when 2 then 'Down to two cases of tonic.'
              when 3 then 'Wayan covering the late shift this week.'
              when 4 then 'Fire door on the terrace was wedged open; closed it.'
              else        'Nothing else to pass on.'
            end
          );
          n_items := n_items + 1;
        end loop;
      end if;
    end loop;
  end loop;

  raise notice 'Handover: % handovers, % items', n_h, n_items;
  raise notice 'Handover: % drafts never published, % published never acknowledged',
    (select count(*) from public.handovers where org_id = org and status = 'DRAFT'),
    (select count(*) from public.handovers
      where org_id = org and status = 'PUBLISHED' and acknowledged_at is null);
end $$;
