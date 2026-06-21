import { nextDeviceSeq } from "./device";
import type { OutboxStore } from "./storage";
import { uuidv7 } from "./uuidv7";

/**
 * The sync outbox (P2-S0) — the durable client half of the offline write
 * contract. Every field mutation is queued here as a command envelope, drained
 * FIFO on reconnect, and replayed exactly-once against the Phase-1 command RPCs
 * (which already dedupe on `idempotency_key`).
 *
 * The single load-bearing distinction this file encodes is between the two
 * failure modes of a replay:
 *   - a NETWORK failure (offline, fetch threw, 5xx) → the entry STAYS `queued`
 *     and is retried on the next flush. No loss.
 *   - a BUSINESS rejection (oversell, reposo gate, min-wage, a 4xx the server
 *     deterministically refuses) → the entry moves to `dead` (dead-letter),
 *     surfaced in the UI for the operator to fix/retry/dismiss. Never silently
 *     dropped, never blindly retried (it would just fail again forever).
 *
 * The outbox is storage-agnostic (takes an `OutboxStore` port) and
 * transport-agnostic (takes a `CommandTransport`) so it is fully testable in
 * jsdom with an in-memory store + a scripted transport.
 */

/** What `enqueue()` accepts — the caller's intent, before id/seq stamping. */
export interface CommandInput {
  /** The Postgres RPC name, e.g. `record_weigh_in`. */
  rpc: string;
  /** The snake_case argument envelope the SECURITY DEFINER RPC expects. */
  args: Record<string, unknown>;
  /** Field wall-clock (`occurred_at`) — captured at the moment of the action. */
  occurredAt: string;
  /** The per-install device id (`device_id`). */
  deviceId: string;
  /**
   * Optional explicit exactly-once anchor. Omit and the entry's own uuid is
   * used — but a caller with its own stable key (a retry-safe form) may pass it.
   */
  idempotencyKey?: string;
}

export type OutboxStatus = "queued" | "done" | "dead";

/** A persisted outbox entry — the command plus its replay bookkeeping. */
export interface OutboxEntry extends CommandInput {
  /** Time-ordered v7 id — the FIFO sort key AND default idempotency anchor. */
  uuid: string;
  /** Resolved exactly-once anchor (== uuid unless the caller supplied one). */
  idempotencyKey: string;
  /** Monotonic per-device sequence (`device_seq`). */
  deviceSeq: number;
  status: OutboxStatus;
  /** Number of replay attempts so far (for backoff/telemetry, not behaviour). */
  attempts: number;
  /** The most recent failure message (shown in the dead-letter drawer). */
  lastError?: string;
  /** When this entry was first enqueued (ISO). */
  enqueuedAt: string;
}

/** The result of one transport send — the three outcomes the outbox branches on. */
export type TransportResult =
  | { kind: "ok" }
  | { kind: "network-error"; message?: string }
  | { kind: "rejected"; message?: string };

/** The port that actually delivers a command to the server (a Server Action). */
export interface CommandTransport {
  send(entry: OutboxEntry): Promise<TransportResult>;
}

/** Aggregate result of a `flush()` — what the sync pill summarises. */
export interface FlushSummary {
  sent: number;
  failed: number;
  deadLettered: number;
}

export interface Outbox {
  /** Queue a command for offline-durable replay; returns the stamped entry. */
  enqueue(cmd: CommandInput): Promise<OutboxEntry>;
  /** Drain all `queued` entries FIFO; returns a per-outcome summary. */
  flush(): Promise<FlushSummary>;
  /** All entries (any status), oldest first. */
  list(): Promise<OutboxEntry[]>;
  /** Only the dead-letters (for the drawer). */
  deadLetters(): Promise<OutboxEntry[]>;
  /** Count of entries still awaiting send (`queued`). */
  pendingCount(): Promise<number>;
  /** Revive a dead-letter back to `queued` for an explicit re-send. */
  retry(uuid: string): Promise<void>;
  /** Permanently delete an entry (a dead-letter the operator gives up on). */
  dismiss(uuid: string): Promise<void>;
  /** Subscribe to any queue change (enqueue/flush/retry/dismiss). */
  subscribe(fn: () => void): () => void;
}

