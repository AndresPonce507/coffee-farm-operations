/**
 * The outbox storage port (P2-S0).
 *
 * The outbox and the device-identity counter persist through a narrow async
 * key-value port — the same ports-and-adapters discipline the Phase-1 command
 * write-doors use (`CherryIntakeStore` takes exactly the one `.rpc` it needs).
 *
 * Two adapters implement it:
 *   - `createMemoryStore()` — an in-process Map, the test double (so the whole
 *     outbox/sync engine is provable in jsdom with ZERO new dependencies and no
 *     `fake-indexeddb`), and the graceful-degradation fallback when a browser
 *     has no IndexedDB (private mode / locked-down WebView).
 *   - `createIdbStore()` (see `db-idb.ts`) — durable IndexedDB, the real field
 *     persistence that survives a reload, a crash, or the tab being closed.
 *
 * Insertion order is part of the contract: `getAll()` returns records oldest →
 * newest so the outbox drains FIFO without a sort key.
 */
export interface OutboxStore {
  /** Read one record by key, or `undefined` if absent. */
  get<T = unknown>(key: string): Promise<T | undefined>;
  /** Every record, oldest-inserted first (insertion order preserved). */
  getAll<T = unknown>(): Promise<T[]>;
  /** Insert or replace a record under `key` (in-place update keeps its order). */
  put(key: string, value: unknown): Promise<void>;
  /** Remove a record (no-op if absent). */
  delete(key: string): Promise<void>;
}

/**
 * In-memory adapter. A `Map` preserves insertion order natively, and an
 * in-place `set` on an existing key keeps that key's original position — exactly
 * the order semantics the port promises. Values are structuredClone-d on the way
 * in/out so callers can't mutate stored state by reference (mirroring how
 * IndexedDB stores a structured clone, so the two adapters behave identically).
 */
export function createMemoryStore(): OutboxStore {
  const map = new Map<string, unknown>();
  const clone = <T>(v: T): T =>
    typeof structuredClone === "function"
      ? structuredClone(v)
      : (JSON.parse(JSON.stringify(v)) as T);

  return {
    async get<T>(key: string) {
      const v = map.get(key);
      return v === undefined ? undefined : (clone(v) as T);
    },
    async getAll<T>() {
      return Array.from(map.values()).map((v) => clone(v) as T);
    },
    async put(key, value) {
      map.set(key, clone(value));
    },
    async delete(key) {
      map.delete(key);
    },
  };
}
