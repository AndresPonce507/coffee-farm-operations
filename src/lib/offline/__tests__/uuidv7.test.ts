import { describe, expect, it } from "vitest";

import {
  isUuidV7,
  timestampOfUuidV7,
  uuidv7,
} from "@/lib/offline/uuidv7";

/**
 * UUIDv7 minter — the isomorphic, client-mintable id the field write contract
 * needs (P2-S0). It must be:
 *   - format-correct (canonical 8-4-4-4-12, version nibble 7, RFC-4122 variant),
 *   - time-ordered (the leading 48 bits are a big-endian unix-ms timestamp), and
 *   - MONOTONIC within a process even when many ids are minted in the same ms
 *     (so the outbox FIFO order is stable and `device_seq` causality holds).
 *
 * These are the load-bearing properties downstream: the DB dedupes on the
 * idempotency_key (often this uuid) and orders replay by it.
 */
describe("uuidv7", () => {
  it("mints a canonical v7 uuid (8-4-4-4-12, version 7, RFC-4122 variant)", () => {
    const id = uuidv7();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(isUuidV7(id)).toBe(true);
  });

  it("rejects non-v7 strings via isUuidV7", () => {
    // a v4 uuid (version nibble 4) must not pass the v7 guard.
    expect(isUuidV7("3f1a8c2e-1d4b-4a9c-9e7f-0123456789ab")).toBe(false);
    expect(isUuidV7("not-a-uuid")).toBe(false);
    expect(isUuidV7("")).toBe(false);
  });

  it("encodes the current unix-ms timestamp in the leading 48 bits", () => {
    const before = Date.now();
    const id = uuidv7();
    const after = Date.now();
    const ts = timestampOfUuidV7(id);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("is strictly monotonic across a tight burst (same-ms ids still sort)", () => {
    const ids: string[] = [];
    for (let i = 0; i < 5000; i++) ids.push(uuidv7());
    // every id strictly greater than its predecessor as a lexical string —
    // because v7 is hex and time-ordered, lexical sort == chronological sort.
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i] > ids[i - 1]).toBe(true);
    }
    // and they are all distinct.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps minting monotonically even if the clock goes backwards", () => {
    // Pin a clock we can rewind. The minter must never emit a smaller id than
    // the last one it emitted, even under NTP step-back.
    let now = 1_700_000_000_000;
    const clock = () => now;
    const a = uuidv7(clock);
    now -= 50; // clock steps backwards
    const b = uuidv7(clock);
    expect(b > a).toBe(true);
  });
});
