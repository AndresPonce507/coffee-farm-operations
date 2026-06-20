import { cache } from "react";

import { getSupabase } from "@/lib/supabase/server";
import type { LotEvent } from "@/lib/types";

/**
 * Events read-port (S3 — the event-spine trunk; ADR-001 event-log-as-SSOT).
 *
 * Reads the append-only, hash-chained `lot_event` ledger and exposes the
 * verify_chain tamper check. Writes never flow through here — they go through
 * the `SECURITY DEFINER` command RPCs (ADR-002). This is the symmetric read
 * twin: a `Row` interface + a pure `mapEvent` + a `cache()`'d getter, in the
 * exact shape of the other ports (plots.ts / activity.ts / trends.ts).
 */

/** Shape of a `lot_event` row as returned by PostgREST (snake_case). */
export interface EventRow {
  event_uid: string;
  stream_key: string;
  kind: string;
  occurred_at: string;
  recorded_at: string;
  device_id: string;
  device_seq: number | string;
  payload: Record<string, unknown> | null;
}

/** Pure row → domain mapper (snake_case → camelCase, numeric coercion). */
export function mapEvent(r: EventRow): LotEvent {
  return {
    id: r.event_uid,
    streamKey: r.stream_key,
    kind: r.kind,
    occurredAt: r.occurred_at,
    recordedAt: r.recorded_at,
    deviceId: r.device_id,
    deviceSeq: Number(r.device_seq),
    payload: r.payload ?? {},
  };
}

/**
 * The ordered event chain for one stream (a lot's `JC-NNN` code, or 'activity').
 * Ordered by `device_seq` — the per-stream monotonic Lamport counter the hash
 * chain is built over — then `recorded_at` as a stable tiebreak.
 */
export const getEventStream = cache(
  async (streamKey: string): Promise<LotEvent[]> => {
    const { data, error } = await (await getSupabase())
      .from("lot_event")
      .select("*")
      .eq("stream_key", streamKey)
      .order("device_seq", { ascending: true })
      .order("recorded_at", { ascending: true });
    if (error) throw new Error(`getEventStream: ${error.message}`);
    return (data as EventRow[]).map(mapEvent);
  },
);

/**
 * Internal-consistency check for a stream — recomputes the hash chain server-side
 * via the `verify_chain` RPC (the single shared hashing util, ADR-009). Returns
 * true when each stored hash reconciles with its inputs and links to its
 * predecessor, false on any drift.
 *
 * IMPORTANT — what this does NOT prove (see s3_event_spine.db.test.ts, the
 * "DOCUMENTED LIMITATION" case): the chain is self-anchored with no external head
 * pin, so it proves INTERNAL CONSISTENCY, not authenticity. An attacker with raw
 * table-write access can re-forge the whole chain (recompute every hash) and this
 * still returns true. The PRIMARY tamper guards are the append-only block trigger
 * + force-RLS + no write grant (writes only via the SECURITY DEFINER RPCs); treat
 * `verify_chain` as a corruption detector feeding the audit drawer's badge, not as
 * tamper PROOF.
 */
export const verifyStream = cache(
  async (streamKey: string): Promise<boolean> => {
    const { data, error } = await (await getSupabase()).rpc("verify_chain", {
      stream_key: streamKey,
    });
    if (error) throw new Error(`verifyStream: ${error.message}`);
    return Boolean(data);
  },
);
