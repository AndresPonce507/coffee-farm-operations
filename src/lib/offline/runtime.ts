import { createIdbStore } from "./db-idb";
import { offlineEnabled } from "./flag";
import { createOutbox, type CommandTransport, type OutboxEntry } from "./outbox";
import { createMemoryStore, type OutboxStore } from "./storage";
import { createSyncEngine, type SyncEngine } from "./sync";
import { makeEnqueueCommand } from "./enqueueCommand";

/**
 * The browser-singleton offline runtime (P2-S0).
 *
 * Lazily constructs ONE outbox + sync engine per tab, bound to durable
 * IndexedDB (falling back to in-memory if the platform can't persist), and a
 * pluggable command-router transport. Later field-capture slices REGISTER their
 * Server Action against an `rpc` name; until any are registered the transport
 * dead-letters with a clear message rather than losing the write — but in S0 no
 * capture surface enqueues yet, so the substrate is inert-but-ready.
 *
 * `getEnqueueCommand()` is the single entry point the field surfaces call.
 */

type ActionFn = (envelope: {
  rpc: string;
  args: Record<string, unknown>;
  occurredAt: string;
  deviceId: string;
  deviceSeq: number;
  idempotencyKey: string;
}) => Promise<{ ok: true } | { ok: false; message?: string }>;

interface Runtime {
  store: OutboxStore;
  outbox: ReturnType<typeof createOutbox>;
  engine: SyncEngine;
  enqueueCommand: ReturnType<typeof makeEnqueueCommand>;
}

// The per-rpc Server Action registry. Field slices call `registerCommand`.
const registry = new Map<string, ActionFn>();

/** Register the Server Action that delivers a given command rpc (called by S2+). */
export function registerCommand(rpc: string, action: ActionFn): void {
  registry.set(rpc, action);
}

/**
 * The built-in command handler for the genesis field event, `record_weigh_in`
 * (P2-S2). Without this, every offline-captured weigh-in would dead-letter at
 * `routerTransport` ("No handler registered") and NEVER reach the server —
 * silent field-data loss on the most-used screen. This is the transport the S0
 * outbox replays each queued weigh-in against on reconnect.
 *
 * It bridges the durable queue envelope to the Server Action:
 *   - the queued `args` are the snake_case `p_*` RPC envelope; the action reads
 *     camelCase form fields and rebuilds that envelope server-side, so we map
 *     `p_*` back to the field names and post a `FormData` (the action's input);
 *   - the outbox-stamped monotonic `deviceSeq` (not the raw client `0`) is sent
 *     so the replay carries the same `(device_id, device_seq)` the queue minted;
 *   - a `success` result → `{ ok: true }` (entry marked `done`);
 *   - a deterministic `error` result → `{ ok: false, message }` (dead-letter,
 *     surfaced for the operator — never blindly retried);
 *   - a THROW (the RSC/Server-Action call itself failed: offline, 5xx) is left
 *     to propagate so `routerTransport` classifies it `network-error` and the
 *     entry STAYS queued for the next reconnect — no loss, no false dead-letter.
 */
