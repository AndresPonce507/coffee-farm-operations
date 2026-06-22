import { afterEach, describe, expect, it, vi } from "vitest";

import {
  offlineCapable,
  offlineEnabled,
  offlineFlagEnabled,
} from "@/lib/offline/flag";

/**
 * The offline kill-switch (P2-S0) — the one documented switch the entire offline
 * substrate hangs off. `offlineFlagEnabled()` reads `NEXT_PUBLIC_OFFLINE`
 * statically (NOT optional-chained, per the repo's Vite/Next env-inlining
 * gotcha), and the SW registrar + transport gate on `offlineEnabled()`.
 *
 * These tests pin the exact disable contract so the kill-switch can never
 * silently rot ("a dead guard is itself an incident"): a regression that makes
 * `off` stop disabling, or the env failing to inline, must turn this suite red.
 *
 * Env note: this file lands in the jsdom "ui" project. There `window` is defined
 * but `indexedDB` is NOT provided by jsdom — so `offlineCapable()` is `false` by
 * default here, which lets us cover the no-IndexedDB branch directly and the
 * present branch by defining `globalThis.indexedDB`. The SSR
 * (`typeof window === "undefined"`) branch is unreachable under jsdom and is
 * covered by the node-env consumers that run with no `window`.
 */

const ORIGINAL_IDB = Object.getOwnPropertyDescriptor(
  globalThis,
  "indexedDB",
);

/** Force a concrete `indexedDB` presence/absence regardless of the jsdom default. */
function setIndexedDB(value: unknown): void {
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    writable: true,
    value,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  // Restore whatever jsdom originally had (or remove our override).
  if (ORIGINAL_IDB) {
    Object.defineProperty(globalThis, "indexedDB", ORIGINAL_IDB);
  } else {
    // jsdom didn't define it — drop any override we added.
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  }
});

describe("offlineFlagEnabled — the kill-switch parse", () => {
  it("defaults ON when NEXT_PUBLIC_OFFLINE is unset (substrate enabled by default)", () => {
    vi.stubEnv("NEXT_PUBLIC_OFFLINE", undefined as unknown as string);
    expect(offlineFlagEnabled()).toBe(true);
  });

  it("stays ON for the explicit enabling values 'on' and '' (only the disable tokens turn it off)", () => {
    vi.stubEnv("NEXT_PUBLIC_OFFLINE", "on");
    expect(offlineFlagEnabled()).toBe(true);

    vi.stubEnv("NEXT_PUBLIC_OFFLINE", "");
    expect(offlineFlagEnabled()).toBe(true);
  });

  it("turns OFF for each documented disable token — 'off', 'false', '0'", () => {
    vi.stubEnv("NEXT_PUBLIC_OFFLINE", "off");
    expect(offlineFlagEnabled()).toBe(false);

    vi.stubEnv("NEXT_PUBLIC_OFFLINE", "false");
    expect(offlineFlagEnabled()).toBe(false);

    vi.stubEnv("NEXT_PUBLIC_OFFLINE", "0");
    expect(offlineFlagEnabled()).toBe(false);
  });

  it("is case-sensitive — 'OFF' does NOT disable (only the exact lowercase token does)", () => {
    // Pins the documented exact-string contract: the disable path is the literal
    // lowercase `off`. If a future "be helpful" lowercasing crept in, the kill
    // semantics would shift — this guards the contract as written.
    vi.stubEnv("NEXT_PUBLIC_OFFLINE", "OFF");
    expect(offlineFlagEnabled()).toBe(true);
  });
});

describe("offlineCapable — runtime platform gate", () => {
  it("is false when IndexedDB is absent (graceful degradation → online-only)", () => {
    setIndexedDB(undefined);
    expect(offlineCapable()).toBe(false);
  });

  it("is true when window + IndexedDB are present", () => {
    setIndexedDB({} as unknown);
    expect(offlineCapable()).toBe(true);
  });
});

describe("offlineEnabled — flag AND capability", () => {
  it("is false whenever the flag is off, regardless of platform capability", () => {
    vi.stubEnv("NEXT_PUBLIC_OFFLINE", "off");
    setIndexedDB({} as unknown); // capable…
    expect(offlineEnabled()).toBe(false); // …but the kill-switch wins.
  });

  it("is false when the flag is on but the platform can't support the substrate", () => {
    vi.stubEnv("NEXT_PUBLIC_OFFLINE", "on");
    setIndexedDB(undefined);
    expect(offlineEnabled()).toBe(false);
  });

  it("is true only when the flag is on AND the platform is capable", () => {
    vi.stubEnv("NEXT_PUBLIC_OFFLINE", "on");
    setIndexedDB({} as unknown);
    expect(offlineEnabled()).toBe(true);
  });
});
