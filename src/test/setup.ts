// Vitest global setup — wires @testing-library/jest-dom matchers
// (toBeInTheDocument, toHaveClass, etc.) into every test file.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Globals are off, so RTL's automatic cleanup isn't registered. Unmount the
// rendered tree after every test so multi-render UI tests don't leak DOM
// ("Found multiple elements") into one another.
afterEach(() => {
  cleanup();
});

// ── next-intl: resolve REAL English messages in tests ───────────────────────
// Components use useTranslations()/getTranslations(); outside a request there is no
// intl context, so we mock both to look up the actual messages/en/<ns>.json. Tests
// keep asserting the English copy (which now lives in the dictionaries), and no test
// needs to wrap renders in a provider.
const EN_DIR = join(process.cwd(), "messages", "en");
const EN: Record<string, unknown> = {};
for (const file of readdirSync(EN_DIR)) {
  if (!file.endsWith(".json")) continue;
  EN[file.replace(".json", "")] = JSON.parse(readFileSync(join(EN_DIR, file), "utf8"));
}

type Dict = Record<string, unknown>;
function lookup(dict: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>(
    (o, k) => (o && typeof o === "object" ? (o as Dict)[k] : undefined),
    dict,
  );
}
function makeT(ns?: string) {
  const root = ns ? EN[ns] : EN;
  const resolve = (key: string, vars?: Record<string, unknown>) => {
    let val = lookup(root, key);
    if (typeof val !== "string") return key; // missing → surface the key
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        val = (val as string).replaceAll(`{${k}}`, String(v));
      }
    }
    return val as string;
  };
  const t = resolve as ((key: string, vars?: Record<string, unknown>) => string) & {
    rich: (key: string, vars?: Record<string, unknown>) => string;
    markup: (key: string, vars?: Record<string, unknown>) => string;
    raw: (key: string) => unknown;
    has: (key: string) => boolean;
  };
  t.rich = resolve;
  t.markup = resolve;
  t.raw = (key: string) => lookup(root, key);
  t.has = (key: string) => typeof lookup(root, key) === "string";
  return t;
}

vi.mock("next-intl", async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return {
    ...actual,
    useTranslations: (ns?: string) => makeT(ns),
    useLocale: () => "en",
  };
});
vi.mock("next-intl/server", async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return {
    ...actual,
    getTranslations: async (arg?: string | { namespace?: string }) =>
      makeT(typeof arg === "string" ? arg : arg?.namespace),
    getLocale: async () => "en",
    getMessages: async () => EN,
  };
});
