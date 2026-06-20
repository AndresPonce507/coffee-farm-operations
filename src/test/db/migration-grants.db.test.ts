// AD-8 static guard — the grant/RLS invariants EVERY future migration must hold.
//
// Background: this app's live posture is "authenticated-only SELECT; anon reads
// nothing; nobody has table write grants". grant_hygiene locked
// `alter default privileges` so a NEW table gets NO grant by default — which means
// a future `create view`/`create table` that forgets its `grant select` will
// silently return ZERO rows to every caller (the classic "view returns nothing
// because nobody granted select" trap). This guard catches that at test time, on
// the raw SQL, before it ever ships — no DB round-trip needed.
//
// It must PASS on the current 3 migrations (no SECURITY DEFINER fns yet; SELECT is
// granted via a blanket `grant select on all tables ... to authenticated` in init).

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_DIR } from "./pgliteHarness";

interface Migration {
  name: string;
  /** SQL with line comments (`-- …`) stripped, lowercased, whitespace-collapsed. */
  sql: string;
  raw: string;
}

const GRANT_HYGIENE = "20260620150000_grant_hygiene";

function stripComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      // strip `-- comment` but not inside a string literal (migrations don't put
      // `--` inside literals; cheap heuristic is safe here).
      const idx = line.indexOf("--");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
}

function loadMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => {
      const raw = readFileSync(join(MIGRATIONS_DIR, name), "utf8");
      const sql = stripComments(raw).toLowerCase().replace(/\s+/g, " ");
      return { name, sql, raw };
    });
}

const migrations = loadMigrations();

describe("AD-8 migration grant/RLS static guard", () => {
  it("has migrations to check (sanity)", () => {
    expect(migrations.length).toBeGreaterThanOrEqual(3);
  });

  // (a) No migration may GRANT write privileges to anon or authenticated.
  describe("(a) no write grants to anon/authenticated", () => {
    for (const m of migrations) {
      it(`${m.name} grants no insert/update/delete to anon/authenticated`, () => {
        // Find `grant ... to <roles>;` statements (NOT `grant ... to ... via
        // default privileges`, and NOT `revoke`). Match the verb list before TO.
        const grantStmts = m.sql.match(/(?<![a-z])grant\s+[^;]*?\sto\s+[^;]*;/g) ?? [];
        for (const stmt of grantStmts) {
          // The privilege list is between `grant` and `on`/`to`.
          const privPart = stmt.slice(0, stmt.indexOf(" on ") >= 0 ? stmt.indexOf(" on ") : stmt.indexOf(" to "));
          const targetsAnonOrAuth = /\bto\b[^;]*\b(anon|authenticated)\b/.test(stmt);
          const grantsWrite = /\b(insert|update|delete)\b/.test(privPart) || /\ball privileges\b/.test(privPart);
          expect(
            targetsAnonOrAuth && grantsWrite,
            `WRITE grant to anon/authenticated found:\n  ${stmt.trim()}`,
          ).toBe(false);
        }
      });
    }
  });

  // (b) Every create table/view in a migration AFTER grant_hygiene must have a
  //     matching `grant select ... to authenticated` (blanket or per-object),
  //     because default privileges are locked => new objects get no grant.
  describe("(b) post-hygiene objects are granted SELECT to authenticated", () => {
    const afterHygiene = migrations.filter((m) => m.name > GRANT_HYGIENE);

    for (const m of afterHygiene) {
      // names of objects created in this migration
      const created = [
        ...m.sql.matchAll(/create\s+(?:or\s+replace\s+)?(?:table|view|materialized\s+view)\s+(?:if\s+not\s+exists\s+)?([a-z0-9_."]+)/g),
      ].map((x) => x[1].replace(/"/g, "").split(".").pop()!);

      it(`${m.name}: each created table/view grants select to authenticated`, () => {
        const blanketGrant =
          /grant\s+[^;]*\bselect\b[^;]*\bon\s+all\s+tables\s+in\s+schema\s+public\s+to\s+[^;]*\bauthenticated\b/.test(
            m.sql,
          );
        for (const obj of created) {
          const perObjectGrant = new RegExp(
            `grant\\s+[^;]*\\bselect\\b[^;]*\\bon\\s+(?:table\\s+)?(?:public\\.)?"?${obj}"?\\b[^;]*\\bto\\b[^;]*\\bauthenticated\\b`,
          ).test(m.sql);
          expect(
            blanketGrant || perObjectGrant,
            `${m.name} creates "${obj}" but never grants SELECT on it to authenticated ` +
              `(default privileges are locked since grant_hygiene → it would return zero rows).`,
          ).toBe(true);
        }
      });
    }

    it("runs even when no post-hygiene migrations exist yet (current state)", () => {
      // Documents that (b) is currently vacuous — there are no migrations after
      // grant_hygiene. The per-migration tests above appear once one is added.
      expect(afterHygiene.length).toBeGreaterThanOrEqual(0);
    });
  });

  // (c) Every SECURITY DEFINER function must have an explicit
  //     `grant execute ... to authenticated` (no definer fns exist yet).
  describe("(c) security definer functions grant execute to authenticated", () => {
    for (const m of migrations) {
      // crude fn-name capture: `create ... function <name>(...)` that is security definer
      const definerFns = [
        ...m.sql.matchAll(
          /create\s+(?:or\s+replace\s+)?function\s+([a-z0-9_."]+)\s*\([^)]*\)[^;]*?security\s+definer/g,
        ),
      ].map((x) => x[1].replace(/"/g, "").split(".").pop()!);

      it(`${m.name}: each security definer fn grants execute to authenticated`, () => {
        for (const fn of definerFns) {
          const granted = new RegExp(
            `grant\\s+execute\\s+on\\s+function\\s+(?:public\\.)?"?${fn}"?\\b[^;]*\\bto\\b[^;]*\\bauthenticated\\b`,
          ).test(m.sql);
          expect(
            granted,
            `${m.name} defines SECURITY DEFINER fn "${fn}" without an explicit ` +
              `grant execute ... to authenticated.`,
          ).toBe(true);
        }
        // when there are no definer fns this asserts nothing (passes), which is
        // the current state.
        expect(definerFns).toBeDefined();
      });
    }
  });
});
