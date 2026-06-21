import { afterEach, describe, expect, it, vi } from "vitest";

import { purgeOfflineCaches } from "../purge";

describe("purgeOfflineCaches (sign-out teardown)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deletes every Cache Storage entry and unregisters every service worker", async () => {
    const deleteCache = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("caches", {
      keys: vi
        .fn()
        .mockResolvedValue(["janson-v1-runtime", "janson-v1-precache"]),
      delete: deleteCache,
    });
    const unregister = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistrations: vi
          .fn()
          .mockResolvedValue([{ unregister }, { unregister }]),
      },
    });

    await purgeOfflineCaches();

    // The runtime cache is the one holding rendered authenticated HTML — it MUST go.
    expect(deleteCache).toHaveBeenCalledWith("janson-v1-runtime");
    expect(deleteCache).toHaveBeenCalledWith("janson-v1-precache");
    expect(deleteCache).toHaveBeenCalledTimes(2);
    expect(unregister).toHaveBeenCalledTimes(2);
  });

  it("no-ops safely when Cache Storage / Service Worker APIs are unavailable", async () => {
    vi.stubGlobal("caches", undefined);
    vi.stubGlobal("navigator", {});
    await expect(purgeOfflineCaches()).resolves.toBeUndefined();
  });

  it("never rejects even if a cache deletion throws", async () => {
    vi.stubGlobal("caches", {
      keys: vi.fn().mockResolvedValue(["janson-v1-runtime"]),
      delete: vi.fn().mockRejectedValue(new Error("quota")),
    });
    vi.stubGlobal("navigator", {});
    await expect(purgeOfflineCaches()).resolves.toBeUndefined();
  });
});
