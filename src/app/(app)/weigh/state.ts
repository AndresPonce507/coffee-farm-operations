/**
 * Weigh Server-Action state — kept in a plain (non-`"use server"`) module because a
 * `"use server"` file may export ONLY async functions (Next 15 rule). The action
 * module and any client island both import the state type + IDLE constant from here,
 * so `actions.ts` stays a pure async-function export surface.
 */
export type WeighActionState =
  | { status: "idle" }
  | { status: "success"; message: string; lotCode: string }
  | { status: "error"; message?: string; errors?: Record<string, string> };

export const WEIGH_IDLE: WeighActionState = { status: "idle" };
