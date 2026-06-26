import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */

// OpenFreeMap serves the basemap style, vector tiles, glyph PBFs and sprites all
// from this single origin (verified from the positron style document).
const MAP_ORIGIN = "https://tiles.openfreemap.org";

// Supabase REST/Auth origin: derived from the public env var when present (tight,
// project-specific in production) and falling back to the provider wildcard so the
// policy is still valid in test/build contexts where the env isn't injected.
function supabaseConnectSrc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (url) {
    try {
      return new URL(url).origin;
    } catch {
      // malformed env — fall through to the wildcard below
    }
  }
  return "https://*.supabase.co";
}

const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js App Router injects inline bootstrap / RSC-streaming scripts. Allow
  // inline scripts but NOT eval. (Nonce-based scripting is the next hardening step.)
  "script-src 'self' 'unsafe-inline'",
  // Tailwind and MapLibre GL attach inline styles at runtime.
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${MAP_ORIGIN}`,
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseConnectSrc()} ${MAP_ORIGIN}`,
  // MapLibre GL runs its renderer in a blob: web worker.
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

// Strict-Transport-Security is intentionally omitted: Vercel already serves a
// strong preload HSTS header for this domain.
const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "geolocation=(), camera=(), microphone=(), payment=(), usb=()",
  },
];

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
