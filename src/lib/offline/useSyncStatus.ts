"use client";

import { useEffect, useState } from "react";

import { getRuntime } from "./runtime";
import type { OutboxEntry } from "./outbox";
import type { SyncState } from "./sync";

/**
 * `useSyncStatus()` (P2-S0) — subscribes the sync pill + outbox drawer to the
 * tab-singleton engine. Returns the live `SyncState` plus the dead-letter list
 * and the operator actions (retry/dismiss/flush) the drawer surfaces.
 *
 * Starts the engine on mount (begins listening for online/offline + does an
 * initial drain) and stops it on unmount.
 */
export interface SyncStatusApi {
  state: SyncState;
  deadLetters: OutboxEntry[];
  pending: OutboxEntry[];
  retry: (uuid: string) => Promise<void>;
  dismiss: (uuid: string) => Promise<void>;
  flush: () => Promise<void>;
}

export function useSyncStatus(): SyncStatusApi {
  const { engine, outbox } = getRuntime();
  const [state, setState] = useState<SyncState>(() => engine.getState());
  const [entries, setEntries] = useState<OutboxEntry[]>([]);

  useEffect(() => {
    let alive = true;
    const reloadEntries = () => {
      void outbox.list().then((list) => {
        if (alive) setEntries(list);
      });
    };

    const unsubEngine = engine.subscribe((s) => {
      if (alive) setState(s);
      reloadEntries();
    });

    void engine.start();
    reloadEntries();

    return () => {
      alive = false;
      unsubEngine();
      engine.stop();
    };
  }, [engine, outbox]);

  // A manual recovery action (the drawer's Retry, the "sync now" flush) must
  // DRIVE A SEND, not merely recompute the badge: `engine.refresh()` only
  // re-counts pending/dead, so wiring retry/flush to it left a revived
  // dead-letter flipped dead→queued but never re-sent — silently stuck until an
  // unrelated `online` event happened to drain. `drain()` (the real send path)
  // is internal to the engine, but the runtime's outbox is in hand here, so we
  // flush it directly. When offline we skip the send and just refresh — the
  // revived entry stays `queued` and drains on the next reconnect (mirroring the
  // engine's own offline guard), so the offline-tap path is unaffected.
  const drain = async () => {
    if (engine.getState().online) await outbox.flush();
    await engine.refresh();
  };

  return {
    state,
    deadLetters: entries.filter((e) => e.status === "dead"),
    pending: entries.filter((e) => e.status === "queued"),
    retry: (uuid) => outbox.retry(uuid).then(drain),
    // dismiss deletes an entry — there is nothing to send, just recompute.
    dismiss: (uuid) => outbox.dismiss(uuid).then(() => engine.refresh()),
    flush: drain,
  };
}
