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

  return {
    state,
    deadLetters: entries.filter((e) => e.status === "dead"),
    pending: entries.filter((e) => e.status === "queued"),
    retry: (uuid) => outbox.retry(uuid).then(() => engine.refresh()),
    dismiss: (uuid) => outbox.dismiss(uuid).then(() => engine.refresh()),
    flush: () => engine.refresh(),
  };
}
