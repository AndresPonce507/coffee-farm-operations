import type { Outbox } from "./outbox";

/**
 * The sync engine (P2-S0) — watches connectivity, drains the outbox on
 * reconnect, and projects a single `SyncState` the pill renders.
 *
 * `deriveSyncState` is the pure projection (a tiny precedence machine, tested in
 * isolation); `createSyncEngine` is the live wiring over `navigator.onLine` and
 * the `online`/`offline` window events. Both `win`/`nav` are injectable so the
 * engine is testable with fakes in jsdom (whose `navigator.onLine` is read-only).
 */

export type SyncStatus =
  | "synced" // online, nothing queued, nothing failed — all safe on the server.
  | "pending" // online, entries waiting, not currently sending.
  | "syncing" // online, actively draining the queue.
  | "offline" // no connectivity — entries are held safely on-device.
  | "failed"; // one or more dead-letters need attention.

export interface SyncState {
  status: SyncStatus;
  online: boolean;
  pending: number;
  dead: number;
  syncing: boolean;
}

/** Inputs to the projection — the raw facts the status is derived from. */
export interface SyncFacts {
  online: boolean;
  pending: number;
  dead: number;
  syncing: boolean;
}

/**
 * Pure status projection with a deliberate precedence:
 *   offline  ▸ if there is no connectivity, that is the headline (the picker in
 *              the dead zone needs to see "offline · safe", not "pending").
 *   syncing  ▸ actively draining right now.
 *   failed   ▸ online + dead-letters → attention needed (ranked above pending so
 *              a stuck rejection is never hidden behind a healthy queue).
 *   pending  ▸ online + entries waiting, idle.
 *   synced   ▸ online + empty + clean.
 */
export function deriveSyncState(f: SyncFacts): SyncStatus {
  if (!f.online) return "offline";
  if (f.syncing) return "syncing";
  if (f.dead > 0) return "failed";
  if (f.pending > 0) return "pending";
  return "synced";
}

export interface SyncEngine {
  /** The current state snapshot. */
  getState(): SyncState;
  /** Recompute from the store + connectivity (after an enqueue, say). */
  refresh(): Promise<void>;
  /** Begin listening for online/offline + do an initial refresh+drain. */
  start(): Promise<void>;
  /** Stop listening (component unmount). */
  stop(): void;
  /** Subscribe to state changes (the React island uses this). */
  subscribe(fn: (s: SyncState) => void): () => void;
}

export function createSyncEngine(deps: {
  outbox: Outbox;
  /** Defaults to the global `window`; injectable for tests. */
  win?: Pick<Window, "addEventListener" | "removeEventListener">;
  /** Defaults to the global `navigator`; injectable for tests. */
  nav?: Pick<Navigator, "onLine">;
}): SyncEngine {
  const { outbox } = deps;
  const win =
    deps.win ??
    (typeof window !== "undefined" ? window : undefined);
  const nav =
    deps.nav ??
    (typeof navigator !== "undefined" ? navigator : undefined);

  const subscribers = new Set<(s: SyncState) => void>();
  let state: SyncState = {
    status: "synced",
    online: true,
    pending: 0,
    dead: 0,
    syncing: false,
  };
  let unsubOutbox: (() => void) | null = null;

  function isOnline(): boolean {
    return nav ? nav.onLine !== false : true;
  }

  function emit(): void {
    const snapshot = { ...state };
    for (const fn of subscribers) fn(snapshot);
  }

  function setSyncing(syncing: boolean): void {
    state = {
      ...state,
      syncing,
      status: deriveSyncState({ ...state, syncing }),
    };
    emit();
  }

  async function refresh(): Promise<void> {
    const [pending, dead] = await Promise.all([
      outbox.pendingCount(),
      outbox.deadLetters().then((d) => d.length),
    ]);
    const online = isOnline();
    state = {
      online,
      pending,
      dead,
      syncing: state.syncing,
      status: deriveSyncState({ online, pending, dead, syncing: state.syncing }),
    };
    emit();
  }

  async function drain(): Promise<void> {
    if (!isOnline()) {
      await refresh();
      return;
    }
    const pending = await outbox.pendingCount();
    if (pending === 0) {
      await refresh();
      return;
    }
    setSyncing(true);
    try {
      await outbox.flush();
    } finally {
      setSyncing(false);
      await refresh();
    }
  }

  const onOnline = () => {
    void drain();
  };
  const onOffline = () => {
    void refresh();
  };

  async function start(): Promise<void> {
    win?.addEventListener("online", onOnline);
    win?.addEventListener("offline", onOffline);
    // Any outbox change (a new enqueue) refreshes the pill immediately.
    unsubOutbox = outbox.subscribe(() => {
      void refresh();
    });
    await drain();
  }

  function stop(): void {
    win?.removeEventListener("online", onOnline);
    win?.removeEventListener("offline", onOffline);
    unsubOutbox?.();
    unsubOutbox = null;
  }

  return {
    getState: () => ({ ...state }),
    refresh,
    start,
    stop,
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
