# Instructions for AI coding agents

**The rules for building this app are in [`AGENTS.md`](../AGENTS.md) at the
repository root. Read that first.**

This file previously said the repository "currently contains no source files
(only `.git`)" and told agents to ask the user where the code was. That was
written during scaffolding and stayed wrong for months, through roughly fifty
migrations and the whole application. An agent that believed it would have
started by asking questions already answered by the tree in front of it.

Kept as a pointer so tools that look for this path find the real thing.

## The short version

```bash
pnpm -C apps/web exec tsc --noEmit      # typecheck
pnpm -C apps/web exec vitest run        # unit tests
pnpm -C apps/web dev                    # dev server, port 5173
```

Run from the repository root, not from inside `apps/web`.

Four rules that catch most mistakes here, each with its full reasoning in
`AGENTS.md`:

1. **Enforce rules in the database.** A hidden button is not a control.
2. **Prove a control by trying to break it.** Note that zero rows updated
   raises no error, and psql prefixes errors with `file:line:` — both have
   produced false passes here.
3. **Starting data goes in a function called on organisation creation**, never
   a bare `INSERT` in a migration body. Migrations run before any organisation
   exists. This is the most repeated defect in the repository.
4. **Money is `decimal.js`.** Never floats.
