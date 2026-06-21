import { describe, expect, it } from "vitest";

import {
  defaultDispatchChannel,
  resolveAdapter,
} from "@/lib/integration/dispatch/resolve";
import { webShareAdapter } from "@/lib/integration/dispatch/adapters/web-share";
import { whatsappCloudAdapter } from "@/lib/integration/dispatch/adapters/whatsapp";

/**
 * P2-S5 — the channel → adapter resolver.
 *
 * The DEFAULT (and the only enabled-out-of-the-box) channel is web-share. The
 * clipboard "copy-link" channel shares the web-share adapter (it IS the clipboard
 * fallback). 'whatsapp-cloud' resolves to the dormant paid drop-in.
 */
describe("resolveAdapter", () => {
  it("defaults to the web-share channel", () => {
    expect(defaultDispatchChannel).toBe("web-share");
  });

  it("the default channel resolves to the $0 web-share adapter (always enabled)", () => {
    const adapter = resolveAdapter(defaultDispatchChannel);
    expect(adapter).toBe(webShareAdapter);
    expect(adapter.isEnabled()).toBe(true);
  });

  it("maps 'web-share' to the web-share adapter", () => {
    expect(resolveAdapter("web-share")).toBe(webShareAdapter);
  });

  it("maps 'copy-link' to the web-share adapter (shared clipboard fallback)", () => {
    expect(resolveAdapter("copy-link")).toBe(webShareAdapter);
  });

  it("maps 'whatsapp-cloud' to the dormant paid adapter", () => {
    const adapter = resolveAdapter("whatsapp-cloud");
    expect(adapter).toBe(whatsappCloudAdapter);
    // Dormant out of the box — the resolver does NOT enable it.
    expect(adapter.isEnabled()).toBe(false);
  });
});
