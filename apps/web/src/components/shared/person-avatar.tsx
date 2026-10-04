import { cn } from "@/lib/utils";

/**
 * Initials in a circle, beside a name — never instead of one.
 *
 * `aria-hidden`, and not negotiable. Two letters is not a name: "JS" could be
 * three people on the rota, and a screen-reader user would get the ambiguity
 * with none of the recognition a sighted reader gets from position and colour.
 * Every caller renders the full name in the same cell, so hiding this from the
 * accessibility tree loses nothing and stops the tree reading "J S Jamie
 * Stewart".
 *
 * Six tints, hashed from the name.
 *
 * This shipped with one tint for everybody, and the reasoning for that is
 * worth keeping because it was right about the constraint and wrong about the
 * conclusion: a hashed background needs hues that clear 4,5:1 against their
 * own initials in both themes, the only families that did were the four status
 * colours, and a danger-red disc beside somebody's name in a row that also
 * carries a status chip reads as a statement about that person. The answer was
 * not to give up on colour; it was to add six tokens that are not status
 * colours. `--avatar-tint-1` to `-6` in index.css do that, desaturated far
 * enough to read as paper rather than signal, measured at 10,1:1 to 12,2:1 for
 * the initials across both themes.
 *
 * The hash is on the whole name, not the initials, so two people whose
 * initials collide — which is the case the tint exists for — get different
 * discs. It is stable: the same person is the same colour on every screen and
 * after every reload, which is the only property that makes a colour worth
 * recognising.
 */

/**
 * A small stable hash of a name to one of six tints.
 *
 * Deliberately not `Math.random`, a counter, or an index in the list: a tint
 * that moves when the rota is re-sorted is worse than no tint, because the eye
 * learns it and is then wrong.
 */
export function avatarTint(name: string): number {
  let h = 0;
  for (const ch of name.trim().toLowerCase()) {
    // djb2, enough for six buckets and short enough to read.
    h = ((h << 5) - h + ch.codePointAt(0)!) | 0;
  }
  return (Math.abs(h) % 6) + 1;
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return (first + last).toUpperCase();
}

export function PersonAvatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: `var(--avatar-tint-${avatarTint(name)})` }}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium text-foreground",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/**
 * The avatar and the name as one cell, because they are never apart.
 *
 * Exists so the pairing cannot be got wrong by accident: an avatar on its own
 * in a cell is the failure this component is shaped to prevent.
 */
export function PersonCell({
  name,
  secondary,
  className,
}: {
  name: string;
  /** A second line under the name — a number, a role, an email. */
  secondary?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <PersonAvatar name={name} />
      <div className="min-w-0">
        <div className="font-medium">{name}</div>
        {secondary && (
          <div className="text-xs text-muted-foreground">{secondary}</div>
        )}
      </div>
    </div>
  );
}
