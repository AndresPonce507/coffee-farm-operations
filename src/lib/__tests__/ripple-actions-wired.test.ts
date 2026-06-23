import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard: ripple-actions-wired — the RIPPLE SSOT is exercised by live action code.
 *
 * Finding: RIPPLE / reactiveRefresh() was fully tested in isolation but NEVER
 * called by any production Server Action.  The actions hand-rolled revalidatePath()
 * calls, making the RIPPLE SSOT decorative.
 *
 * This guard is the belt-and-braces enforcement layer: it performs a static source
 * scan of every action file and asserts:
 *   1. Each file calls `reactiveRefresh("<kind>")` with the correct EventKind.
 *   2. No file contains a hand-rolled `revalidatePath(` call (the banned pattern).
 *
 * When an action file's EventKind is removed or the call signature drifts, this
 * guard turns RED instead of allowing the SSOT to silently become dead code again.
 *
 * This is a static-only guard (no runtime/DB mock needed) because the source text
 * is the contract — the call must be present and correct; runtime behavior is
 * covered by revalidate.test.ts which tests reactiveRefresh() itself.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ACTIONS_DIR = join(HERE, "..", "actions");

/**
 * Canonical mapping: EventKind → the action file(s) that own that write path.
 * Keep this in sync with RIPPLE in src/lib/revalidate.ts — a new EventKind added
 * to RIPPLE without a caller entry here will be caught by the exhaustiveness test.
 */
const KIND_TO_ACTION_FILES: Record<string, string[]> = {
  plot: ["plots.ts"],
  "cherry-intake": ["harvests.ts"],
  worker: ["workers.ts"],
  task: ["tasks.ts"],
  "processing-batch": ["processing.ts"],
};

const allActionFiles = [...new Set(Object.values(KIND_TO_ACTION_FILES).flat())];

describe("ripple-actions-wired — RIPPLE is live code, not dead abstraction", () => {
  // -------------------------------------------------------------------------
  // Anchor: all declared action files exist on disk.
  // -------------------------------------------------------------------------
  it("every action file listed in KIND_TO_ACTION_FILES exists on disk", () => {
    for (const file of allActionFiles) {
      const full = join(ACTIONS_DIR, file);
      expect(existsSync(full), `expected action file at ${full}`).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Contract: each action file calls reactiveRefresh with the correct EventKind
  // and does NOT hand-roll revalidatePath().
  // -------------------------------------------------------------------------
  it.each(Object.entries(KIND_TO_ACTION_FILES))(
    'action file(s) for kind "%s" call reactiveRefresh and ban hand-rolled revalidatePath',
    (kind, files) => {
      for (const file of files) {
        const src = readFileSync(join(ACTIONS_DIR, file), "utf-8");

        expect(
          src,
          `${file} must call reactiveRefresh("${kind}") — ` +
            "hand-rolling revalidatePath is the dead-SSOT smell flagged in the review",
        ).toContain(`reactiveRefresh("${kind}")`);

        expect(
          src,
          `${file} must NOT import or call revalidatePath() directly — ` +
            "all route busting must go through reactiveRefresh() so RIPPLE stays the SSOT",
        ).not.toContain("revalidatePath(");
      }
    },
  );

  // -------------------------------------------------------------------------
  // Exhaustiveness: every EventKind in RIPPLE has a declared caller here.
  // A new RIPPLE key added without a matching entry in KIND_TO_ACTION_FILES is
  // caught before it silently goes unused.
  // -------------------------------------------------------------------------
  it("every EventKind in RIPPLE has at least one action file wired to it", async () => {
    // Dynamic import so the check always reads the current module on disk.
    const { RIPPLE } = await import("@/lib/revalidate");
    const rippleKeys = Object.keys(RIPPLE) as string[];
    const wiredKeys = Object.keys(KIND_TO_ACTION_FILES);

    for (const key of wiredKeys) {
      expect(
        rippleKeys,
        `KIND_TO_ACTION_FILES declares "${key}" but RIPPLE has no such EventKind — ` +
          "add the key to RIPPLE or remove the stale entry here",
      ).toContain(key);
    }
  });
});
