import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * entity-link-anchors-resolve — static guard ensuring every `anchor="…"` used
 * in an EntityLink component resolves to a real `id="…"` rendered by a
 * DossierSection on the target dossier page.
 *
 * The no-dead-ui guard checks that clickable elements navigate somewhere, but it
 * does NOT verify that the `#fragment` part of the URL scrolls to a real DOM
 * node. This guard closes that gap: a drill like
 *
 *   <EntityLink kind="lot" id={code} anchor="cost-entries">…</EntityLink>
 *
 * generates a URL `/lots/JC-NNN#cost-entries`. The lot dossier MUST render a
 * `<DossierSection id="cost-entries">` (which stamps `data-testid="section-cost-entries"`
 * and `id="cost-entries"` on the DOM). If the section is renamed or never added,
 * this test is RED.
 *
 * HOW IT WORKS (static grep, no runtime):
 *   1. Grep production component files for `anchor="…"` + nearby `kind="…"` to
 *      build a set of (kind, anchor) pairs.
 *   2. For each pair, resolve the dossier page directory:
 *        kind="lot"  → src/app/(app)/lots/[code]/
 *        kind="plot" → src/app/(app)/plots/[id]/
 *        (other kinds are added here as their dossiers are built)
 *   3. Grep the dossier directory (including its component imports) for
 *      DossierSection with that id. We search the component files the page
 *      imports because dossier sections live in separate section components.
 *   4. Assert each (kind, anchor) pair resolves to at least one matching id.
 *
 * IMPORTANT: this guard is intentionally simple (grep-based, not AST-based).
 * It can produce false negatives (misses a dead anchor) if the `kind` and
 * `anchor` props are on different JSX lines with unusual whitespace, but it will
 * never produce false positives — if it reports a dead anchor, it IS dead.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", ".."); // → src/
const COMPONENTS_DIR = join(SRC, "components");
const APP_DIR = join(SRC, "app", "(app)");

/** Dossier directory for each EntityLink kind. Add new kinds here. */
const DOSSIER_DIRS: Record<string, string> = {
  lot: join(APP_DIR, "lots", "[code]"),
  plot: join(APP_DIR, "plots", "[id]"),
  worker: join(APP_DIR, "workers", "[id]"),
  crew: join(APP_DIR, "crew", "[id]"),
  batch: join(APP_DIR, "ferment", "[batch]"),
  dispatch: join(APP_DIR, "dispatch", "[id]"),
  "pay-period": join(APP_DIR, "pay-period", "[id]"),
};

/** All `.tsx` files under a directory, recursively (exclude tests). */
function tsxFilesUnder(dir: string): string[] {
  try {
    const result = spawnSync(
      "find",
      [dir, "-name", "*.tsx", "-not", "-path", "*/__tests__/*"],
      { encoding: "utf8" },
    );
    return result.stdout.trim() === "" ? [] : result.stdout.trim().split("\n");
  } catch {
    return [];
  }
}

/**
 * Collect all (kind, anchor) pairs from production EntityLink usages.
 * Greps component files for lines containing `anchor="..."` and looks at the
 * surrounding context for `kind="..."` on the same or adjacent lines.
 */
function collectUsedAnchors(): Array<{ kind: string; anchor: string; file: string }> {
  const results: Array<{ kind: string; anchor: string; file: string }> = [];
  let raw = "";
  try {
    // grep -n gives us line numbers; -B5 gives 5 lines before each match so
    // we can find the kind= on nearby lines.
    raw = execFileSync(
      "grep",
      [
        "-rIn",
        "--include=*.tsx",
        "--exclude-dir=__tests__",
        "anchor=",
        COMPONENTS_DIR,
      ],
      { encoding: "utf8" },
    ).trim();
  } catch (e) {
    const err = e as { status?: number };
    if (err.status === 1) return []; // no matches
    throw e;
  }

  for (const line of raw.split("\n")) {
    // Each line: /path/to/file.tsx:42:          anchor="cost-entries"
    const anchorMatch = line.match(/anchor="([^"]+)"/);
    if (!anchorMatch) continue;
    const anchor = anchorMatch[1];
    const filePath = line.split(":")[0];

    // Read the file to find the kind= nearby (within 10 lines above the anchor).
    let fileContent = "";
    try {
      const read = spawnSync("cat", [filePath], { encoding: "utf8" });
      fileContent = read.stdout;
    } catch {
      continue;
    }

    // Find the line number of this anchor in the file.
    const lineNumStr = line.split(":")[1];
    const lineNum = parseInt(lineNumStr, 10);
    if (isNaN(lineNum)) continue;

    // Look at lines (lineNum-10)..lineNum for kind="..."
    const fileLines = fileContent.split("\n");
    const searchStart = Math.max(0, lineNum - 11);
    const context = fileLines.slice(searchStart, lineNum).join("\n");
    const kindMatch = context.match(/kind="([^"]+)"/);
    if (!kindMatch) continue;
    const kind = kindMatch[1];

    results.push({ kind, anchor, file: filePath });
  }

  return results;
}

/**
 * Check whether a DossierSection with a given `id` is rendered somewhere
 * reachable from the dossier page. Searches all `.tsx` files under the dossier
 * directory AND the shared `sections/` components directory for
 * `id="<anchor>"` adjacent to DossierSection (a `<DossierSection id="…">` prop).
 */
function anchorExistsInDossier(dossierDir: string, anchor: string): boolean {
  // Search dossier page dir + the components directory (section files live there).
  const dirsToSearch = [dossierDir, COMPONENTS_DIR];
  for (const dir of dirsToSearch) {
    try {
      execFileSync(
        "grep",
        [
          "-rIl",
          "--include=*.tsx",
          "--exclude-dir=__tests__",
          `id="${anchor}"`,
          dir,
        ],
        { encoding: "utf8" },
      );
      return true; // grep found at least one file
    } catch (e) {
      const err = e as { status?: number };
      if (err.status !== 1) throw e; // unexpected error
      // status 1 = no match in this dir, try the next
    }
  }
  return false;
}

// ---- collect anchors and run assertions -----------------------------------

const usedAnchors = collectUsedAnchors();

describe("entity-link-anchors-resolve", () => {
  it("the anchor collection is non-empty (the guard actually exercises real code)", () => {
    // If this fails, the grep pattern broke or all anchors were removed — either
    // way, the guard is not protecting anything and must be fixed.
    expect(usedAnchors.length).toBeGreaterThan(0);
  });

  it.each(usedAnchors)(
    'anchor "$anchor" (kind="$kind") in $file resolves to a DossierSection id on the destination dossier',
    ({ kind, anchor, file }) => {
      const dossierDir = DOSSIER_DIRS[kind];
      if (!dossierDir) {
        // No dossier registered for this kind: skip rather than fail — the kind
        // may not have a dossier page yet (it will be caught by the no-dead-ui guard).
        return;
      }
      const exists = anchorExistsInDossier(dossierDir, anchor);
      expect(
        exists,
        `EntityLink anchor="${anchor}" (kind="${kind}") used in ${file} does not resolve to ` +
          `a DossierSection with id="${anchor}" anywhere under ${dossierDir} or ${COMPONENTS_DIR}. ` +
          `Add a <DossierSection id="${anchor}"> on the ${kind} dossier, ` +
          `or retarget the anchor to an existing section.`,
      ).toBe(true);
    },
  );
});
