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

  /**
   * The whole point of the `updatefound` listener is to fire SKIP_WAITING so a
   * new build's shell takes over without a manual reload — the in-app half of
   * the deploy cache-bust. These tests drive the real update lifecycle (the
   * `register` mocks above resolve a too-thin `{}` that never exercises it).
   */
  type Listeners = Record<string, Array<() => void>>;
  function fakeUpdateLifecycle(opts: { controller: unknown }) {
    const listeners: Listeners = {};
    const add = (ev: string, cb: () => void) => {
      (listeners[ev] ??= []).push(cb);
    };
    const installing = {
      state: "installing",
      postMessage: vi.fn(),
      addEventListener: add,
    };
    const reg = { installing, addEventListener: add };
    const register = vi.fn(async () => reg);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register, controller: opts.controller, addEventListener: vi.fn() },
    });
    const fire = (ev: string) => listeners[ev]?.forEach((f) => f());
    return { register, installing, fire };
  }

  it("posts SKIP_WAITING when an updated SW reaches 'installed' with a controller present", async () => {
    const { register, installing, fire } = fakeUpdateLifecycle({ controller: {} });
    render(<ServiceWorkerRegistrar />);
    await vi.waitFor(() => expect(register).toHaveBeenCalled());
    fire("updatefound"); // wires the statechange listener onto `installing`
    installing.state = "installed";
    fire("statechange"); // drives the branch
    expect(installing.postMessage).toHaveBeenCalledWith("SKIP_WAITING");
  });

  it("does NOT post SKIP_WAITING on a first install (no prior controller)", async () => {
    // First-ever install: navigator.serviceWorker.controller is null, so the
    // new SW is already in control — there is no old shell to skip waiting past.
    const { register, installing, fire } = fakeUpdateLifecycle({ controller: null });
    render(<ServiceWorkerRegistrar />);
    await vi.waitFor(() => expect(register).toHaveBeenCalled());
    fire("updatefound");
    installing.state = "installed";
    fire("statechange");
    expect(installing.postMessage).not.toHaveBeenCalled();
  });

  it("does NOT post SKIP_WAITING while the SW is still in a non-'installed' state", async () => {
    // Pins the exact state string: a statechange to e.g. 'installing'/'activating'
    // must not trigger the skip — only the 'installed' transition does.
    const { register, installing, fire } = fakeUpdateLifecycle({ controller: {} });
    render(<ServiceWorkerRegistrar />);
    await vi.waitFor(() => expect(register).toHaveBeenCalled());
    fire("updatefound");
    installing.state = "activating"; // any state that is NOT "installed"
    fire("statechange");
    expect(installing.postMessage).not.toHaveBeenCalled();
  });

  it("never registers when the offline flag is off (instant kill-switch)", () => {
    vi.stubEnv("NEXT_PUBLIC_OFFLINE", "off");
    const register = vi.fn(async () => ({}));
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register, addEventListener: vi.fn() },
    });
    render(<ServiceWorkerRegistrar />);
    expect(register).not.toHaveBeenCalled();
  });
});
