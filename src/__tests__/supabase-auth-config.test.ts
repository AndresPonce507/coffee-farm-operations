import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Regression net for the audit's #1 finding. The whole app is "single owner" with
// flat `using(true)` RLS, so open signup is the difference between safe and a full
// PII/payroll breach. The hosted project has signups OFF; this asserts the repo's
// declared config can never silently re-open them (a `supabase config push` away).
// (Security audit, 2026-06-21.)
const configToml = readFileSync(
  join(process.cwd(), "supabase/config.toml"),
  "utf8",
);

// Active (non-comment) config lines only.
const activeLines = configToml
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !l.startsWith("#"));

describe("supabase/config.toml auth hardening", () => {
  it("never declares open signup (no active `enable_signup = true`)", () => {
    const openSignup = activeLines.filter((l) =>
      /^enable_signup\s*=\s*true\b/.test(l),
    );
    expect(openSignup).toEqual([]);
  });

  it("does not enable anonymous sign-ins", () => {
    const anon = activeLines.filter((l) =>
      /^enable_anonymous_sign_ins\s*=\s*true\b/.test(l),
    );
    expect(anon).toEqual([]);
  });
});
