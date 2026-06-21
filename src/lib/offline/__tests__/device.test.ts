import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryStore } from "@/lib/offline/storage";
import { getDeviceId, nextDeviceSeq } from "@/lib/offline/device";

/**
 * Per-install device identity (P2-S0):
 *   - `device_id` is a stable per-install UUIDv7 persisted in the store (the
 *     same value every session, so the (device_id, device_seq) causal key is
 *     coherent across reloads),
 *   - `device_seq` is a monotonic per-device counter that NEVER repeats — the
 *     Lamport-style cursor the lot_event schema reserves.
 */
describe("device identity", () => {
  let store = createMemoryStore();

  beforeEach(() => {
    store = createMemoryStore();
  });

  it("mints a v7 device id once and returns the same id thereafter", async () => {
    const a = await getDeviceId(store);
    const b = await getDeviceId(store);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(b).toBe(a); // stable across calls (persisted).
  });

  it("device_seq is strictly monotonic and durable across the store", async () => {
    const s1 = await nextDeviceSeq(store);
    const s2 = await nextDeviceSeq(store);
    const s3 = await nextDeviceSeq(store);
    expect(s2).toBeGreaterThan(s1);
    expect(s3).toBeGreaterThan(s2);
  });

  it("never re-issues a sequence even after a fresh reader over the same store", async () => {
    const first = await nextDeviceSeq(store);
    // a brand-new logical reader (e.g. after reload) over the SAME persisted
    // store must continue the counter, not restart it.
    const second = await nextDeviceSeq(store);
    expect(second).toBe(first + 1);
  });
});
