import { afterEach, describe, expect, it, vi } from "vitest";

import { whatsappCloudAdapter } from "@/lib/integration/dispatch/adapters/whatsapp";
import type { DispatchDeliveryInput } from "@/lib/integration/dispatch/port";

/**
 * P2-S5 — the DORMANT, FLAGGED paid drop-in (WhatsApp Business Cloud API).
 *
 * The WhatsApp Cloud API is NOT $0 (user-initiated templates can bill), so it is
 * built behind the seam but stays dormant until the family explicitly opts into
 * the paid tier via a build flag (NEXT_PUBLIC_DISPATCH_WHATSAPP_ENABLED), mirroring
 * the offline substrate's flag. It must NEVER make a real network call here (this
 * is a $0 practice project) — even when the flag is on, with no real client wired
 * it returns a clearly-marked stub failure instead of billing anything.
 */

const input: DispatchDeliveryInput = {
  runId: 7,
  title: "Cuadrilla Sur — 21 jun",
  text: "Plots: El Bosque — ripe today / maduros hoy",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("whatsappCloudAdapter — dormant, flagged paid drop-in", () => {
  it("declares the whatsapp-cloud channel", () => {
    expect(whatsappCloudAdapter.channel).toBe("whatsapp-cloud");
  });

  it("is DISABLED by default (no flag set) — the $0 default uses web-share", () => {
    // No NEXT_PUBLIC_DISPATCH_WHATSAPP_ENABLED in the env => off.
    expect(whatsappCloudAdapter.isEnabled()).toBe(false);
  });

  it("deliver() refuses with the dormant reason when the flag is off", async () => {
    const result = await whatsappCloudAdapter.deliver(input);

    expect(result).toEqual({
      ok: false,
      reason:
        "WhatsApp Cloud API is not enabled (dormant — $0 default uses web-share)",
    });
  });

  it("flips enabled only when the flag is exactly 'true'", () => {
    vi.stubEnv("NEXT_PUBLIC_DISPATCH_WHATSAPP_ENABLED", "true");
    expect(whatsappCloudAdapter.isEnabled()).toBe(true);

    vi.stubEnv("NEXT_PUBLIC_DISPATCH_WHATSAPP_ENABLED", "1");
    expect(whatsappCloudAdapter.isEnabled()).toBe(false);

    vi.stubEnv("NEXT_PUBLIC_DISPATCH_WHATSAPP_ENABLED", "false");
    expect(whatsappCloudAdapter.isEnabled()).toBe(false);
  });

  it("when enabled but no real client is wired, returns the stub failure — NEVER bills", async () => {
    vi.stubEnv("NEXT_PUBLIC_DISPATCH_WHATSAPP_ENABLED", "true");

    const result = await whatsappCloudAdapter.deliver(input);

    expect(result).toEqual({
      ok: false,
      reason:
        "WhatsApp Cloud adapter is a flagged stub; wire a real client to enable",
    });
  });

  it("never makes a real network call (no fetch) on any path", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await whatsappCloudAdapter.deliver(input); // flag off
    vi.stubEnv("NEXT_PUBLIC_DISPATCH_WHATSAPP_ENABLED", "true");
    await whatsappCloudAdapter.deliver(input); // flag on, still stub

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
