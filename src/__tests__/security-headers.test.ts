import { describe, expect, it } from "vitest";

// next.config.mjs is the single place HTTP security headers are defined for every
// route. This is the regression net for that control: it fails if the headers()
// function or any required directive is removed or weakened. (Security audit,
// 2026-06-21 — fixes the "no CSP / no security headers" finding.)
import nextConfig from "../../next.config.mjs";

async function securityHeaderMap(): Promise<Record<string, string>> {
  expect(typeof nextConfig.headers).toBe("function");
  const groups = await nextConfig.headers!();
  const all = groups.find((g) => g.source === "/(.*)");
  expect(all, "a catch-all /(.*) header group must exist").toBeTruthy();
  return Object.fromEntries(
    all!.headers.map((h) => [h.key.toLowerCase(), h.value]),
  );
}

describe("HTTP security headers (next.config)", () => {
  it("sets clickjacking + MIME + referrer + permissions headers on every route", async () => {
    const h = await securityHeaderMap();
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"]).toMatch(/geolocation=\(\)/);
    expect(h["permissions-policy"]).toMatch(/camera=\(\)/);
    expect(h["permissions-policy"]).toMatch(/microphone=\(\)/);
  });

  it("sets a CSP that locks down framing, objects, and base-uri", async () => {
    const h = await securityHeaderMap();
    const csp = h["content-security-policy"];
    expect(csp, "CSP header must be present").toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
  });

  it("CSP allows exactly the origins the app needs (Supabase + OpenFreeMap + map workers)", async () => {
    const h = await securityHeaderMap();
    const csp = h["content-security-policy"];
    // Supabase REST/Auth must remain reachable or the whole app breaks.
    expect(csp).toMatch(/connect-src[^;]*supabase\.co/);
    // OpenFreeMap tiles/glyphs/sprite are fetched (connect) and drawn (img).
    expect(csp).toMatch(/connect-src[^;]*tiles\.openfreemap\.org/);
    expect(csp).toMatch(/img-src[^;]*tiles\.openfreemap\.org/);
    // MapLibre GL spins its renderer up in a blob: web worker.
    expect(csp).toMatch(/worker-src[^;]*blob:/);
  });

  it("does NOT weaken script execution with unsafe-eval", async () => {
    const h = await securityHeaderMap();
    expect(h["content-security-policy"]).not.toContain("unsafe-eval");
  });
});
