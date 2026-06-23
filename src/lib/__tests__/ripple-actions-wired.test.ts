import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guard: ripple-actions-wired -- the RIPPLE SSOT is exercised by live action code,
 * and NO action file hand-rolls revalidatePath() directly.
 *
 * ## Why this guard exists
 *
 * RIPPLE is the canonical per-event downstream route map (src/lib/revalidate.ts).
 * Server Actions call `reactiveRefresh(kind)` to bust exactly the right set of
 * Next.js RSC caches after a write. The anti-pattern -- hand-rolling
 * `revalidatePath()` inside an action -- means:
 *
 *   1. The action's route set can silently DRIFT from RIPPLE (e.g., qc/actions.ts
 *      was omitting /dispatch -- a held lot showed stale on the Dispatch tab).
 *   2. Adding a new downstream consumer to RIPPLE doesn't retroactively fix the
 *      hand-rolled callsite.
 *
 * ## Scope
 *
 * Prior to this version, the guard only scanned src/lib/actions/ (5 files). The
 * real write paths for weigh-in, qc-hold, cost-entry, spray, disbursement,
 * ferment, drying, dispatch, inventory-update, crew-event, plan-event, and
 * eudr-declaration live in the 13 colocated Server Actions under
 * src/app/(app)/<route>/actions.ts -- which the old guard could not see.
 *
 * ## What this guard asserts
 *
 *   A. Every action file listed in KIND_TO_ACTION_FILES exists on disk.
 *   B. Each listed action file calls `reactiveRefresh("<kind>")` and does NOT
 *      contain a hand-rolled `revalidatePath(` call.
 *   C. No action file outside KIND_TO_ACTION_FILES contains a hand-rolled
 *      `revalidatePath(` call (the "stray hand-roll" class of drift).
 *   D. Every EventKind in RIPPLE has a declared caller in KIND_TO_ACTION_FILES,
 *      unless it is listed in RIPPLE_KEYS_WITHOUT_WRITE_PATH (future write paths
 *      whose action does not yet exist).
 *   E. Every key in KIND_TO_ACTION_FILES exists in RIPPLE (no stale entry).
 *
 * When an action file's EventKind is removed, the call signature drifts, or a new
 * write path hand-rolls revalidatePath instead of calling reactiveRefresh, this
 * guard turns RED instead of allowing the SSOT to silently become dead code.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");

/** src/lib/actions/ -- the legacy action home (fully migrated). */
const LIB_ACTIONS_DIR = join(HERE, "..", "actions");

/** src/app/(app)/ -- the colocated action home (13 action files live here). */
const APP_ACTIONS_DIR = join(ROOT, "src", "app", "(app)");

/**
 * The sole file that IS ALLOWED to import and call revalidatePath() directly.
 * All other action files must go through reactiveRefresh().
 */
const REVALIDATE_SSOT = join(HERE, "..", "revalidate.ts");

/**
 * EventKinds in RIPPLE that do NOT yet have a corresponding write-path action.
 * These are intentional gaps -- the routes are declared in RIPPLE as downstream
 * consumers of a future write, but the Server Action that fires the write has not
 * been built yet. Adding to this list requires a comment explaining the gap.
 * Removing an entry here (once the action ships) will be enforced by check D.
 */
const RIPPLE_KEYS_WITHOUT_WRITE_PATH: ReadonlySet<string> = new Set([
  // "spray" -- the PHI spray Server Action is not yet built; the scouting surface
  // reads v_plot_phi_status but the write path (log a spray event) is deferred.
  "spray",
]);

/**
 * Canonical mapping: EventKind → the action file(s) that own that write path.
 *
 * Paths starting with "lib/" are relative to src/lib/actions/.
 * Paths starting with "app/" are relative to src/app/(app)/.
 *
 * Keep this in sync with RIPPLE in src/lib/revalidate.ts.
 */
const KIND_TO_ACTION_FILES: Record<string, string[]> = {
  // ── src/lib/actions/ ───────────────────────────────────────────────────────
  plot: ["lib/plots.ts"],
  "cherry-intake": ["lib/harvests.ts", "app/harvests/actions.ts"],
  worker: ["lib/workers.ts"],
  task: ["lib/tasks.ts"],
  "processing-batch": ["lib/processing.ts", "app/processing/actions.ts"],
  // ── src/app/(app)/ ────────────────────────────────────────────────────────
  "weigh-in": ["app/weigh/actions.ts"],
  "cost-entry": ["app/costing/actions.ts"],
  "qc-hold": ["app/qc/actions.ts"],
  disbursement: ["app/payroll/actions.ts"],
  ferment: ["app/ferment/actions.ts"],
  drying: ["app/drying/actions.ts"],
  dispatch: ["app/dispatch/actions.ts"],
  "inventory-update": ["app/inventory/actions.ts"],
  "crew-event": ["app/crew/actions.ts"],
  "plan-event": ["app/plan/actions.ts"],
  "eudr-declaration": ["app/eudr/actions.ts"],
};

/** Resolve a KIND_TO_ACTION_FILES path to an absolute path on disk. */
function resolve(relPath: string): string {
  if (relPath.startsWith("lib/")) {
    return join(LIB_ACTIONS_DIR, relPath.slice("lib/".length));
  }
  if (relPath.startsWith("app/")) {
    return join(APP_ACTIONS_DIR, relPath.slice("app/".length));
  }
  // Legacy support -- plain filename → lib/actions/
  return join(LIB_ACTIONS_DIR, relPath);
}

