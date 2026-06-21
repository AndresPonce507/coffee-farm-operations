/**
 * P2-S5 — the $0 DEFAULT delivery adapter: web-share / copy-link.
 *
 * This is the genuinely-free path and the only one enabled out of the box:
 *   1. the device's native share sheet (`navigator.share`) — the manager taps
 *      "share" and picks the crew-lead WhatsApp group manually → via:'native-share';
 *   2. failing that, the clipboard (`navigator.clipboard.writeText`) — "copy link"
 *      → via:'clipboard';
 *   3. failing both, ok:false.
 *
 * It calls NO paid API and costs $0. Every browser global is guarded so the
 * adapter is SSR-safe (never throws when `navigator` is absent on the server) and
 * trivially testable under jsdom by stubbing `navigator.share` / `.clipboard`.
 */

import type {
  DispatchDeliveryAdapter,
  DispatchDeliveryInput,
  DispatchDeliveryResult,
} from "@/lib/integration/dispatch/port";

/** A share-sheet-capable navigator (feature-detected, never assumed). */
type ShareCapable = {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
};
/** A clipboard-capable navigator (feature-detected, never assumed). */
type ClipboardCapable = {
  clipboard?: { writeText?: (text: string) => Promise<void> };
};

/** The current navigator, or undefined on the server / where it is absent. */
function getNavigator(): (ShareCapable & ClipboardCapable) | undefined {
  if (typeof navigator === "undefined" || navigator === null) return undefined;
  return navigator as ShareCapable & ClipboardCapable;
}

/** The self-contained string copied to the clipboard (card text + optional link). */
function clipboardPayload(input: DispatchDeliveryInput): string {
  return input.url ? `${input.text}\n${input.url}` : input.text;
}

export const webShareAdapter: DispatchDeliveryAdapter = {
  channel: "web-share",

  // The $0 default is always available — there is nothing to bill or configure.
  isEnabled(): boolean {
    return true;
  },

  async deliver(
    input: DispatchDeliveryInput,
  ): Promise<DispatchDeliveryResult> {
    const nav = getNavigator();

    // 1) Native share sheet — preferred when present.
    if (nav && typeof nav.share === "function") {
      try {
        await nav.share({
          title: input.title,
          text: input.text,
          url: input.url,
        });
        return { ok: true, channel: "web-share", via: "native-share" };
      } catch (err) {
        // A dismissed/aborted share sheet rejects — that is a non-fatal cancel,
        // not a success. Surface it as ok:false without throwing.
        const reason =
          err instanceof Error ? err.message : "share sheet dismissed";
        return { ok: false, reason };
      }
    }

    // 2) Clipboard fallback ("copy link").
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === "function") {
      try {
        await nav.clipboard.writeText(clipboardPayload(input));
        return { ok: true, channel: "web-share", via: "clipboard" };
      } catch (err) {
        const reason =
          err instanceof Error ? err.message : "clipboard write failed";
        return { ok: false, reason };
      }
    }

    // 3) Neither capability (e.g. SSR, or a locked-down browser).
    return { ok: false, reason: "no share or clipboard available" };
  },
};
