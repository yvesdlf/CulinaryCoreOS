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
 * One tint for everybody, which is not what was asked for.
 *
 * A hashed background needs a set of hues that clear 4,5:1 against their own
 * initials in both themes. The only such families here are the four status
 * colours, and those mean something: a danger-red disc next to somebody's name
 * in a row that also carries a status chip reads as a statement about that
 * person. The module markers are mid-tones fixed across both themes — forest
 * green is 3,81:1 against white — and the brief forbids new raw hex. So the
 * honest options were a wrong colour or one colour, and the initials plus the
 * name do the identifying either way. Six neutral `--avatar-tint-*` tokens in
 * index.css would settle it properly; that file is not this change's to edit.
 */
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
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground",
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
