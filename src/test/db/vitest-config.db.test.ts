import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import picomatch from "picomatch";
import { describe, expect, it } from "vitest";

// Guardrail-integrity test for the `db` project's file selection.
//
// The db suite is the project's SOLE quality gate (CLAUDE.md: gate = build
// green + test green). Vitest selects files off the FILESYSTEM (not git), so
// any throwaway `_*.db.test.ts` scratch / red-team repro left in the working
// tree would silently join the gate — going red (blocking) or, worse, going
// green while pinning a known-broken behaviour as the expected value. The db
// project must therefore EXCLUDE underscore-prefixed scratch repros from the
// glob while still keeping every real db test.
//
// We import the project's REAL vitest config and drive its resolved
// include/exclude patterns through picomatch — the same matcher vitest uses —
// asserting the SELECTION BEHAVIOUR rather than a brittle exclude literal, so
// the guard survives a refactor of the pattern string. This file lives in the
// `db` (node) project because the config module dereferences `import.meta.url`
// as a file URL at load time, which only holds under the node environment.

type ProjectGlobs = { include?: string[]; exclude?: string[] };

async function loadDbProjectGlobs(): Promise<ProjectGlobs> {
  const url = pathToFileURL(resolve(process.cwd(), "vitest.config.ts")).href;
  const mod = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
  // Unwrap nested `default` (tsx/ESM interop) until we reach the config object
  // (identified by carrying a `test` key).
  let cfg: unknown = (mod.default as unknown) ?? mod;
  while (
    cfg &&
    typeof cfg === "object" &&
    "default" in (cfg as Record<string, unknown>) &&
    !("test" in (cfg as Record<string, unknown>))
  ) {
    cfg = (cfg as { default: unknown }).default;
  }
  const projects =
    ((cfg as { test?: { projects?: Array<{ test?: { name?: string } & ProjectGlobs }> } })
      .test?.projects) ?? [];
  const db = projects.find((p) => p.test?.name === "db")?.test;
  if (!db) throw new Error("vitest config has no `db` project");
  return { include: db.include, exclude: db.exclude };
}

/**
 * Reproduces vitest's selection: a file runs iff it matches some `include`
 * pattern AND matches NO `exclude` pattern.
 */
function isSelected(path: string, globs: ProjectGlobs): boolean {
  const include = globs.include ?? [];
  const exclude = globs.exclude ?? [];
  const included = include.some((g) => picomatch(g)(path));
  const excluded = exclude.some((g) => picomatch(g)(path));
  return included && !excluded;
}

describe("vitest.config.ts — db project glob", () => {
  it("does NOT select underscore-prefixed scratch / red-team db repros", async () => {
    const globs = await loadDbProjectGlobs();
    // A forgotten local repro must never silently join the sole quality gate.
    expect(isSelected("src/test/db/_repro.db.test.ts", globs)).toBe(false);
    expect(isSelected("src/test/db/_redteam_s1.db.test.ts", globs)).toBe(false);
    expect(
      isSelected("src/lib/agronomy/__tests__/_scratch.db.test.ts", globs),
    ).toBe(false);
  });

  it("still selects real (non-underscore) db tests", async () => {
    const globs = await loadDbProjectGlobs();
    // Guard against an over-broad exclude that would silently drop real tests.
    expect(isSelected("src/test/db/p2s1_people.db.test.ts", globs)).toBe(true);
    expect(
      isSelected("src/lib/agronomy/__tests__/gdd-view-parity.db.test.ts", globs),
    ).toBe(true);
  });
});
