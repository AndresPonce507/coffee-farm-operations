// AD-8 static guard — the grant/RLS invariants EVERY future migration must hold.
//
// Background: this app's live posture is "authenticated reads + the single owner
// writes (full CRUD); anon reads/writes nothing". grant_hygiene locked
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

// Objects that are DELIBERATELY owner-only (no authenticated SELECT grant) and therefore
// exempt from the (b) "every created object must grant select to authenticated" check.
// These are NOT the "forgot to grant" trap the guard catches — they are intentionally
// gated behind a tenant-filtered read surface.
//
//  - mv_lot_cost / mv_lot_cost_by_rule: P4-S0 §6.1 — a materialized view carries NO RLS
//    and materializes as owner, so a raw authenticated SELECT grant is a cross-tenant
//    COGS read (the #1 financial leak). The raw matviews stay owner-only; authenticated
//    reads go through the tenant-filtered security_barrier views mv_lot_cost_secure /
//    mv_lot_cost_by_rule_secure (which ARE granted) and the SECURITY DEFINER cogs_* ports
//    (which read the matview as owner and self-filter by current_tenant_id()).
const INTENTIONALLY_OWNER_ONLY = new Set<string>([
  "mv_lot_cost",
  "mv_lot_cost_by_rule",
]);

// Caller-facing SECURITY DEFINER fns that are DELIBERATELY service_role-ONLY (never
// browser/authenticated-callable) and therefore exempt from the (c) "grant execute to
// authenticated" check. These are webhook/edge-function entry points: a browser must
// never reach them (a §1 money rail). They are NOT the "forgot to lock down" trap — (d)
// still enforces revoke-from-public, and they carry an explicit grant to service_role,
// which check (c) verifies for this set instead of the authenticated grant.
//
//  - mark_order_paid / issue_dgi_cufe (P3-S12): called only from the Stripe-webhook /
//    fiscal-stamp Edge Functions under the service_role key — settling an order or
//    stamping a CUFE from a browser session would be a payment-integrity hole.
const SERVICE_ROLE_ONLY = new Set<string>([
  "mark_order_paid",
  "issue_dgi_cufe",
  "stamp_pos_dgi_cufe",
]);

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

  // (a) No migration may GRANT write privileges to anon. The authenticated owner
  //     MAY hold write grants — the app is read-write (full CRUD for the owner);
  //     anon must never be able to write.
  describe("(a) no write grants to anon", () => {
    for (const m of migrations) {
      it(`${m.name} grants no insert/update/delete to anon`, () => {
        // Find `grant ... to <roles>;` statements (NOT `grant ... to ... via
        // default privileges`, and NOT `revoke`). Match the verb list before TO.
        const grantStmts = m.sql.match(/(?<![a-z])grant\s+[^;]*?\sto\s+[^;]*;/g) ?? [];
        for (const stmt of grantStmts) {
          // The privilege list is between `grant` and `on`/`to`.
          const privPart = stmt.slice(0, stmt.indexOf(" on ") >= 0 ? stmt.indexOf(" on ") : stmt.indexOf(" to "));
          const targetsAnon = /\bto\b[^;]*\banon\b/.test(stmt);
          const grantsWrite = /\b(insert|update|delete)\b/.test(privPart) || /\ball privileges\b/.test(privPart);
          expect(
            targetsAnon && grantsWrite,
            `WRITE grant to anon found:\n  ${stmt.trim()}`,
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
          if (INTENTIONALLY_OWNER_ONLY.has(obj)) continue; // see exemption note above
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

  // (c) Every caller-facing SECURITY DEFINER function must have an explicit
  //     `grant execute ... to authenticated`. Internal/seed helpers — by the
  //     leading-underscore convention (e.g. `_seed_activity_event`) — are
  //     owner/seed-only and must NOT be granted (finding #1): they run from
  //     triggers/seed.sql as the owner, never from the REST API; granting them
  //     would open a forge door for any signed-in user.
  describe("(c) caller-facing security definer functions grant execute to authenticated", () => {
    for (const m of migrations) {
      // crude fn-name capture: `create ... function <name>(...)` that is security definer
      const definerFns = [
        ...m.sql.matchAll(
          /create\s+(?:or\s+replace\s+)?function\s+([a-z0-9_."]+)\s*\([^)]*\)[^;]*?security\s+definer/g,
        ),
      ]
        .map((x) => x[1].replace(/"/g, "").split(".").pop()!)
        // leading-underscore = internal/seed helper; not a caller-facing RPC.
        .filter((fn) => !fn.startsWith("_"));

      it(`${m.name}: each caller-facing security definer fn grants execute to authenticated`, () => {
        for (const fn of definerFns) {
          // service_role-ONLY webhook/edge fns are explicitly locked to service_role,
          // never authenticated — verify THAT grant instead (still not a PUBLIC forge door).
          if (SERVICE_ROLE_ONLY.has(fn)) {
            const grantedSvc = new RegExp(
              `grant\\s+execute\\s+on\\s+function\\s+(?:public\\.)?"?${fn}"?\\b[^;]*\\bto\\b[^;]*\\bservice_role\\b`,
            ).test(m.sql);
            expect(
              grantedSvc,
              `${m.name} defines service_role-only SECURITY DEFINER fn "${fn}" without an ` +
                `explicit grant execute ... to service_role.`,
            ).toBe(true);
            continue;
          }
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

  // (d) finding #1 hardening: every SECURITY DEFINER function in a migration AFTER
  //     grant_hygiene must `revoke execute ... from public`, because Postgres grants
  //     PUBLIC EXECUTE on every new function by default — and these definer fns run
  //     as the table owner (bypassing RLS), so a leftover PUBLIC grant lets the
  //     unauthenticated `anon` key call them. Fail-closed per AD-8.
  describe("(d) post-hygiene security definer functions revoke execute from public", () => {
    const afterHygiene = migrations.filter((m) => m.name > GRANT_HYGIENE);
    for (const m of afterHygiene) {
      const definerFns = [
        ...m.sql.matchAll(
          /create\s+(?:or\s+replace\s+)?function\s+([a-z0-9_."]+)\s*\([^)]*\)[^;]*?security\s+definer/g,
        ),
      ].map((x) => x[1].replace(/"/g, "").split(".").pop()!);

      it(`${m.name}: each security definer fn revokes execute from public`, () => {
        for (const fn of definerFns) {
          const revoked = new RegExp(
            `revoke\\s+execute\\s+on\\s+function\\s+(?:public\\.)?"?${fn}"?\\b[^;]*\\bfrom\\b[^;]*\\bpublic\\b`,
          ).test(m.sql);
          expect(
            revoked,
            `${m.name} defines SECURITY DEFINER fn "${fn}" but never revokes EXECUTE ` +
              `from public — anon could call it (PUBLIC EXECUTE is the Postgres default).`,
          ).toBe(true);
        }
        expect(definerFns).toBeDefined();
      });
    }
  });
});
