import type { CommandInput, Outbox } from "./outbox";

/**
 * `enqueueCommand()` (P2-S0) — the ONE call every later field-capture slice
 * (S2 weigh, S1 attendance, S3/S4 readings, S12 scouting) makes instead of the
 * raw Server Action. It is the graceful-degradation seam:
 *
 *   - offline-first ENABLED → the command is queued durably and the caller gets
 *     an immediate `"queued"` acknowledgement (the picker walks away; the sync
 *     engine replays it on reconnect, exactly-once via `idempotency_key`).
 *   - offline-first DISABLED (flag off / no IndexedDB / SSR) → it sends directly
 *     through the same transport and returns the synchronous outcome, so
 *     online-only behaves exactly as before this slice existed.
 *
 * Either way the command carries a stable `idempotency_key`, so a retry — be it
 * a queued replay or a direct re-tap — dedupes to one server row.
 */

export type EnqueueOutcome = "queued" | "sent" | "rejected" | "error";

export interface EnqueueResult {
  outcome: EnqueueOutcome;
  /** The minted (or supplied) idempotency anchor — useful for the caller's UI. */
  uuid: string;
  /** A friendly message on a rejection/error. */
  message?: string;
}

/**
 * Build the wrapper bound to a concrete outbox + the resolved flag. The outbox
 * already holds the transport, so a DISABLED path reuses the same delivery code.
 */
export function makeEnqueueCommand(deps: {
  outbox: Outbox;
  offlineEnabled: boolean;
}) {
  const { outbox, offlineEnabled } = deps;

  return async function enqueueCommand(
    cmd: CommandInput,
  ): Promise<EnqueueResult> {
    if (offlineEnabled) {
      // Durable queue; the sync engine drains it. We do NOT eagerly flush here —
      // connectivity decides when (the picker's tap must never block on signal).
      const entry = await outbox.enqueue(cmd);
      return { outcome: "queued", uuid: entry.uuid };
    }

    // ── Disabled path: enqueue then immediately flush so the result is
    // synchronous, but never leave a durable trace behind. We reuse the outbox's
    // own transport (so the delivery code is identical) and clean up after.
    const entry = await outbox.enqueue(cmd);
    const summary = await outbox.flush();

    if (summary.sent > 0) {
      // Sent — drop the bookkeeping row so nothing lingers durably.
      await outbox.dismiss(entry.uuid);
      return { outcome: "sent", uuid: entry.uuid };
    }
    if (summary.deadLettered > 0) {
      const dead = (await outbox.deadLetters()).find(
        (e) => e.uuid === entry.uuid,
      );
      await outbox.dismiss(entry.uuid);
      return {
        outcome: "rejected",
        uuid: entry.uuid,
        message: dead?.lastError ?? "The server rejected this action.",
      };
    }
    // A network failure on the disabled path surfaces as an error (there is no
    // queue to fall back to when offline-first is off).
    const failed = (await outbox.list()).find((e) => e.uuid === entry.uuid);
    await outbox.dismiss(entry.uuid);
    return {
      outcome: "error",
      uuid: entry.uuid,
      message: failed?.lastError ?? "Could not reach the server.",
    };
  };
}
