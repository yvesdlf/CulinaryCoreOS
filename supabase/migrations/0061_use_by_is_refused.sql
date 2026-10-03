-- ---------------------------------------------------------------------------
-- Food past its use-by date cannot be consumed
-- ---------------------------------------------------------------------------
-- docs/PROGRESS.md has carried this as a ticked box since 0020:
--
--   "Past a use-by date food is deemed unsafe under Article 14 and the system
--    refuses it"
--
-- and the traceability screen tells the person reading it the same thing:
-- "Past a use-by date the database refuses to let it be used at all."
--
-- It does not. `refuse_movement_on_blocked_lot` in 0020 refuses a lot whose
-- *status* is not OK — blocked, recalled, withdrawn — and says nothing about
-- dates. The front end calls such a lot unusable and will not offer it, which
-- is why nobody noticed: the screen behaves as described and the sentence
-- describing it is about the database.
--
-- A control that exists only in the client is not a control. It is one import
-- route, one script and one corrected movement away from gone, and the people
-- relying on the ticked box are relying on it for Article 14.
--
-- Found while recording a batch in the browser to see whether the forward step
-- worked, which is also how the missing lot on the consumption was found. Both
-- were invisible from the test suite because the suite sets its own lot ids.
--
-- ## What this refuses, and what it deliberately does not
--
-- Refused: USAGE and TRANSFER of a lot whose date is a **use-by** and is in
-- the past. Those are the two movements that put food in front of somebody.
--
-- Not refused: WASTE, RETURN, ADJUSTMENT, or anything else. Clearing expired
-- stock off the shelf is the thing the kitchen is supposed to do with it, and
-- a rule that refused the write-off would leave the venue holding stock it
-- cannot record getting rid of. 0020 drew the same line for a recalled lot and
-- its hint says so.
--
-- Not refused: a **best-before** date in the past. That food is legal to use
-- and throwing it away is waste. The two are kept apart everywhere else in
-- this schema and conflating them here would undo it.
--
-- Not refused: a date with no kind stated. Guessing use-by throws away good
-- food; guessing best-before serves unsafe food. The lot is reported as
-- unjudgeable, which is the finding, and the refusal needs a stated kind.
--
-- ## The boundary is the end of the day shown
--
-- Regulation 1169/2011 Annex X: the date marks the last day the food may be
-- used, so a lot stamped today is usable today and refused tomorrow. Written
-- as `expires_on < current_date` rather than `<=` for exactly that reason —
-- the off-by-one here throws away a day of every delivery.
-- ---------------------------------------------------------------------------

create or replace function public.refuse_movement_on_blocked_lot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lot record;
begin
  if new.lot_id is null then
    return new;
  end if;

  select status, lot_code, expires_on, expiry_kind into lot
    from public.stock_lots where id = new.lot_id;
  if lot is null then
    return new;
  end if;

  /*
   * Article 19, carried over from 0060 — including the `quantity < 0` that
   * 0060 added and that the first draft of this file dropped.
   *
   * Two control checks caught it immediately, which is the only reason this
   * paragraph is not a defect. The dropped line is what allows the reversal
   * half of a correction: 0020 refused every usage movement on a blocked lot
   * regardless of direction, so a lot recalled after Tuesday's service left
   * Tuesday's over-recorded consumption permanently uncorrectable — the ledger
   * stuck wrong about a recalled lot, which is the opposite of what Article 19
   * is for.
   *
   * This is the same mistake 0060 made with `seed_organization_defaults` and
   * that the seeder registry was written to end: a function rewritten in full
   * loses whatever the last rewrite added. There is no registry for a trigger
   * body. What there is, is a suite that reads the row back.
   */
  if lot.status <> 'OK'
     and new.kind in ('USAGE', 'TRANSFER')
     and new.quantity < 0
  then
    raise exception
      'lot % is % and cannot be used or transferred', lot.lot_code, lot.status
      using hint = 'Record a RETURN or WASTE movement to clear it instead.';
  end if;

  -- Article 14. New here, and with the same direction check for the same
  -- reason: putting quantity back on an expired lot is correcting the record,
  -- not serving the food.
  if lot.expiry_kind = 'USE_BY'
     and lot.expires_on is not null
     and lot.expires_on < current_date
     and new.kind in ('USAGE', 'TRANSFER')
     and new.quantity < 0
  then
    raise exception
      'lot % was use-by % and cannot be used', lot.lot_code,
      to_char(lot.expires_on, 'FMDD Month YYYY')
      using hint = 'Food past a use-by date is unsafe under Article 14. Write it off as WASTE.';
  end if;

  return new;
end;
$$;

comment on function public.refuse_movement_on_blocked_lot() is
  'Article 19 by status and Article 14 by use-by date. Writing the lot off as WASTE is always allowed.';
