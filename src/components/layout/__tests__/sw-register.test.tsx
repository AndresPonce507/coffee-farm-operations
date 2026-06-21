import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServiceWorkerRegistrar } from "@/components/layout/sw-register";

/**
 * The registrar is a render-null client island that registers the SW on mount —
 * but ONLY when the offline flag + platform support it (graceful degradation:
 * with no serviceWorker / flag off, it must be a silent no-op so online-only is
 * untouched).
 */
describe("ServiceWorkerRegistrar", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    // @ts-expect-error — cleaning up the stubbed navigator field.
    delete navigator.serviceWorker;
  });

  it("renders nothing (it is invisible chrome)", () => {
    const { container } = render(<ServiceWorkerRegistrar />);
    expect(container).toBeEmptyDOMElement();
  });

  it("registers /sw.js when serviceWorker is available and the flag is on", async () => {
    const register = vi.fn(async () => ({}));
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register, addEventListener: vi.fn() },
    });
    render(<ServiceWorkerRegistrar />);
    await vi.waitFor(() => expect(register).toHaveBeenCalledWith("/sw.js", expect.anything()));
  });

  it("is a no-op when the platform has no serviceWorker (online-only still works)", () => {
    // no navigator.serviceWorker defined → must not throw.
    expect(() => render(<ServiceWorkerRegistrar />)).not.toThrow();
  });
});
