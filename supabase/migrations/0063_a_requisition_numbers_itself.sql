-- ---------------------------------------------------------------------------
-- A requisition numbers itself, the way a work order already does
-- ---------------------------------------------------------------------------
-- Found by the department contract test in `12_department_contract.sql`, which
-- adds Security as one row and then tries to do everything Part C says a new
-- department can do. Twelve of its bullets passed. One did not, and not for
-- the reason it was looking for:
--
--   a work order inserted with a unit and no reference is numbered
--   WO-SEC-260919-001 by a trigger
--
--   a requisition inserted the same way raises "null value in column
--   reference violates not-null constraint"
--
-- The capability is not missing — the purchasing screen allocates a stem
-- through `next_reference_stem` first and passes it in, so a new department
-- does get REQ-SEC- numbers from the screen. What is missing is that the two
-- documents disagree about whose job it is, and only one of them says so.
--
-- That matters beyond tidiness. Part C's promise is that a department is data;
-- a promise that holds only when the write comes from one particular screen is
-- a promise about that screen. An import, a fixture, a script that raises
-- requisitions from a supplier feed, or the next screen somebody writes all hit
-- a not-null violation whose message says nothing about reference stems.
--
-- ## What this does not change
--
-- A caller that supplies a stem still owns the number. The client allocates
-- early on purpose — 0047's reasoning is that a cancelled draft should not burn
-- a number — and that path is untouched: this only fills in a stem where there
-- is none, which today is only the paths that currently fail outright.
--
-- The allocation is `next_reference_stem`, the same row-locking function the
-- client calls, so two requisitions saved in the same second still get 001 and
-- 002 rather than colliding. Computing a number in the trigger by counting
-- today's rows is the obvious alternative and is the bug 0047 exists to
-- prevent.
--
-- GEN is the fallback when there is no unit, exactly as 'ENG' is the fallback
-- for a work order with no unit and no location. It means "this number cannot
-- tell you whose order it was", which is a true statement about a requisition
-- charged to nobody, and the purchasing screen now refuses to raise one.
-- ---------------------------------------------------------------------------

create or replace function public.sync_requisition_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare unit text;
begin
  /*
   * No stem, and this is a new row: allocate one from the unit.
   *
   * Only on INSERT. An UPDATE that somehow cleared the stem must not quietly
   * mint a second number for a document a supplier is already holding — it
   * keeps the reference it has, and the early return below is what does that.
   */
  if (new.reference_stem is null or btrim(new.reference_stem) = '')
     and tg_op = 'INSERT'
  then
    select public.unit_code(b.code) into unit
      from public.business_units b where b.id = new.business_unit_id;

    new.reference_stem := public.next_reference_stem(
      coalesce(unit, 'GEN'), new.org_id);
  end if;

  if new.reference_stem is null or btrim(new.reference_stem) = '' then
    return new;
  end if;

  new.reference := public.requisition_prefix(new.status) || '-' || new.reference_stem;
  return new;
end;
$$;

comment on function public.sync_requisition_reference() is
  'Keeps the reference in step with the status, and allocates a stem on insert where the caller gave none.';
