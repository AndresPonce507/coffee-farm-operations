import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * no-mock-reads — the machine enforcement of North-Star KPI 2 (0 mock-data reads on
 * production paths). Greps for any non-test `src/` module importing `@/lib/data/*`.
 *
 * The real assertion is written NOW (RED-ready) but the suite stays GREEN today via
 * `describe.skip`: the live offenders are the `CREWS` MOCK leak in
 * `sections/workers/{worker-form,crew-board}.tsx` and the seed-only
 * `lib/geo/seed-geometry.ts`. This guard is **un-skipped by US-02 (the Workers
 * mock-kill) when it swaps the last `@/lib/data/*` read for a live getter** — flip
 * `describe.skip` → `describe` in that PR.
 *
 * The grep INCLUDES `src/lib/data/` internal cross-imports? No — a data module
 * importing a sibling data module is fine (it IS the mock layer). The contract is:
 * no PRODUCTION RENDER PATH (components / app routes / non-data lib) reads mock data.
 * So we exclude the `src/lib/data/` directory itself and all test files.
 */

// Resolve to `src/` via the file path of THIS test (under jsdom `import.meta.url`
// is not a file: URL, so `new URL(..)` + fileURLToPath throws — climb from the
// real on-disk path instead, matching ripple-routes-exist.test.ts).
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", ".."); // → src/

/** Non-test, non-data-layer files that import from `@/lib/data/…`. */
function mockReadFiles(): string[] {
  let out = "";
  try {
    out = execFileSync(
      "grep",
      [
        "-rIl",
        "--include=*.ts",
        "--include=*.tsx",
        "--exclude-dir=__tests__",
        "--exclude=*.test.ts",
        "--exclude=*.test.tsx",
        "-E",
        "from ['\"]@/lib/data/",
        SRC,
      ],
      { encoding: "utf8" },
    ).trim();
  } catch (e) {
    // grep exits 1 when there are no matches — that's the GREEN end-state.
    const err = e as { status?: number; stdout?: string };
    if (err.status === 1) return [];
    throw e;
  }
  return out
    .split("\n")
    .filter(Boolean)
    // The mock layer itself (`src/lib/data/*`) is allowed to cross-import siblings.
    .filter((f) => !f.includes("/lib/data/"));
}

// SKIP today (the CREWS MOCK leak + seed-geometry still read @/lib/data). US-02
// un-skips this in the same PR that swaps the last mock read for a live getter.
describe.skip("no-mock-reads guard", () => {
  it("has zero @/lib/data reads on production render paths (KPI 2 = 0 mock)", () => {
    expect(mockReadFiles()).toEqual([]);
  });
});
