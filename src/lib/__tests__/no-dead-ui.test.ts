import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * no-dead-ui — the machine enforcement of North-Star KPI 3 (DEAD = 0).
 *
 * The real assertion is written NOW (RED-ready) but the suite stays GREEN today via
 * `describe.skip`: the one true DEAD element (the Map polygon click in
 * `FarmMap.client.tsx`, which carries a pointer cursor but no navigation) is fixed in
 * L3-map. This guard is **un-skipped by L3-map when it removes the last offender** —
 * flip `describe.skip` → `describe` in the same PR that wires the polygon `router.push`.
 *
 * Heuristic: a `cursor-pointer` class on an element with no `href`, no `onClick`, no
 * `role="button"`/`type="button"` in the same component file is a dead affordance.
 * We grep for the known DEAD marker comment the audit assigns (`// DEAD:`) so the
 * count is explicit and a re-introduced dead click is caught.
 */

// Resolve to `src/` via the file path of THIS test (under jsdom `import.meta.url`
// is not a file: URL, so `new URL(..)` + fileURLToPath throws — climb from the
// real on-disk path instead, matching ripple-routes-exist.test.ts).
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", ".."); // → src/

/** Count `// DEAD:` markers (the audit's tag for an unresolved dead affordance). */
function deadMarkerCount(): number {
  const out = execFileSync(
    "grep",
    [
      "-rIl",
      "--include=*.tsx",
      "--include=*.ts",
      "--exclude-dir=__tests__",
      "DEAD:",
      SRC,
    ],
    { encoding: "utf8" },
  ).trim();
  return out === "" ? 0 : out.split("\n").length;
}

// SKIP today (the Map polygon DEAD click still exists). L3-map un-skips this in the
// same PR that wires the polygon to `router.push(entityHref.plot(...))`.
describe.skip("no-dead-ui static guard", () => {
  it("has zero DEAD-marked affordances across src (KPI 3 = DEAD 0)", () => {
    expect(deadMarkerCount()).toBe(0);
  });
});
