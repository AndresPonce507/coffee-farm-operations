import type { OutboxStore } from "./storage";
import { uuidv7 } from "./uuidv7";

/**
 * Per-install device identity (P2-S0).
 *
 * The Phase-1 `lot_event` schema reserves `(device_id, device_seq)` as the
 * causal-ordering key for offline writes. This module mints and persists both:
 *   - `device_id` — a stable per-install UUIDv7 (the SAME value every session,
 *     so a device's event stream is coherent across reloads). Minted once and
 *     stored; read thereafter.
 *   - `device_seq` — a monotonic per-device counter that NEVER repeats, the
 *     Lamport-style cursor each write stamps. Persisted so a reload continues
 *     the count instead of restarting (which would collide on the unique
 *     `(device_id, device_seq)` key — the exact serverless-cold-start bug the
 *     Phase-1 harvest action's `randomDeviceSeq` worked around).
 */

const DEVICE_ID_KEY = "__device_id__";
const DEVICE_SEQ_KEY = "__device_seq__";

interface DeviceIdRow {
  id: string;
}
interface DeviceSeqRow {
  seq: number;
}

/** The stable per-install device id, minting + persisting it on first call. */
export async function getDeviceId(store: OutboxStore): Promise<string> {
  const existing = await store.get<DeviceIdRow>(DEVICE_ID_KEY);
  if (existing?.id) return existing.id;
  const id = uuidv7();
  await store.put(DEVICE_ID_KEY, { id } satisfies DeviceIdRow);
  return id;
}

/**
 * The enqueue-seam accessor: resolve the persistent `device_id` ONCE per tab and
 * memoize it, so every command stamps the SAME stable per-install identity
 * instead of a fresh per-mount ephemeral id.
 *
 * Why this exists: `getDeviceId` persists the id, but until a caller resolves it
 * at the write seam the value is orphaned — the capture surface was substituting
 * a `weigh-<random>` id minted afresh each mount, so across a reload one device
 * looked like a new device every session and the `(device_id, device_seq)`
 * causal key the lot_event schema reserves was incoherent. This is the single
 * call the runtime / capture seam awaits once and stamps onto every
 * `CommandInput.deviceId`.
 *
 * The durable `store` row stays the source of truth: the in-tab cache is a hot
 * path only, and a fresh tab (a reload) reads the SAME id straight back from the
 * store. Concurrent first-resolves coalesce on a single in-flight promise so two
 * simultaneous enqueues never each mint their own id.
 */
let cachedId: string | null = null;
let inflightId: Promise<string> | null = null;

export async function resolveDeviceId(store: OutboxStore): Promise<string> {
  if (cachedId) return cachedId;
  if (inflightId) return inflightId;
  inflightId = (async () => {
    const id = await getDeviceId(store);
    cachedId = id;
    return id;
  })();
  try {
    return await inflightId;
  } finally {
    inflightId = null;
  }
}

/**
 * Test-only: drop the in-tab device-id memo to simulate a fresh tab / reload.
 * Production never calls this — the cache lives for the life of the tab. (No
 * effect on the durable store, so the reloaded tab resolves the same id back.)
 */
export function __resetDeviceIdCache(): void {
  cachedId = null;
  inflightId = null;
}

/**
 * The next monotonic device sequence — reads the persisted counter, increments,
 * writes it back, and returns the new value. Durable across reloads. Callers
 * must `await` so two concurrent enqueues serialize on the store.
 */
export async function nextDeviceSeq(store: OutboxStore): Promise<number> {
  const row = await store.get<DeviceSeqRow>(DEVICE_SEQ_KEY);
  const next = (row?.seq ?? 0) + 1;
  await store.put(DEVICE_SEQ_KEY, { seq: next } satisfies DeviceSeqRow);
  return next;
}
