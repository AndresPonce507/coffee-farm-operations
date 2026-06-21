/**
 * P2-S5 — Morning crew dispatch · DELIVERY port (ports-and-adapters seam).
 *
 * This layer DELIVERS an already-rendered, prepared card string — it does NOT
 * format the card (that lives upstream, in the bilingual card renderer). The
 * channel is swappable behind this one interface so the $0 default (web-share /
 * copy-link) and the dormant paid drop-in (WhatsApp Cloud API) are
 * interchangeable without the caller knowing which is wired.
 *
 * Design notes:
 *   - The DEFAULT and only enabled-out-of-the-box adapter is `web-share`
 *     (genuinely $0 — native share sheet, clipboard fallback). See `resolve.ts`.
 *   - The WhatsApp Cloud adapter is a flagged, DORMANT drop-in (can bill on the
 *     paid tier) and is NOT wired up. See `adapters/whatsapp.ts`.
 */

import type { DispatchChannel } from "@/lib/types";

/**
 * The prepared payload to deliver. The `text` is the already-rendered bilingual
 * card body; `url` is an optional deep-link to the dispatch card. Nothing here
 * is formatted by the adapter — it is delivered verbatim.
 */
export interface DispatchDeliveryInput {
  runId: number;
  title: string;
  text: string;
  url?: string;
}

/** The mechanism a successful $0 delivery actually used. */
export type DispatchDeliveryVia = "native-share" | "clipboard" | "noop";

/** The outcome of a delivery attempt. */
export type DispatchDeliveryResult =
  | { ok: true; channel: DispatchChannel; via: DispatchDeliveryVia }
  | { ok: false; reason: string };

/**
 * The swappable delivery seam. Every channel (web-share, copy-link, the dormant
 * whatsapp-cloud, future sms) implements this one interface.
 */
export interface DispatchDeliveryAdapter {
  /** The channel this adapter serves. */
  readonly channel: DispatchChannel;
  /** Whether this adapter is allowed to run (the web-share default is always
   *  true; the paid WhatsApp drop-in is gated behind a build flag). */
  isEnabled(): boolean;
  /** Deliver a prepared card. Never throws — failures come back as ok:false. */
  deliver(input: DispatchDeliveryInput): Promise<DispatchDeliveryResult>;
}
