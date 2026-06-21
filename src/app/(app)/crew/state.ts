/**
 * Crew Server-Action state — kept in a plain (non-`"use server"`) module because a
 * `"use server"` file may export ONLY async functions (Next 15 rule). The action
 * module and any client form island both import the state type + IDLE constant from
 * here, so `actions.ts` stays a pure async-function export surface.
 */
export type CrewActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message?: string; errors?: Record<string, string> };

export const CREW_IDLE: CrewActionState = { status: "idle" };
