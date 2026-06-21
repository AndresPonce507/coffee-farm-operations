/**
 * Offline-first PWA + sync-outbox substrate (Phase-2 · P2-S0).
 *
 * The client half of the offline write contract: a command queued offline and
 * replayed on reconnect, exactly-once via the `idempotency_key` the Phase-1
 * command RPCs already dedupe on, with dead-letter handling and a visible
 * sync-status pill. Every later field-capture slice (S2 weigh, S1 attendance,
 * S3/S4 readings, S12 scouting) writes through `getEnqueueCommand()` instead of
 * a raw Server Action.
 *
 * Public surface (deep imports also work; this barrel is the convenience door):
 */
export { uuidv7, isUuidV7, timestampOfUuidV7 } from "./uuidv7";
export type { Clock } from "./uuidv7";

export { createMemoryStore } from "./storage";
export type { OutboxStore } from "./storage";

export { createIdbStore, idbAvailable } from "./db-idb";

export { getDeviceId, nextDeviceSeq } from "./device";

export { createOutbox } from "./outbox";
export type {
  Outbox,
  OutboxEntry,
  OutboxStatus,
  CommandInput,
  CommandTransport,
  TransportResult,
  FlushSummary,
} from "./outbox";

export { createSyncEngine, deriveSyncState } from "./sync";
export type { SyncEngine, SyncState, SyncStatus, SyncFacts } from "./sync";

export { makeEnqueueCommand } from "./enqueueCommand";
export type { EnqueueResult, EnqueueOutcome } from "./enqueueCommand";

export { makeServerActionTransport } from "./transport";
export type {
  CommandEnvelope,
  ServerAction,
  ServerActionResult,
} from "./transport";

export {
  offlineEnabled,
  offlineFlagEnabled,
  offlineCapable,
} from "./flag";

export { getRuntime, getEnqueueCommand, registerCommand } from "./runtime";

export { useSyncStatus } from "./useSyncStatus";
export type { SyncStatusApi } from "./useSyncStatus";
