import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { chooseStrategy, isPrecachable } from "@/lib/offline/sw-strategy";

/**
 * The Service Worker's routing decisions are pure functions (the side-effecty
 * fetch/cache plumbing wraps them in `sw.js`). Testing the decision here in node
 * is the lowest layer that catches the real footgun the spec warns about:
 * caching the WRONG things (a stale app chunk → white screen after deploy) or
 * caching a WRITE (a POST must always hit the network — never served stale).
 */
describe("Service Worker strategy", () => {
  const url = (p: string) => new URL(`https://janson.example${p}`);

  it("a non-GET request always goes to the network (never cached)", () => {
    expect(chooseStrategy("POST", url("/anything"))).toBe("network-only");
    expect(chooseStrategy("PUT", url("/x"))).toBe("network-only");
  });

  it("static build assets are cache-first (immutable, content-hashed)", () => {
    expect(chooseStrategy("GET", url("/_next/static/chunks/main-abc123.js"))).toBe(
      "cache-first",
    );
    expect(chooseStrategy("GET", url("/favicon.svg"))).toBe("cache-first");
    expect(chooseStrategy("GET", url("/manifest.webmanifest"))).toBe(
      "cache-first",
    );
  });

  it("the document/navigation + data routes are stale-while-revalidate", () => {
    // an app navigation (HTML document) — serve cached shell fast, refresh behind.
    expect(chooseStrategy("GET", url("/weigh"))).toBe("stale-while-revalidate");
    expect(chooseStrategy("GET", url("/harvests"))).toBe(
      "stale-while-revalidate",
    );
  });

  it("the Supabase API + auth round-trips are network-first (fresh data wins)", () => {
    expect(
      chooseStrategy("GET", new URL("https://abc.supabase.co/rest/v1/lots")),
    ).toBe("network-first");
    expect(chooseStrategy("GET", url("/auth/callback"))).toBe("network-first");
  });

  it("only same-origin build assets are precached at install", () => {
    expect(isPrecachable("/")).toBe(true);
    expect(isPrecachable("/manifest.webmanifest")).toBe(true);
    expect(isPrecachable("/favicon.svg")).toBe(true);
    // never precache a cross-origin or an API path.
    expect(isPrecachable("https://abc.supabase.co/rest/v1/lots")).toBe(false);
    expect(isPrecachable("/rest/v1/anything")).toBe(false);
  });
});

/**
 * Parity guard — the SHIPPED Service Worker vs. the tested SSOT.
 *
 * Every test above pins `sw-strategy.ts`, but the browser runs `public/sw.js`,
 * which carries its OWN hand-copied `chooseStrategy`/`isStaticAsset`/`isApiOrAuth`
 * (a SW can't `import` a bundled module). Nothing else in THIS file asserts the
 * two agree — so a one-sided edit (e.g. adding `/functions/v1/` to `isApiOrAuth`
 * in only one copy) would leave every test above green while the deployed SW
 * silently caches the wrong thing (a stale edge-function GET, or — worst case —
 * a write). This guard reads the shipped `public/sw.js` as text, evaluates its
 * real strategy functions in a sandbox, and asserts BEHAVIORAL agreement with
 * the exported SSOT over a fixed url/method table that deliberately spans the
 * drift-prone edges: edge-function GETs, REST writes, and non-GET verbs. A
 * behavioral check (not a brittle byte-compare) lets the `.ts` copy keep its
 * type annotations + JSDoc while still failing loudly the moment either copy
 * diverges on any tabled case.
 */
describe("Service Worker strategy — public/sw.js ⇆ sw-strategy.ts parity", () => {
  const SW_SOURCE = readFileSync(
    join(process.cwd(), "public", "sw.js"),
    "utf8",
  );

  // Evaluate the shipped SW in a sandbox and read its inlined strategy router
  // back off the module-locals via a return shim. `self`/`caches`/`fetch` get
  // inert fakes (the install/activate listeners run but touch nothing); `URL`
  // comes from the node runtime so `new URL(...)` inside the SW resolves.
  const swChoose = (
    new Function(
      "self",
      "caches",
      "fetch",
      "URL",
      `${SW_SOURCE}\n;return chooseStrategy;`,
    )(
      { addEventListener() {} },
      { open: () => Promise.resolve({}), keys: () => Promise.resolve([]) },
      () => Promise.resolve({ ok: true }),
      URL,
    ) as typeof chooseStrategy
  );

  // Cases span the drift-prone edges, NOT just the happy path: an edge-function
  // GET (the exact scenario a one-sided `isApiOrAuth` edit would break), a REST
  // write, and non-GET verbs — alongside one of each strategy bucket.
  const cases: Array<[string, string]> = [
    ["GET", "https://janson.example/_next/static/chunks/main-abc123.js"],
    ["GET", "https://janson.example/favicon.svg"],
    ["GET", "https://janson.example/weigh"],
    ["GET", "https://janson.example/harvests"],
    ["GET", "https://abc.supabase.co/rest/v1/lots"],
    ["GET", "https://janson.example/auth/callback"],
    ["GET", "https://janson.example/functions/v1/foo"],
    ["POST", "https://janson.example/rest/v1/lots"],
    ["PUT", "https://janson.example/anything"],
    ["DELETE", "https://janson.example/rest/v1/lots/1"],
  ];

  it.each(cases)(
    "public/sw.js matches the SSOT for %s %s",
    (method, href) => {
      const u = new URL(href);
      expect(swChoose(method, u)).toBe(chooseStrategy(method, u));
    },
  );
});
