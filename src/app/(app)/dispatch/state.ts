/**
 * Dispatch action state — the shape the /dispatch Server Actions return.
 *
 * A `"use server"` file (actions.ts) may export ONLY async functions (Next 15), so
 * the non-function exports (this type + the idle constant) live here and are
 * imported by both the actions and any client island that needs the shape.
 */
export type DispatchActionState =
  | { status: "idle" }
  | { status: "success"; message: string; runId?: number }
  | { status: "error"; message?: string; errors?: Record<string, string> };

export const DISPATCH_IDLE: DispatchActionState = { status: "idle" };
