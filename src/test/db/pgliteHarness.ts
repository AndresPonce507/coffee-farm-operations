// PGlite migration-replay harness — the SQL/RLS test substrate for the DB project.
//
// Why this exists: there's NO Docker on this machine, so the real Supabase stack
// (Postgres + GoTrue + PostgREST) can't run in tests. PGlite is in-process WASM
// Postgres — close enough to replay the real migrations and prove RLS + grant
// behavior locally, at $0 and with no external services.
//
// What it models (AD-9):
//   PGlite has no Supabase roles, no GoTrue, no PostgREST. So before replaying the
//   migrations we `create role anon` / `create role authenticated` (the two roles
//   the migrations GRANT/REVOKE against — they must exist or the grants error). The
//   connection itself runs as the `postgres` superuser (table owner), which BYPASSES
//   RLS. To observe RLS + grants the way the live REST API does, a test must drop
//   into a role with `asAnon` / `asAuthenticated`, which `set role` + stamp
//   `request.jwt.claims` (the GUC `auth.uid()` / `auth.role()` read on Supabase).
//
// Live posture this reproduces (see supabase/migrations/*):
//   - anon:          SELECT grant REVOKED  -> queries fail "permission denied" (42501)
//   - authenticated: SELECT grant + "authenticated read" RLS policy -> reads rows
//   - nobody has INSERT/UPDATE/DELETE table grants (writes go via future SECDEF RPCs)

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
// S3: the event-spine migration needs pgcrypto (`digest()` for the hash chain) and
// pg_trgm (lot-code search). PGlite ships these as opt-in WASM contrib modules that
// must be loaded into the constructor AND `create extension`-ed in SQL — loading here
// is what makes the real S3 migration replayable in-process (AD-9).
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/test/db -> repo root
export const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "supabase", "migrations");

/** Absolute paths of the real migrations, in filename (== chronological) order. */
export function migrationFiles(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(dir, f));
}

export interface Harness {
  /** The raw PGlite handle (runs as the `postgres` superuser / table owner). */
  db: PGlite;
  /** Run a query as the current role; returns rows. */
  query<T = Record<string, unknown>>(sql: string): Promise<T[]>;
  /** Tear down the in-process DB. */
  close(): Promise<void>;
}

/**
 * Spin up a fresh PGlite, seed the Supabase role baseline, and replay every
 * migration in `supabase/migrations` in filename order. One DB per call — call
 * once per test file (typically in `beforeAll`) for isolation.
 *
 * @param opts.only  Replay only the migrations whose filename includes one of
 *                   these substrings (in order). Used by the RLS proof test to
 *                   show that init-only lets anon read — i.e. the harness models
 *                   the security delta, not a hardcoded result.
 */
export async function freshDb(opts: { only?: string[] } = {}): Promise<Harness> {
  // Load the contrib extensions S3 depends on. The migration still `create
  // extension`s them in SQL (matching prod); loading them here only makes the WASM
  // symbols resolvable so that `create extension` succeeds in PGlite.
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });

  // AD-9: the migrations GRANT/REVOKE against these roles, so they must pre-exist.
  // `nologin` mirrors Supabase (these are REST-API roles, not login roles).
  await db.exec("create role anon nologin; create role authenticated nologin;");

  let files = migrationFiles();
  if (opts.only && opts.only.length > 0) {
    files = files.filter((f) => opts.only!.some((needle) => f.includes(needle)));
  }

  for (const file of files) {
    const sql = readFileSync(file, "utf8");
    // PGlite's `exec` runs a multi-statement script and tolerates the outer
    // `begin;`/`commit;` the migrations wrap themselves in (no stripping needed).
    await db.exec(sql);
  }

  return {
    db,
    async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
      const res = await db.query<T>(sql);
      return res.rows;
    },
    async close() {
      await db.close();
    },
  };
}

const DEFAULT_AUTHENTICATED_CLAIMS = {
  role: "authenticated",
  // a stable fake user id so auth.uid() resolves under RLS policies that use it
  sub: "00000000-0000-0000-0000-000000000001",
};

const DEFAULT_ANON_CLAIMS = { role: "anon" };

/** Stamp PostgREST-equivalent JWT claims onto the session (local to the txn-less session). */
async function setClaims(db: PGlite, claims: Record<string, unknown>): Promise<void> {
  // `false` => set for the session (not just the current txn), since exec runs
  // each statement autocommit. Escape single quotes for SQL string literal safety.
  const json = JSON.stringify(claims).replace(/'/g, "''");
  await db.exec(`select set_config('request.jwt.claims', '${json}', false);`);
}

/**
 * Run `fn` AS the `anon` role with anon JWT claims, then reset back to the owner.
 * Models the public/unauthenticated REST caller — which, post-migration, can read
 * NOTHING (its SELECT grant was revoked).
 */
export async function asAnon<T>(
  h: Harness,
  fn: (h: Harness) => Promise<T>,
  claims: Record<string, unknown> = DEFAULT_ANON_CLAIMS,
): Promise<T> {
  await setClaims(h.db, claims);
  await h.db.exec("set role anon;");
  try {
    return await fn(h);
  } finally {
    await h.db.exec("reset role;");
    await h.db.exec("select set_config('request.jwt.claims', '', false);");
  }
}

/**
 * Run `fn` AS the `authenticated` role with authenticated JWT claims, then reset.
 * Models a signed-in REST caller — which reads via its SELECT grant + the
 * "authenticated read" RLS policy. Pass `claims` to override the default user.
 */
export async function asAuthenticated<T>(
  h: Harness,
  fn: (h: Harness) => Promise<T>,
  claims: Record<string, unknown> = DEFAULT_AUTHENTICATED_CLAIMS,
): Promise<T> {
  await setClaims(h.db, { ...DEFAULT_AUTHENTICATED_CLAIMS, ...claims });
  await h.db.exec("set role authenticated;");
  try {
    return await fn(h);
  } finally {
    await h.db.exec("reset role;");
    await h.db.exec("select set_config('request.jwt.claims', '', false);");
  }
}
