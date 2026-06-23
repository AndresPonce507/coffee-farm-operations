import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Round-B a11y guard — the cherry/danger tone must clear WCAG-AA (4.5:1) on its
 * cherry-100 tints. Two failure modes are pinned here:
 *   1. A resting `text-cherry/80` is 3.12:1 on cherry-100 — never AA. Muting the
 *      brand red with opacity is the recurring trap (qc-hold banner, status table,
 *      task flag). Hover/focus states are exempt (transient, not resting copy).
 *   2. The base `--color-cherry` token itself must be dark enough that full-opacity
 *      `text-cherry on bg-cherry-100` passes AA (it was #b5482e = 4.12:1).
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx|ts)$/.test(name) && !p.includes("__tests__")) out.push(p);
  }
  return out;
}

function lin(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function ratio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe("cherry/danger tone clears WCAG-AA on cherry-100", () => {
  it("no render-path component mutes the danger red with a resting text-cherry/80 (3.12:1)", () => {
    const offenders: string[] = [];
    for (const file of walk("src/components")) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/(\S*)text-cherry\/80/g)) {
        const prefix = m[1] ?? "";
        // hover:/focus:/group-hover: states are transient, not resting copy — exempt.
        if (!/(hover|focus|group-hover|active):$/.test(prefix)) {
          offenders.push(`${file}: ${m[0]}`);
        }
      }
    }
    expect(offenders, `resting text-cherry/80 is 3.12:1 — use full text-cherry`).toEqual([]);
  });

  it("the --color-cherry token clears 4.5:1 on --color-cherry-100", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const cherry = css.match(/--color-cherry:\s*(#[0-9a-fA-F]{6})/)?.[1];
    const cherry100 = css.match(/--color-cherry-100:\s*(#[0-9a-fA-F]{6})/)?.[1];
    expect(cherry, "cherry token present").toBeTruthy();
    expect(cherry100, "cherry-100 token present").toBeTruthy();
    expect(ratio(cherry!, cherry100!)).toBeGreaterThanOrEqual(4.5);
  });
});
