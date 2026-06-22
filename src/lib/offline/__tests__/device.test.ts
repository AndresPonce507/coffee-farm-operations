import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryStore } from "@/lib/offline/storage";
import {
  __resetDeviceIdCache,
  getDeviceId,
  nextDeviceSeq,
  resolveDeviceId,
} from "@/lib/offline/device";

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

/**
 * `resolveDeviceId` is the seam-ready accessor every enqueue stamps the
 * persistent `device_id` with (the wiring the earlier-orphaned `getDeviceId`
 * needed). It is the regression guard for the LOW feature gap that left
 * `getDeviceId` with zero production callers while the capture surface minted an
 * EPHEMERAL per-mount id: the resolved id must be the SAME stable value across
 * every enqueue and across a reload — never a fresh id each time — so a device's
 * `(device_id, device_seq)` event stream stays causally coherent.
 */
describe("resolveDeviceId — the stamping seam", () => {
  let store = createMemoryStore();

  beforeEach(() => {
    store = createMemoryStore();
    __resetDeviceIdCache();
  });

  it("returns the SAME id across two enqueues (no per-call ephemeral id)", async () => {
    const first = await resolveDeviceId(store);
    const second = await resolveDeviceId(store);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(second).toBe(first);
  });

  it("equals the persisted getDeviceId — it stamps the persisted identity, not a fresh one", async () => {
    const stamped = await resolveDeviceId(store);
    const persisted = await getDeviceId(store);
    expect(stamped).toBe(persisted);
  });

  it("survives a reload: a fresh module cache over the SAME store reads the same id back", async () => {
    const before = await resolveDeviceId(store);
    // simulate a tab reload — drop the in-memory memo, keep the durable store.
    __resetDeviceIdCache();
    const after = await resolveDeviceId(store);
    expect(after).toBe(before);
  });

  it("coalesces concurrent first-resolves to a single minted id (no double-mint race)", async () => {
    // Two enqueues firing before the first persist completes must NOT each mint
    // their own id — they share the one in-flight resolution.
    const [a, b] = await Promise.all([
      resolveDeviceId(store),
      resolveDeviceId(store),
    ]);
    expect(b).toBe(a);
    expect(await getDeviceId(store)).toBe(a);
  });
});
