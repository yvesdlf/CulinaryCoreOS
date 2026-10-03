// ---------------------------------------------------------------------------
// Supabase data access
// ---------------------------------------------------------------------------
// Every query lives in this directory so the stores stay unaware of Postgres.
// Ingredient lines are written by delete-then-insert rather than by diffing: a
// recipe has a handful of lines, order is significant, and a diff would have to
// reconcile reordering, which is not worth the complexity at this size.
//
// This file was 5.260 lines — 9% of the front end, and the one place in the
// codebase where finding anything meant scrolling. It is now the front door to
// six modules, one per area, and re-exports all of them: nothing that imports
// from "@/data/repository" had to change, and nothing about what it imports
// did.
//
// A new query goes in the module for the screens that read it. Something two
// areas genuinely share goes in `_shared.ts`, which is deliberately small — it
// holds three things today, and a fourth should have to argue for itself.
// ---------------------------------------------------------------------------

export { ConflictError } from "./_shared";
export * from "./catalogue";
export * from "./inventory";
export * from "./purchasing";
export * from "./people";
export * from "./operations";
export * from "./administration";