const allDeclaredFiles = [...new Set(Object.values(KIND_TO_ACTION_FILES).flat())];

// ─── Collect ALL action files on disk (lib/actions/*.ts + app/(app)/*/actions.ts)
function collectAllActionFiles(): string[] {
  const files: string[] = [];

  // src/lib/actions/*.ts  (excluding __tests__)
  try {
    const libEntries = (globSync ?? require("glob").sync)(
      join(LIB_ACTIONS_DIR, "*.ts"),
    ) as string[];
    files.push(...libEntries.filter((f: string) => !f.includes("__tests__")));
  } catch {
    // globSync not available in this Node version -- fall back to manual
    const { readdirSync } = require("node:fs");
    for (const name of readdirSync(LIB_ACTIONS_DIR)) {
      if (name.endsWith(".ts") && !name.includes("__tests__")) {
        files.push(join(LIB_ACTIONS_DIR, name));
      }
    }
  }

  // src/app/(app)/*/actions.ts
  try {
    const { readdirSync, statSync } = require("node:fs");
    for (const segment of readdirSync(APP_ACTIONS_DIR)) {
      const candidate = join(APP_ACTIONS_DIR, segment, "actions.ts");
      if (existsSync(candidate)) {
        files.push(candidate);
      }
    }
  } catch {
    // directory traversal failure -- the anchor test below will catch it
  }

  return files;
}

// ─── A. Anchor: declared files exist ─────────────────────────────────────────
describe("ripple-actions-wired -- RIPPLE is live code, not dead abstraction", () => {
  it("every action file listed in KIND_TO_ACTION_FILES exists on disk", () => {
    for (const rel of allDeclaredFiles) {
      const full = resolve(rel);
      expect(existsSync(full), `expected action file at ${full}`).toBe(true);
    }
  });

  // ─── B. Contract: per-kind files call reactiveRefresh and ban revalidatePath ─
  it.each(Object.entries(KIND_TO_ACTION_FILES))(
    'action file(s) for kind "%s" call reactiveRefresh and ban hand-rolled revalidatePath',
    (kind, files) => {
      for (const rel of files) {
        const full = resolve(rel);
        const src = readFileSync(full, "utf-8");

        expect(
          src,
          `${rel} must call reactiveRefresh("${kind}") -- ` +
            "hand-rolling revalidatePath is the dead-SSOT smell flagged in the review",
        ).toContain(`reactiveRefresh("${kind}")`);

        expect(
          src,
          `${rel} must NOT import or call revalidatePath() directly -- ` +
            "all route busting must go through reactiveRefresh() so RIPPLE stays the SSOT",
        ).not.toContain("revalidatePath(");
      }
    },
  );

  // ─── C. Stray-hand-roll scan: ALL action files must be revalidatePath-free ──
  it("no action file outside revalidate.ts contains a hand-rolled revalidatePath() call", () => {
    const allFiles = collectAllActionFiles();
    expect(allFiles.length, "expected to find at least 10 action files on disk").toBeGreaterThanOrEqual(10);

    const violations: string[] = [];
    for (const abs of allFiles) {
      if (abs === REVALIDATE_SSOT) continue; // the SSOT itself calls revalidatePath()
      const src = readFileSync(abs, "utf-8");
      if (src.includes("revalidatePath(")) {
        violations.push(abs);
      }
    }

    expect(
      violations,
      "These action files hand-roll revalidatePath() and bypass RIPPLE:\n" +
        violations.join("\n") +
        "\n\nFix: replace the hand-rolled calls with reactiveRefresh(kind) and ensure " +
        "the kind is declared in RIPPLE (src/lib/revalidate.ts) and in KIND_TO_ACTION_FILES " +
        "in this guard.",
    ).toEqual([]);
  });

  // ─── D. RIPPLE→caller exhaustiveness: every RIPPLE key must have a caller ───
  it("every EventKind in RIPPLE has a declared caller in KIND_TO_ACTION_FILES (or is in the no-write-path exemption list)", async () => {
    const { RIPPLE } = await import("@/lib/revalidate");
    const rippleKeys = Object.keys(RIPPLE) as string[];
    const wiredKeys = new Set(Object.keys(KIND_TO_ACTION_FILES));

    const unregistered: string[] = [];
    for (const key of rippleKeys) {
      if (!wiredKeys.has(key) && !RIPPLE_KEYS_WITHOUT_WRITE_PATH.has(key)) {
        unregistered.push(key);
      }
    }

    expect(
      unregistered,
      `These RIPPLE EventKinds have no declared caller and are not in the exemption list:\n` +
        unregistered.join(", ") +
        "\n\nFix: add the EventKind to KIND_TO_ACTION_FILES (with its action file path) " +
        "once the Server Action is built, OR add it to RIPPLE_KEYS_WITHOUT_WRITE_PATH " +
        "(with a comment) if the write path is intentionally deferred.",
    ).toEqual([]);
  });

  // ─── E. caller→RIPPLE exhaustiveness: every declared kind exists in RIPPLE ──
  it("every EventKind in KIND_TO_ACTION_FILES exists in RIPPLE", async () => {
    const { RIPPLE } = await import("@/lib/revalidate");
    const rippleKeys = Object.keys(RIPPLE) as string[];
    const wiredKeys = Object.keys(KIND_TO_ACTION_FILES);

    for (const key of wiredKeys) {
      expect(
        rippleKeys,
        `KIND_TO_ACTION_FILES declares "${key}" but RIPPLE has no such EventKind -- ` +
          "add the key to RIPPLE or remove the stale entry here",
      ).toContain(key);
    }
  });
});
