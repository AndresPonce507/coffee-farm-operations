/**
 * Isomorphic, monotonic UUIDv7 minter (P2-S0 — the client half of the offline
 * write contract).
 *
 * Why hand-rolled (zero new dependency): the Phase-1 command RPCs already
 * accept a client-minted `idempotency_key` and order replay by it, and the
 * `lot_event` schema reserves `(device_id, device_seq)` for causal ordering.
 * A UUIDv7 is *time-ordered* — its leading 48 bits are a big-endian unix-ms
 * timestamp — so a lexical sort of v7 ids is a chronological sort. That makes it
 * the ideal offline-mintable id: the outbox replays in mint order without a
 * server round-trip, and two devices' ids interleave by wall-clock.
 *
 * Layout (RFC 9562 §5.7):
 *   ─ 48 bits  unix_ts_ms      (the millisecond timestamp)
 *   ─  4 bits  version = 0b0111 (7)
 *   ─ 12 bits  rand_a          (here: an intra-ms monotonic counter, top 12 bits)
 *   ─  2 bits  variant = 0b10  (RFC-4122)
 *   ─ 62 bits  rand_b          (here: counter low bits + CSPRNG entropy)
 *
 * MONOTONICITY is the load-bearing property. Within a single millisecond we
 * increment a 74-bit counter seeded from CSPRNG entropy, so a tight burst still
 * strictly increases. And we clamp the timestamp to never go backwards (NTP
 * step-back safe): if the clock rewinds we keep the last emitted ms and lean on
 * the counter, so the minter NEVER emits a smaller id than its predecessor.
 */

/** Pluggable clock — defaults to `Date.now`; injectable for deterministic tests. */
export type Clock = () => number;

// ── Module-level monotonic state. ──
// `lastMs` is the largest timestamp we have ever emitted (clamps step-back).
// `rand` is the 74-bit randomness/counter split across rand_a (12b) + rand_b
// (62b), held as two halves so we can increment without BigInt on the hot path.
let lastMs = -1;
let randHi = 0; // 12 bits → rand_a
let randLo = 0; // 62 bits → rand_b, held as a JS number (< 2^53 used; see reseed)

const MAX_RAND_LO = 0x3ffffffffffff; // 50 bits actively used of rand_b (safe-int headroom)

function reseed(): void {
  // CSPRNG entropy for the random fields. We only fill the bits we increment,
  // keeping the running counter inside Number.MAX_SAFE_INTEGER so same-ms
  // increments never lose precision.
  const buf = new Uint8Array(8);
  cryptoFill(buf);
  randHi = ((buf[0] << 8) | buf[1]) & 0x0fff; // 12 bits
  // 50 bits of low entropy (leaves headroom under 2^53 for the +1 counter).
  randLo =
    (buf[2] & 0x03) * 0x1000000000000 +
    buf[3] * 0x10000000000 +
    buf[4] * 0x100000000 +
    buf[5] * 0x1000000 +
    buf[6] * 0x10000 +
    (buf[7] << 8);
}

function cryptoFill(buf: Uint8Array): void {
  // `crypto` is available isomorphically: Web Crypto in browsers + Service
  // Workers, and globalThis.crypto in Node ≥ 18. Fall back to Math.random only
  // if no CSPRNG exists at all (never expected on our targets).
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) {
    c.getRandomValues(buf);
    return;
  }
  for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
}

function hex(n: number, width: number): string {
  return n.toString(16).padStart(width, "0");
}

/**
 * Mint a fresh, monotonic UUIDv7. Pass a custom `clock` only in tests; in
 * production it reads the wall clock. The returned string is canonical lower-case
 * 8-4-4-4-12 with the version (7) and RFC-4122 variant nibbles set.
 */
export function uuidv7(clock: Clock = Date.now): string {
  let ms = clock();

  if (ms > lastMs) {
    // New, forward millisecond: adopt it and reseed the random/counter fields.
    lastMs = ms;
    reseed();
  } else {
    // Same ms OR the clock went backwards: hold the last (never-decreasing)
    // timestamp and bump the counter so the id still strictly increases.
    ms = lastMs;
    randLo += 1;
    if (randLo > MAX_RAND_LO) {
      // Counter overflow within a single ms — carry into rand_a, reseed lo.
      randLo = 0;
      randHi = (randHi + 1) & 0x0fff;
      if (randHi === 0) {
        // Exhausted both counters in one ms (astronomically unlikely): advance
        // the synthetic ms so monotonicity holds regardless.
        lastMs += 1;
        ms = lastMs;
        reseed();
      }
    }
  }

  // ── Assemble the 128 bits as hex segments. ──
  // 48-bit timestamp → first 12 hex chars (time_low + time_mid).
  const tsHex = hex(ms, 12); // ms < 2^48 ⇒ ≤ 12 hex
  const timeLow = tsHex.slice(0, 8);
  const timeMid = tsHex.slice(8, 12);

  // version (7) + 12-bit rand_a.
  const verAndA = hex(0x7000 | (randHi & 0x0fff), 4);

  // variant (0b10) + top 14 bits of rand_b → the 4th group.
  const hi14 = Math.floor(randLo / 0x1000000000); // top 14 of our 50-bit lo
  const variantAndB = hex(0x8000 | (hi14 & 0x3fff), 4);

  // remaining 36 bits of rand_b → the final 12-hex group.
  const lo36 = randLo % 0x1000000000;
  const node = hex(lo36, 9).padStart(12, "0");

  return `${timeLow}-${timeMid}-${verAndA}-${variantAndB}-${node}`;
}

/** A canonical UUIDv7 matcher — version nibble 7 + RFC-4122 variant. */
const V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** True iff `s` is a well-formed lower-case canonical UUIDv7. */
export function isUuidV7(s: string): boolean {
  return typeof s === "string" && V7_RE.test(s);
}

/** Extract the embedded unix-ms timestamp from a v7 uuid (NaN if malformed). */
export function timestampOfUuidV7(id: string): number {
  if (!isUuidV7(id)) return NaN;
  const hexTs = id.slice(0, 8) + id.slice(9, 13);
  return parseInt(hexTs, 16);
}
