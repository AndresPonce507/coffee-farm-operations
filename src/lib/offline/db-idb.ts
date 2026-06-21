import type { OutboxStore } from "./storage";

/**
 * Hand-rolled IndexedDB adapter for the outbox store (P2-S0) — the durable,
 * survives-a-reload persistence the field needs, with ZERO dependency (`idb`
 * was rejected to stay $0/lean per the spec's decision flag).
 *
 * It is a thin shim: one object store, keyPath-free (we pass the key
 * explicitly), preserving insertion order via an auto-incrementing `_seq` index
 * so `getAll()` returns oldest → newest. The outbox/sync logic — the part with
 * real branching — is tested against the in-memory adapter in jsdom; this file
 * is the minimal, side-effecty translation to the real database, exercised in
 * the browser.
 */

const DB_NAME = "janson-offline";
const DB_VERSION = 1;
const STORE = "outbox";

/** Is IndexedDB usable in this runtime? (SSR + locked-down WebViews say no.) */
export function idbAvailable(): boolean {
  try {
    return (
      typeof indexedDB !== "undefined" && indexedDB !== null
    );
  } catch {
    return false;
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // keyPath-free: we supply the out-of-line key on every put. A `_seq`
        // index gives a stable insertion order for getAll().
        const os = db.createObjectStore(STORE);
        os.createIndex("_seq", "_seq", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Build the IndexedDB-backed store. Lazily opens the database on first use and
 * keeps the connection. Each record is wrapped with a monotonic `_seq` so
 * `getAll()` honors the port's insertion-order contract.
 */
export function createIdbStore(): OutboxStore {
  let dbp: Promise<IDBDatabase> | null = null;
  const db = () => (dbp ??= openDb());

  async function tx<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
  ): Promise<T> {
    const database = await db();
    return new Promise<T>((resolve, reject) => {
      const t = database.transaction(STORE, mode);
      const os = t.objectStore(STORE);
      const out = fn(os);
      if (out instanceof Promise) {
        out.then(resolve, reject);
      } else {
        out.onsuccess = () => resolve(out.result);
        out.onerror = () => reject(out.error);
      }
      t.onabort = () => reject(t.error);
    });
  }

  // A best-effort monotonic sequence for ordering. Seeded from the current max
  // on first write so it survives reloads.
  let seq = 0;
  let seqSeeded = false;
  async function nextSeq(): Promise<number> {
    if (!seqSeeded) {
      const all = await tx<{ _seq: number }[]>("readonly", (os) =>
        promisify(os.getAll() as IDBRequest<{ _seq: number }[]>),
      );
      seq = all.reduce((m, r) => Math.max(m, r?._seq ?? 0), 0);
      seqSeeded = true;
    }
    return ++seq;
  }

  return {
    async get<T>(key: string) {
      const rec = await tx<{ value: unknown } | undefined>("readonly", (os) =>
        promisify(os.get(key) as IDBRequest<{ value: unknown } | undefined>),
      );
      return rec === undefined ? undefined : (rec.value as T);
    },
    async getAll<T>() {
      const recs = await tx<{ value: unknown; _seq: number }[]>(
        "readonly",
        (os) =>
          promisify(
            os.getAll() as IDBRequest<{ value: unknown; _seq: number }[]>,
          ),
      );
      return recs
        .slice()
        .sort((a, b) => a._seq - b._seq)
        .map((r) => r.value as T);
    },
    async put(key, value) {
      // Preserve the original _seq on an in-place update so order is stable.
      const existing = await tx<{ _seq: number } | undefined>(
        "readonly",
        (os) =>
          promisify(os.get(key) as IDBRequest<{ _seq: number } | undefined>),
      );
      const _seq = existing?._seq ?? (await nextSeq());
      await tx<IDBValidKey>("readwrite", (os) =>
        promisify(os.put({ value, _seq }, key)),
      );
    },
    async delete(key) {
      await tx<undefined>("readwrite", (os) => promisify(os.delete(key)));
    },
  };
}
