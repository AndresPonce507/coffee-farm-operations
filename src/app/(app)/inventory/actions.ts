"use server";

import { revalidatePath } from "next/cache";

import {
  gradeGreenLot,
  type GradeGreenLotResult,
  type GradeGreenLotStore,
} from "@/lib/db/commands/gradeGreenLot";
import {
  reserveGreenLot,
  type ReserveGreenLotResult,
  type ReserveGreenLotStore,
} from "@/lib/db/commands/reserveGreenLot";
import { getSupabase } from "@/lib/supabase/server";
import { formToRecord } from "@/lib/validation/shared";

/**
 * Server Actions for the GreenLot inventory surface (S5 — the first money-shaped
 * slice; ADR-002 — Server Actions are the driving port, only ever invoked by an
 * authenticated human submitting a form). Two intents:
 *
 *  - `gradeGreenLotAction` — grade a finished lot into a located, available-to-
 *    promise sellable asset. Builds the offline-ready `occurred_at` server-side
 *    (D5) and delegates to the `materialize_green_lot` command, whose single
 *    write door is the SECURITY DEFINER RPC.
 *  - `reserveGreenLotAction` — reserve kg against a buyer via the append-only
 *    `lot_reservations` insert. The `prevent_oversell` trigger is the real
 *    fail-closed guard; this action surfaces a rejection as a clean form error so
 *    the family never sees a raw exception. The UI *cannot* create a double-sell.
 */

export type InventoryActionState =
  | { status: "idle" }
  | { status: "success"; message: string; greenLotCode?: string }
  | { status: "error"; message?: string; errors?: Record<string, string> };

export const INVENTORY_IDLE: InventoryActionState = { status: "idle" };

function refresh() {
  revalidatePath("/inventory");
  revalidatePath("/");
}

/** Map the grade command's friendly/labelled result onto the form's state. */
function gradeToState(result: GradeGreenLotResult): InventoryActionState {
  if (result.ok) {
    return {
      status: "success",
      message: `Green lot ${result.greenLotCode} graded.`,
      greenLotCode: result.greenLotCode,
    };
  }
  return { status: "error", errors: result.errors, message: result.message };
}

/** Map the reserve command's friendly/labelled result onto the form's state. */
function reserveToState(result: ReserveGreenLotResult): InventoryActionState {
  if (result.ok) {
    return { status: "success", message: "Reservation held." };
  }
  return { status: "error", errors: result.errors, message: result.message };
}

export async function gradeGreenLotAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const raw = formToRecord(formData);

  // Build the offline-ready event envelope server-side (D5): a form-supplied
  // `occurredAt` (the real grading wall-clock) wins; otherwise stamp now so the
  // unrecoverable timestamp column is always filled.
  const occurredAt =
    typeof raw.occurredAt === "string" && raw.occurredAt.trim()
      ? raw.occurredAt.trim()
      : new Date().toISOString();

  const sb = await getSupabase();
  const result = await gradeGreenLot(sb as unknown as GradeGreenLotStore, {
    ...raw,
    occurredAt,
  });

  if (result.ok) {
    // Cost the freshly-minted green lot immediately — otherwise it sits uncosted
    // on the table until an unrelated refresh fires. Best-effort (D5 write-path
    // refresh seam): the materialize is the source of truth, so a refresh hiccup
    // must never fail the grade — the next refresh/read recovers.
    try {
      await (sb as unknown as { rpc: (fn: string) => Promise<unknown> }).rpc(
        "refresh_lot_cost",
      );
    } catch {
      // swallow — the grade succeeded; costing self-heals on the next refresh.
    }
    refresh();
  }
  return gradeToState(result);
}

export async function reserveGreenLotAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const raw = formToRecord(formData);

  const sb = await getSupabase();
  const result = await reserveGreenLot(sb as unknown as ReserveGreenLotStore, raw);

  if (result.ok) refresh();
  return reserveToState(result);
}
