import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { webShareAdapter } from "@/lib/integration/dispatch/adapters/web-share";
import type { DispatchDeliveryInput } from "@/lib/integration/dispatch/port";

/**
 * P2-S5 — the $0 DEFAULT delivery adapter (web-share / copy-link).
 *
 * This is the genuinely-free path: the device's native share sheet (the manager
 * shares the prepared bilingual card into the crew-lead WhatsApp group manually),
 * falling back to the clipboard ("copy link") when no share sheet exists. It
 * touches NO paid API and costs $0. It must be SSR-safe (guard every browser
 * global) so it can never throw when `navigator` is absent.
 */

const input: DispatchDeliveryInput = {
  runId: 42,
  title: "Cuadrilla Norte — 21 jun",
  text: "Plots: La Loma, El Río — ripe today / maduros hoy",
  url: "https://example.test/dispatch/42",
};

// Snapshot whatever jsdom's navigator looks like so each test starts clean.
const originalNavigator = globalThis.navigator;

function setNavigator(value: unknown): void {
  Object.defineProperty(globalThis, "navigator", {
    value,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  setNavigator(originalNavigator);
  vi.restoreAllMocks();
});

describe("webShareAdapter — the $0 default", () => {
  it("declares the web-share channel and is always enabled", () => {
    expect(webShareAdapter.channel).toBe("web-share");
    expect(webShareAdapter.isEnabled()).toBe(true);
  });

  it("prefers the native share sheet when navigator.share exists", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    // No clipboard on purpose: native share must win when both could exist.
    setNavigator({ share });

    const result = await webShareAdapter.deliver(input);

    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({
      title: input.title,
      text: input.text,
      url: input.url,
    });
    expect(result).toEqual({ ok: true, channel: "web-share", via: "native-share" });
  });

  it("falls back to the clipboard (copy-link) when no share sheet exists", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator({ clipboard: { writeText } });

    const result = await webShareAdapter.deliver(input);

    expect(writeText).toHaveBeenCalledTimes(1);
    // The clipboard gets a useful, self-contained string (the card text + link).
    const written = writeText.mock.calls[0][0] as string;
    expect(written).toContain(input.text);
    expect(written).toContain(input.url as string);
    expect(result).toEqual({ ok: true, channel: "web-share", via: "clipboard" });
  });

  it("returns ok:false when neither share nor clipboard is available", async () => {
    setNavigator({}); // a navigator with no share and no clipboard.

    const result = await webShareAdapter.deliver(input);

    expect(result).toEqual({
      ok: false,
      reason: "no share or clipboard available",
    });
  });

  it("is SSR-safe — no throw and ok:false when navigator is undefined", async () => {
    setNavigator(undefined);

    const result = await webShareAdapter.deliver(input);

    expect(result).toEqual({
      ok: false,
      reason: "no share or clipboard available",
    });
  });

  it("does not crash the caller when the share sheet is dismissed (rejects)", async () => {
    // A user dismissing the native share sheet rejects the promise — that is a
    // non-fatal cancel, not a delivery success.
    const share = vi.fn().mockRejectedValue(new DOMException("Abort", "AbortError"));
    setNavigator({ share });

    const result = await webShareAdapter.deliver(input);

    expect(result.ok).toBe(false);
  });
});
