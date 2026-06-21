import type { CommandTransport, OutboxEntry, TransportResult } from "./outbox";

/**
 * The command envelope a field Server Action receives (P2-S0). Every later
 * field-capture action accepts exactly this shape and forwards it to its
 * command RPC, so the outbox's replay carries the client-minted `idempotency_key`
 * + `device_id` + `device_seq` the Phase-1 RPCs dedupe + causally order on.
 */
export interface CommandEnvelope {
  rpc: string;
  args: Record<string, unknown>;
  occurredAt: string;
  deviceId: string;
  deviceSeq: number;
  idempotencyKey: string;
}

/** A field Server Action's result — the friendly-error convention this repo uses. */
export type ServerActionResult =
  | { ok: true }
  | { ok: false; message?: string };

/** A field Server Action: takes the envelope, deterministically resolves a result. */
export type ServerAction = (
  envelope: CommandEnvelope,
) => Promise<ServerActionResult>;

/**
 * Bridge a Server Action into a `CommandTransport`, classifying its outcome into
 * the three buckets the outbox branches on. THE distinction:
 *   - resolves ok        → ok (the entry is done)
 *   - resolves a rejection → rejected (dead-letter — the server deterministically
 *     refused; retrying would just fail again)
 *   - THROWS             → network-error (fetch failed / offline / a transient
 *     5xx — keep the entry queued and try again on the next reconnect)
 *
 * A Server Action only throws on transport/runtime failure; a *business* refusal
 * comes back as `{ ok: false }`. That is the contract the field actions honor.
 */
export function makeServerActionTransport(
  action: ServerAction,
): CommandTransport {
  return {
    async send(entry: OutboxEntry): Promise<TransportResult> {
      const envelope: CommandEnvelope = {
        rpc: entry.rpc,
        args: entry.args,
        occurredAt: entry.occurredAt,
        deviceId: entry.deviceId,
        deviceSeq: entry.deviceSeq,
        idempotencyKey: entry.idempotencyKey,
      };
      try {
        const result = await action(envelope);
        if (result.ok) return { kind: "ok" };
        return { kind: "rejected", message: result.message };
      } catch (err) {
        // A throw == the round-trip itself failed (offline, DNS, 5xx). Requeue.
        const message =
          err instanceof Error ? err.message : "network unavailable";
        return { kind: "network-error", message };
      }
    },
  };
}
