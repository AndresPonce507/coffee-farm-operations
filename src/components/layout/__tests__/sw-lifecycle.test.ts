import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { chooseStrategy as mirrorChooseStrategy } from "@/lib/offline/sw-strategy";

/**
 * Behavioral coverage for the hand-rolled Service Worker (`public/sw.js`).
 *
 * A SW can't be `import`ed as a module (it speaks to `self`/`caches`/`fetch`
 * globals, not exports), so we read it as text and evaluate it inside a sandbox
 * built with `new Function`, injecting fakes for those globals. That lets us
 * drive the REAL install/activate/message/fetch handlers — the side-effecting
 * code the pure `sw-strategy.ts` mirror does NOT exercise — and assert behavior:
 *
 *   - install precaches the shell;
 *   - activate purges every cache NOT prefixed by the current CACHE_VERSION;
 *   - a CLEAR_DATA_CACHE message wipes the runtime cache (sign-out hygiene);
 *   - authenticated Supabase REST/auth GETs are NEVER written to the shared,
 *     persistent runtime cache (cross-user data-leak guard on shared devices);
 *   - the SW's own strategy router agrees with the `sw-strategy.ts` SSOT mirror
 *     (kills silent hand-duplicated drift the files themselves warn about).
 */

const SW_PATH = join(process.cwd(), "public", "sw.js");
const SW_SOURCE = readFileSync(SW_PATH, "utf8");

// ── a minimal in-memory CacheStorage / Cache that records writes ──
class FakeCache {
  store = new Map<string, unknown>();
  async match(req: { url: string } | string) {
    const key = typeof req === "string" ? req : req.url;
    return this.store.get(key);
  }
  async put(req: { url: string } | string, res: unknown) {
    const key = typeof req === "string" ? req : req.url;
    this.store.set(key, res);
  }
  async addAll(urls: string[]) {
    for (const url of urls) this.store.set(url, { precached: url });
  }
}

class FakeCacheStorage {
  caches = new Map<string, FakeCache>();
  async open(name: string) {
    let c = this.caches.get(name);
    if (!c) {
      c = new FakeCache();
      this.caches.set(name, c);
    }
    return c;
  }
  async keys() {
    return [...this.caches.keys()];
  }
  async delete(name: string) {
    return this.caches.delete(name);
  }
  async match(req: { url: string } | string) {
    const key = typeof req === "string" ? req : req.url;
    for (const c of this.caches.values()) {
      if (c.store.has(key)) return c.store.get(key);
    }
    return undefined;
  }
  // test helper: seed a named cache.
  _seed(name: string) {
    const c = new FakeCache();
    this.caches.set(name, c);
    return c;
  }
}

type Handlers = Record<string, (event: unknown) => void>;

interface Sandbox {
  handlers: Handlers;
  cacheStorage: FakeCacheStorage;
  skipWaiting: ReturnType<typeof vi.fn>;
  clientsClaim: ReturnType<typeof vi.fn>;
  fetchMock: ReturnType<typeof vi.fn>;
}

/** Evaluate public/sw.js against injected fakes and return the wired sandbox. */
function loadSW(fetchImpl?: (req: { url: string; method: string }) => unknown): Sandbox {
  const handlers: Handlers = {};
  const cacheStorage = new FakeCacheStorage();
  const skipWaiting = vi.fn(() => Promise.resolve());
  const clientsClaim = vi.fn(() => Promise.resolve());
  const fetchMock = vi.fn(
    fetchImpl ?? (() => ({ ok: true, clone: () => ({ ok: true }) })),
  );

  const self = {
    addEventListener: (type: string, cb: (event: unknown) => void) => {
      handlers[type] = cb;
    },
    skipWaiting,
    clients: { claim: clientsClaim },
  };

  // `new Function` gives sw.js its `self`/`caches`/`fetch` globals; `URL` and
  // `Response` come straight from the node runtime.
  const factory = new Function(
    "self",
    "caches",
    "fetch",
    "URL",
    SW_SOURCE,
  );
  factory(self, cacheStorage, fetchMock, URL);

  return { handlers, cacheStorage, skipWaiting, clientsClaim, fetchMock };
}

/** Build a fake ExtendableEvent that captures the waitUntil promise. */
function extendableEvent(extra: Record<string, unknown> = {}) {
  let waited: Promise<unknown> = Promise.resolve();
  return {
    event: {
      waitUntil: (p: Promise<unknown>) => {
        waited = p;
      },
      ...extra,
    },
    settle: () => waited,
  };
}