const ENTRY_PREFIX = "cmd:";

export function createOutbox(deps: {
  store: OutboxStore;
  transport: CommandTransport;
}): Outbox {
  const { store, transport } = deps;
  const subscribers = new Set<() => void>();

  function notify(): void {
    for (const fn of subscribers) fn();
  }

  async function allEntries(): Promise<OutboxEntry[]> {
    const rows = await store.getAll<OutboxEntry>();
    // Only our command rows (the store also holds device id/seq bookkeeping),
    // oldest first by the time-ordered uuid (insertion order already matches,
    // but sorting on the v7 id makes FIFO explicit and reload-stable).
    return rows
      .filter(
        (r): r is OutboxEntry =>
          !!r && typeof (r as OutboxEntry).uuid === "string",
      )
      .sort((a, b) => (a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0));
  }

  async function enqueue(cmd: CommandInput): Promise<OutboxEntry> {
    const uuid = uuidv7();
    const deviceSeq = await nextDeviceSeq(store);
    const entry: OutboxEntry = {
      ...cmd,
      uuid,
      idempotencyKey: cmd.idempotencyKey ?? uuid,
      deviceSeq,
      status: "queued",
      attempts: 0,
      enqueuedAt: new Date().toISOString(),
    };
    await store.put(ENTRY_PREFIX + uuid, entry);
    notify();
    return entry;
  }

  async function flush(): Promise<FlushSummary> {
    const summary: FlushSummary = { sent: 0, failed: 0, deadLettered: 0 };
    const entries = await allEntries();
    for (const entry of entries) {
      if (entry.status !== "queued") continue; // done/dead are never re-sent.

      const attempted: OutboxEntry = { ...entry, attempts: entry.attempts + 1 };
      const result = await transport.send(attempted);

      if (result.kind === "ok") {
        attempted.status = "done";
        attempted.lastError = undefined;
        await store.put(ENTRY_PREFIX + entry.uuid, attempted);
        summary.sent += 1;
      } else if (result.kind === "network-error") {
        // STAYS queued — the canonical "try again when there's signal" path.
        attempted.lastError = result.message ?? "network unavailable";
        await store.put(ENTRY_PREFIX + entry.uuid, attempted);
        summary.failed += 1;
      } else {
        // BUSINESS rejection — dead-letter, surfaced, never blindly retried.
        attempted.status = "dead";
        attempted.lastError = result.message ?? "rejected by the server";
        await store.put(ENTRY_PREFIX + entry.uuid, attempted);
        summary.deadLettered += 1;
      }
    }
    notify();
    return summary;
  }

  async function list(): Promise<OutboxEntry[]> {
    return allEntries();
  }

  async function deadLetters(): Promise<OutboxEntry[]> {
    return (await allEntries()).filter((e) => e.status === "dead");
  }

  async function pendingCount(): Promise<number> {
    return (await allEntries()).filter((e) => e.status === "queued").length;
  }

  async function retry(uuid: string): Promise<void> {
    const entry = await store.get<OutboxEntry>(ENTRY_PREFIX + uuid);
    if (!entry) return;
    // Revive to queued, KEEPING the original idempotencyKey + deviceSeq so the
    // server still dedupes the re-send to the same row.
    await store.put(ENTRY_PREFIX + uuid, {
      ...entry,
      status: "queued",
      lastError: undefined,
    });
    notify();
  }

  async function dismiss(uuid: string): Promise<void> {
    await store.delete(ENTRY_PREFIX + uuid);
    notify();
  }

  function subscribe(fn: () => void): () => void {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  return {
    enqueue,
    flush,
    list,
    deadLetters,
    pendingCount,
    retry,
    dismiss,
    subscribe,
  };
}
