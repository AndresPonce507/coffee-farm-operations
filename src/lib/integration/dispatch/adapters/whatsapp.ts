/**
 * P2-S5 — the DORMANT, FLAGGED paid drop-in: WhatsApp Business Cloud API.
 *
 * ████ PAID API — DORMANT BY DEFAULT, NEVER BILLED UNLESS EXPLICITLY ENABLED ████
 *
 * The WhatsApp Cloud API is NOT $0 — user-initiated templates can bill, and the
 * service-conversation free tier is limited (see PHASE2-DESIGN §4). So this
 * adapter is built behind the delivery seam but stays DORMANT: the $0 default
 * (web-share) is the only required path. It is wired up nowhere and ships off.
 *
 * It is gated behind a single build flag, mirroring the offline substrate's
 * `offlineFlagEnabled()` style (a STATIC `process.env.NEXT_PUBLIC_*` read — never
 * optional-chained, per the repo's known Vite-inlining gotcha). The flag flips
 * dormant → "stub": even when enabled, with no real client wired this adapter
 * makes NO network call and returns a clearly-marked stub failure, so the $0
 * envelope is never breached by accident in this practice project.
 */

import type {
  DispatchDeliveryAdapter,
  DispatchDeliveryInput,
  DispatchDeliveryResult,
} from "@/lib/integration/dispatch/port";

/**
 * Build-time opt-in. The WhatsApp Cloud drop-in is OFF unless this is exactly the
 * string `"true"`. Read statically so the bundler inlines it (mirrors
 * `offlineFlagEnabled()` — `process.env.NEXT_PUBLIC_*`, no `?.`).
 */
export function whatsappFlagEnabled(): boolean {
  // Static access — bundler inlines `process.env.NEXT_PUBLIC_DISPATCH_WHATSAPP_ENABLED`.
  return process.env.NEXT_PUBLIC_DISPATCH_WHATSAPP_ENABLED === "true";
}

export const whatsappCloudAdapter: DispatchDeliveryAdapter = {
  channel: "whatsapp-cloud",

  // Dormant unless the family explicitly opts into the paid tier via the flag.
  isEnabled(): boolean {
    return whatsappFlagEnabled();
  },

  async deliver(
    _input: DispatchDeliveryInput,
  ): Promise<DispatchDeliveryResult> {
    // Off by default — point callers back at the $0 web-share default.
    if (!whatsappFlagEnabled()) {
      return {
        ok: false,
        reason:
          "WhatsApp Cloud API is not enabled (dormant — $0 default uses web-share)",
      };
    }

    // Flag on, but NO real client is wired in this practice project. We
    // deliberately make NO network call (never bill) and return a stub failure.
    // Wiring a real Cloud-API client here is the explicit, paid opt-in step.
    return {
      ok: false,
      reason:
        "WhatsApp Cloud adapter is a flagged stub; wire a real client to enable",
    };
  },
};
