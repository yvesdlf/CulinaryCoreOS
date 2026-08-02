// ---------------------------------------------------------------------------
// Archived entities
// ---------------------------------------------------------------------------
// SRS RCP-FUNC-006 AC5: archived items are hidden from default views but stay
// searchable. Both halves matter — hiding without keeping them findable loses
// them, and keeping them in the working list means archiving did nothing.
//
// One predicate rather than a status comparison scattered across six files,
// because the moment "archived" also means INACTIVE or a seasonal flag, every
// one of those comparisons has to be found again.
// ---------------------------------------------------------------------------

/** Entities carry the same discontinued state under different status enums. */
export function isArchived(entity: { status: string }): boolean {
  return entity.status === "DISCONTINUED";
}

/** Working set: what a list shows before anyone asks for more. */
export function activeOnly<T extends { status: string }>(items: T[]): T[] {
  return items.filter((i) => !isArchived(i));
}
