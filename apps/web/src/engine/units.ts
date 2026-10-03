// ---------------------------------------------------------------------------
// Which units a picker may offer
// ---------------------------------------------------------------------------
// A unit can be closed. `fetchBusinessUnits` returns the closed ones anyway,
// because last year's purchase orders and the record of somebody who worked in
// a since-shuttered café still have to be nameable — a list that hid them
// would show those rows with a blank where the unit should be.
//
// So every picker filters. The obvious filter is wrong in one case, and it is
// the case that matters:
//
//   A dialog editing a record that is already on a closed unit, filtered to
//   the live ones, is a controlled <select> whose value matches no option. The
//   browser renders it blank. React does not push that blank back into state,
//   so the record keeps the closed unit while the screen says it has none —
//   and whoever is looking at it saves, having been told nothing, and believes
//   they left it as they found it.
//
// That is the same shape as the three false passes in `_harness.sql`: nothing
// errors, nothing is corrected, and the screen disagrees with the row. So the
// rule is stated once, here, with the closed unit kept in the list and marked
// as closed rather than quietly dropped.
//
// Choosing a closed unit for a *new* record is still refused, by leaving it out
// unless the record already has it.
// ---------------------------------------------------------------------------

/** The part of a unit this rule needs. Anything with these three fields fits. */
export interface PickableUnit {
  id: string;
  name: string;
  active: boolean;
}

export interface UnitOption {
  id: string;
  /** What the option reads, with "(closed)" where that is the honest answer. */
  label: string;
  closed: boolean;
}

/**
 * The options a unit picker should offer: every live unit, plus the one the
 * record being edited is already on, even where that one is closed.
 *
 * `current` is the record's existing unit id, or null for a new record. A
 * `current` that names no unit at all — a deleted one, or another venue's — is
 * not invented; there is nothing to label it with, and the picker showing one
 * fewer option is better than it showing an entry that resolves to nothing.
 */
export function unitOptions(
  units: readonly PickableUnit[],
  current: string | null = null,
): UnitOption[] {
  const options: UnitOption[] = units
    .filter((u) => u.active)
    .map((u) => ({ id: u.id, label: u.name, closed: false }));

  if (current === null || current === "") return options;
  if (options.some((o) => o.id === current)) return options;

  const closed = units.find((u) => u.id === current);
  if (!closed) return options;

  // Last, because it is not a choice anybody should be making afresh — it is
  // the one this record already made.
  return [...options, { id: closed.id, label: `${closed.name} (closed)`, closed: true }];
}