const recordWeighInHandler: ActionFn = async (envelope) => {
  // Lazy import so the `"use server"` graph (next/cache, Supabase) is pulled in
  // only when a weigh-in actually drains — never at module load (keeps the
  // runtime importable in any environment, SSR or test, and tree-light).
  const { recordWeighInAction } = await import("@/app/(app)/weigh/actions");

  const a = envelope.args;
  const form = new FormData();
  const set = (key: string, value: unknown) => {
    if (value !== null && value !== undefined) form.set(key, String(value));
  };
  // p_* RPC envelope → the camelCase form fields recordWeighInAction reads.
  set("workerId", a.p_worker_id);
  set("plotId", a.p_plot_id);
  set("cherriesKg", a.p_cherries_kg);
  set("ripeness", a.p_ripeness);
  set("brix", a.p_brix);
  set("scaleSource", a.p_scale_source);
  set("capturedLat", a.p_captured_lat);
  set("capturedLng", a.p_captured_lng);
  // Envelope identity wins over the (placeholder) args copies: occurred_at and
  // the exactly-once key live on the entry; device_seq is the outbox-stamped
  // monotonic value, not the client-side `0` the capture surface enqueues.
  set("occurredAt", envelope.occurredAt);
  set("deviceId", envelope.deviceId);
  set("deviceSeq", envelope.deviceSeq);
  set("idempotencyKey", envelope.idempotencyKey);

  // A THROW here (network/RSC failure) intentionally escapes to routerTransport,
  // which maps it to network-error so the entry stays queued.
  const result = await recordWeighInAction(form);
  if (result.status === "success") return { ok: true };
  // Any non-success resolution is a deterministic server-side rejection →
  // dead-letter, surfacing the message (only the "error" variant carries one).
  return {
    ok: false,
    message: result.status === "error" ? result.message : undefined,
  };
};

/**
 * Register the built-in command handlers (idempotent). Called once when the
 * runtime is constructed so the genesis weigh-in path is live the moment any
 * surface enqueues — no separate init island required for the core capture loop.
 */
function registerBuiltins(): void {
  if (!registry.has("record_weigh_in")) {
    registry.set("record_weigh_in", recordWeighInHandler);
  }
}

/** The router transport — dispatches each entry to its registered action. */
function routerTransport(): CommandTransport {
  return {
    async send(entry: OutboxEntry) {
      const action = registry.get(entry.rpc);
      if (!action) {
        // No handler yet — dead-letter (don't pretend it sent, don't silently
        // drop). Visible in the drawer; a later slice registering the rpc + a
        // retry will deliver it.
        return {
          kind: "rejected" as const,
          message: `No handler registered for "${entry.rpc}" yet.`,
        };
      }
      try {
        const result = await action({
          rpc: entry.rpc,
          // The outbox owns the DURABLE identity: stamp the minted, monotonic
          // `device_seq` (and the install `device_id`) onto the args so every
          // command RPC — which reads `args.p_device_seq`/`args.p_device_id` —
          // receives the queue's value, never the placeholder a capture surface
          // bakes in (it can only mint a client-side `0`). Without this, every
          // capture on a screen mount carries the same seq and collides on
          // `unique (device_id, device_seq)`.
          args: {
            ...entry.args,
            p_device_seq: entry.deviceSeq,
            p_device_id: entry.deviceId,
          },
          occurredAt: entry.occurredAt,
          deviceId: entry.deviceId,
          deviceSeq: entry.deviceSeq,
          idempotencyKey: entry.idempotencyKey,
        });
        if (result.ok) return { kind: "ok" as const };
        return { kind: "rejected" as const, message: result.message };
      } catch (err) {
        return {
          kind: "network-error" as const,
          message: err instanceof Error ? err.message : "network unavailable",
        };
      }
    },
  };
}

let runtime: Runtime | null = null;

/** Build (once) and return the tab-singleton runtime. */
export function getRuntime(): Runtime {
  if (runtime) return runtime;

  // Wire the built-in field-capture handlers (record_weigh_in, …) before the
  // outbox can drain, so a queued genesis weigh-in delivers instead of
  // dead-lettering for a missing handler.
  registerBuiltins();

  const enabled = offlineEnabled();
  // Durable IndexedDB when capable; in-memory keeps online-only fully working.
  const store: OutboxStore =
    enabled && typeof window !== "undefined"
      ? createIdbStore()
      : createMemoryStore();

  const outbox = createOutbox({ store, transport: routerTransport() });
  const engine = createSyncEngine({ outbox });
  const enqueueCommand = makeEnqueueCommand({ outbox, offlineEnabled: enabled });

  runtime = { store, outbox, engine, enqueueCommand };
  return runtime;
}

/** The single call every field-capture surface uses to write a command. */
export function getEnqueueCommand() {
  return getRuntime().enqueueCommand;
}
