"use server";

import { revalidatePath } from "next/cache";

import {
  recordWeighIn,
  type WeighInResult,
  type WeighStore,
} from "@/lib/db/commands/recordWeighIn";
import { getSupabase } from "@/lib/supabase/server";
import type { WeighActionState } from "./state";

/**
 * Server Action for the P2-S2 weigh-in (ADR-002 — Server Actions are the driving
 * port; only ever invoked by an authenticated human). This is the ONLINE fallback
 * AND the transport the S0 offline outbox replays each queued weigh-in against on
 * reconnect: it builds the envelope server-side (a synthetic `device_id:"server"` +
 * a unique monotonic `device_seq`, an `occurred_at` fallback to now, a minted
 * `idempotency_key` when the client didn't supply one) and delegates to the
 * already-tested command port, whose single write door is `record_weigh_in`.
 *
 * The RPC is exactly-once on `idempotency_key`, so a queued replay or a double-tap
 * dedupes to one weigh_event server-side.
 */

/** Read the form value if a non-blank string, else `undefined` (for fallbacks). */
function str(raw: Record<string, unknown>, key: string): string | undefined {
  const v = raw[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/**
 * A UNIQUE monotonic device_seq for the single synthetic online device `"server"`.
 * weigh_event carries `unique (device_id, device_seq)`, so the online path must NOT
 * hardcode a constant seq. `next_server_seq()` (the S1 migration's SECURITY DEFINER
 * draw) hands out a strictly-increasing seq so ('server', seq) is unique forever.
 */
async function nextServerSeq(
  sb: {
    rpc(
      fn: "next_server_seq",
    ): Promise<{ data: number | string | null; error: { message: string } | null }>;
  },
): Promise<number> {
  const { data, error } = await sb.rpc("next_server_seq");
  if (error || data === null || data === undefined) {
    // Fail safe to a time-derived seq so a draw hiccup never reuses a value; the
    // unique key still protects correctness and any real error still surfaces.
    return Date.now();
  }
  return Number(data);
}

function toState(result: WeighInResult): WeighActionState {
  if (result.ok) {
    return { status: "success", message: "Weight captured.", lotCode: result.lotCode };
  }
  return { status: "error", errors: result.errors, message: result.message };
}

/**
 * Record a weigh-in from a posted form. Accepts the same field names the client
 * island uses (workerId/plotId/cherriesKg/ripeness/scaleSource/captured*), filling
 * the device + idempotency envelope server-side when absent.
 */
export async function recordWeighInAction(
  formData: FormData,
): Promise<WeighActionState> {
  const raw = Object.fromEntries(formData.entries()) as Record<string, unknown>;

  const sb = await getSupabase();
  const result = await recordWeighIn(sb as unknown as WeighStore, {
    ...raw,
    occurredAt: str(raw, "occurredAt") ?? new Date().toISOString(),
    deviceId: str(raw, "deviceId") ?? "server",
    deviceSeq:
      str(raw, "deviceSeq") ??
      (await nextServerSeq(
        sb as unknown as Parameters<typeof nextServerSeq>[0],
      )),
    idempotencyKey: str(raw, "idempotencyKey") ?? crypto.randomUUID(),
  });

  if (result.ok) {
    revalidatePath("/weigh");
    revalidatePath("/harvests");
    revalidatePath("/crew");
    revalidatePath("/");
  }
  return toState(result);
}
