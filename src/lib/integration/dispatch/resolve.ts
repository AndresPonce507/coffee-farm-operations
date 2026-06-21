/**
 * P2-S5 — channel → delivery-adapter resolver.
 *
 * The DEFAULT (and the only enabled-out-of-the-box) channel is `web-share` — the
 * genuinely-$0 native-share / copy-link path. `copy-link` shares the SAME
 * web-share adapter because the clipboard IS that adapter's fallback leg.
 * `whatsapp-cloud` resolves to the DORMANT, flagged paid drop-in. `sms` is not
 * built (it would be another flagged paid drop-in) and currently falls through
 * to the dormant adapter rather than silently picking a billable path.
 */

import type { DispatchChannel } from "@/lib/types";
import type { DispatchDeliveryAdapter } from "@/lib/integration/dispatch/port";
import { webShareAdapter } from "@/lib/integration/dispatch/adapters/web-share";
import { whatsappCloudAdapter } from "@/lib/integration/dispatch/adapters/whatsapp";

/** The $0 default channel — what the composer reaches for out of the box. */
export const defaultDispatchChannel: DispatchChannel = "web-share";

/** Resolve the adapter that serves a given channel. */
export function resolveAdapter(channel: DispatchChannel): DispatchDeliveryAdapter {
  switch (channel) {
    case "web-share":
    case "copy-link":
      // copy-link is the clipboard fallback baked into the web-share adapter.
      return webShareAdapter;
    case "whatsapp-cloud":
      return whatsappCloudAdapter;
    case "sms":
      // Not built — no $0 path exists. Resolve to the dormant adapter so an
      // unconfigured 'sms' choice fails closed instead of billing anything.
      return whatsappCloudAdapter;
    default: {
      // Exhaustiveness guard — a new DispatchChannel must be handled here.
      const _never: never = channel;
      return webShareAdapter;
    }
  }
}
