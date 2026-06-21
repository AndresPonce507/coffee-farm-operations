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
