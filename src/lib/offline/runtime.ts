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
          args: entry.args,
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
