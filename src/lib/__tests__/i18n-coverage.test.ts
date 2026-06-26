import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * i18n coverage guard — enforces that NO user-visible literal ships outside next-intl.
 *
 * The whole UI is bilingual (EN/ES) via `t()`; this guard fails the suite if a new
 * hardcoded user-visible string sneaks in (a JSX text node, or an aria-label / title /
 * placeholder / alt / label literal). It is deliberately conservative — it skips code
 * (TS generics like `Promise<…>`, single identifiers, anything with JS punctuation) and
 * an ALLOWLIST of brand / place / unit / acronym tokens that stay verbatim by design —
 * so a failure means a real untranslated string, not noise.
 *
 * Detection is regex-based (not AST), so it errs toward false-NEGATIVES (a missed
 * straggler) over false-positives; the value is catching the common regressions.
 */
const SRC = join(dirname(), "..", "..");
function dirname() {
  return join(process.cwd(), "src", "lib", "__tests__");
}

// Tokens that stay verbatim: brands, places, units, acronyms, domain terms, samples.
const ALLOW = new Set(
  [
    "Janson", "Coffee", "Volcán", "Chiriquí", "Panamá", "EUDR", "QC", "GPS", "PHI",
    "REI", "NDVI", "NDRE", "SAR", "ATP", "COGS", "SCA", "CVA", "Brix", "kg", "ha",
    "pH", "km", "ID", "PDF", "CSV", "URL", "OK", "broca", "roya", "Yappy", "Nequi",
    "ACH", "CSS", "QR", "lata", "latas", "msnm", "masl", "Bluetooth", "Onyx", "Bx",
    "Geisha", "Caturra", "Catuai", "Typica", "Bourbon", "es", "ng", "ngäbere", "JC",
    "L",
  ].map((s) => s.toLowerCase()),
);

const WORD = /[A-Za-zÁÉÍÓÚÑáéíóúñÄËÏÖÜäëïöü]{2,}/g;
// JS/TS punctuation that means "this capture is code, not UI prose".
const CODE = /[;=(){}<>[\]`$|]|=>|["']/;

function isCandidate(text: string): boolean {
  const t = text.trim();
  if (t.length < 3) return false;
  const words = t.match(WORD);
  if (!words) return false; // no letters → punctuation/number only
  if (CODE.test(t)) return false; // contains code punctuation
  if (/^[A-Za-z][\w.]*$/.test(t)) return false; // a single bare identifier (generic/var)
  if (words.every((w) => ALLOW.has(w.toLowerCase()))) return false; // all-allowlisted phrase
  return true;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__") continue;
      out.push(...walk(p));
    } else if (name.endsWith(".tsx")) {
      out.push(p);
    }
  }
  return out;
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function findOffenders(): string[] {
  const offenders: string[] = [];
  for (const root of ["src/app", "src/components"]) {
    for (const file of walk(join(process.cwd(), root))) {
      const src = stripComments(readFileSync(file, "utf8"));
      const rel = file.replace(join(process.cwd(), "src") + "/", "");
      // JSX text nodes: >text<
      for (const m of src.matchAll(/>\s*([^<>{}\n][^<>{}]*?)\s*</g)) {
        if (isCandidate(m[1])) offenders.push(`${rel}: text "${m[1].trim().slice(0, 50)}"`);
      }
      // i18n-sensitive literal string props
      for (const m of src.matchAll(
        /\b(title|placeholder|aria-label|alt|label)\s*=\s*"([^"{]*[A-Za-zÁ][^"{]*)"/g,
      )) {
        const v = m[2].trim();
        const words = v.match(WORD);
        if (v.length >= 3 && words && !words.every((w) => ALLOW.has(w.toLowerCase())) &&
            !/^[A-Za-z][\w.]*$/.test(v)) {
          offenders.push(`${rel}: [${m[1]}] "${v.slice(0, 46)}"`);
        }
      }
    }
  }
  return offenders;
}

describe("i18n coverage — no untranslated user-visible literals", () => {
  it("every user-visible string routes through next-intl t() (0 hardcoded literals)", () => {
    const offenders = findOffenders();
    expect(
      offenders,
      `Untranslated user-visible literal(s) found — route them through t():\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