describe("Service Worker lifecycle (public/sw.js)", () => {
  let sw: Sandbox;

  beforeEach(() => {
    sw = loadSW();
  });

  it("install precaches the app shell", async () => {
    const { event, settle } = extendableEvent();
    sw.handlers.install(event);
    await settle();

    // exactly one cache opened, named *-precache, holding the shell URLs.
    const precacheName = (await sw.cacheStorage.keys()).find((k) =>
      k.endsWith("-precache"),
    );
    expect(precacheName).toBeDefined();
    const cache = await sw.cacheStorage.open(precacheName as string);
    expect(cache.store.has("/")).toBe(true);
    expect(cache.store.has("/manifest.webmanifest")).toBe(true);
    expect(sw.skipWaiting).toHaveBeenCalled();
  });

  it("activate purges every cache NOT prefixed by the current version", async () => {
    // seed one stale-version cache + one current-version cache.
    sw.cacheStorage._seed("janson-OLD-runtime");
    sw.cacheStorage._seed("janson-v1-runtime");

    const { event, settle } = extendableEvent();
    sw.handlers.activate(event);
    await settle();

    const remaining = await sw.cacheStorage.keys();
    expect(remaining).toContain("janson-v1-runtime"); // current survives
    expect(remaining).not.toContain("janson-OLD-runtime"); // stale purged
    expect(sw.clientsClaim).toHaveBeenCalled();
  });

  it("a SKIP_WAITING message activates the waiting SW", () => {
    sw.handlers.message({ data: "SKIP_WAITING" });
    expect(sw.skipWaiting).toHaveBeenCalled();
  });

  it("a CLEAR_DATA_CACHE message wipes the runtime cache (sign-out hygiene)", async () => {
    // seed a runtime cache holding a navigation document.
    const runtime = sw.cacheStorage._seed("janson-v1-runtime");
    await runtime.put("/weigh", { ok: true });
    expect(await sw.cacheStorage.keys()).toContain("janson-v1-runtime");

    const { event, settle } = extendableEvent({ data: "CLEAR_DATA_CACHE" });
    sw.handlers.message(event);
    await settle();

    expect(await sw.cacheStorage.keys()).not.toContain("janson-v1-runtime");
  });

  it("an authenticated Supabase REST GET is NEVER written to the shared cache", async () => {
    const apiUrl = "https://abc.supabase.co/rest/v1/lots";
    sw = loadSW((req) => {
      if (req.url === apiUrl) {
        return { ok: true, clone: () => ({ ok: true, body: "USER_A_PAYROLL" }) };
      }
      return { ok: true, clone: () => ({ ok: true }) };
    });

    // drive the network-first path directly via the fetch handler.
    let responded: Promise<unknown> | undefined;
    sw.handlers.fetch({
      request: { url: apiUrl, method: "GET" },
      respondWith: (p: Promise<unknown>) => {
        responded = p;
      },
    });
    await responded;

    // the runtime cache must NOT hold the authenticated REST body.
    const runtime = sw.cacheStorage.caches.get("janson-v1-runtime");
    const cached = runtime ? await runtime.match(apiUrl) : undefined;
    expect(cached).toBeUndefined();
  });

  it("the SW router agrees with the sw-strategy.ts SSOT mirror", async () => {
    // extract the SW's own chooseStrategy by evaluating the source and reading it
    // off a sandbox that exposes module-locals — re-eval with a return shim.
    const probe = new Function(
      "self",
      "caches",
      "fetch",
      "URL",
      `${SW_SOURCE}\n;return { chooseStrategy, isStaticAsset, isApiOrAuth };`,
    );
    const swExports = probe(
      { addEventListener() {} },
      new FakeCacheStorage(),
      vi.fn(),
      URL,
    ) as { chooseStrategy: (m: string, u: URL) => string };

    const cases: Array<[string, string]> = [
      ["POST", "https://janson.example/anything"],
      ["GET", "https://janson.example/_next/static/chunks/main-abc123.js"],
      ["GET", "https://janson.example/favicon.svg"],
      ["GET", "https://janson.example/manifest.webmanifest"],
      ["GET", "https://janson.example/weigh"],
      ["GET", "https://janson.example/harvests"],
      ["GET", "https://abc.supabase.co/rest/v1/lots"],
      ["GET", "https://janson.example/auth/callback"],
    ];

    for (const [method, href] of cases) {
      const u = new URL(href);
      expect(swExports.chooseStrategy(method, u)).toBe(
        mirrorChooseStrategy(method, u),
      );
    }
  });
});
