// P4-S0 — Cross-tenant isolation probe (plan §8). THE acceptance gate for the
// multi-tenant retrofit: it proves the cross-tenant leak exists TODAY (falsifiability
// block, runs now and passes) and is closed AFTER P4-S0 lands (the isolation matrix,
// which activates the moment the P4-S0 migrations are on disk).
//
// ────────────────────────────────────────────────────────────────────────────
// TWO-PHASE LIFECYCLE (read this before "why is half the file skipped?")
//
//   * The FALSIFIABILITY describe runs UNCONDITIONALLY, today, against the CURRENT
//     schema. It seeds two structurally-identical "tenant" graphs (distinguished only
//     by their text business keys, since no tenant_id column exists yet) and asserts
//     the OPPOSITE of isolation: an authenticated session reads BOTH graphs. That is
//     the live `using(true)` leak, demonstrated — "fails for the right reason" made
//     concrete. redConfirmed=true hangs off this block passing.
//
//   * The ISOLATION MATRIX (read isolation, write isolation, idempotency-collision,
//     matview, static parity, membership-lookup) is gated behind `P4S0_PRESENT`. P4-S0
//     introduces `tenants`/`tenant_users`/`current_tenant_id()` + a `tenant_id` column
//     on ~54 tables; until those migrations exist, these blocks CANNOT run (there is no
//     `tenants` table to seed, no `current_tenant_id()` to resolve). They are
//     `describe.skipIf(!P4S0_PRESENT)` so the file is GREEN today (falsifiability passes,
//     matrix skipped) and FULLY ACTIVE the instant the Migrate agent lands the P4-S0
//     band — no edit to this file required. This is the test-first contract: the
//     assertions are written against the post-retrofit behavior and wait for it.
// ────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAuthenticated,
  asTenant,
  freshDb,
  migrationFiles,
  type Harness,
} from "./pgliteHarness";
import { EXEMPT, TENANT_TABLES } from "./tenantTables";

// ── tenant + user uuids (real uuids: current_tenant_id() casts sub::uuid) ──────────
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_B = "11111111-2222-3333-4444-555555555555"; // a tenant_users member of B

// Lot codes must satisfy lots_code_format (^JC-[0-9]{3,}$, digits only). Tenant A's
// graph uses the JC-1xx band, tenant B's the JC-2xx band, so they stay distinguishable
// while remaining valid.
const LOT_A = "JC-100";
const LOT_B = "JC-200";

// P4-S0 is "present" once a migration in the 20260701xxxxxx band (§7) is on disk.
// Until then the isolation matrix is skipped (no tenancy substrate to exercise).
const P4S0_PRESENT = migrationFiles().some((f) => /2026070\d{7}/.test(f));

// ── shared two-tenant seed (owner role; postgres BYPASSES RLS, the only way to plant
// B's rows regardless of policy). Plants a minimal structurally-identical graph for A
// and B. Post-retrofit the columns are `not null default current_tenant_id()`, and
// under the owner role with TWO tenants seeded that default is NULL (the §3 single-tenant
// fallback is armed only at count(*)=1) — so every owner-side insert here MUST set
// tenant_id LITERALLY (MED-2). The two-tenant seed is also what arms the strict
// fail-closed guard: with count(*) from tenants = 2 the fallback returns NULL, so the
// "claimless" assertions test the REAL guard, not the convenience fallback.
async function seedTwoTenants(h: Harness): Promise<void> {
  await h.query(`
    insert into tenants (id, slug, name) values
      ('${A}', 'tenant-a', 'Estate A'),
      ('${B}', 'tenant-b', 'Estate B');`);

  // one row per root table, per tenant, tenant_id stamped LITERALLY (owner default is NULL here).
  for (const [t, code, lot] of [
    [A, "A", LOT_A],
    [B, "B", LOT_B],
  ] as const) {
    await h.query(`
      insert into plots
        (tenant_id, id, ord, name, block, variety, area_ha, altitude_masl, trees,
         shade_pct, established_year, status, last_inspected, expected_yield_kg, harvested_kg)
        values ('${t}', 'p${code}', 1, 'Plot ${code}', 'B1', 'Geisha', 1.0, 1600, 800, 35,
                2012, 'healthy', '2026-01-01', 1500, 600);`);
    await h.query(`
      insert into workers
        (tenant_id, id, name, role, daily_rate_usd, attendance, started_year, phone, today_kg, crew)
        values ('${t}', 'w${code}', 'Worker ${code}', 'Picker', 22, 'present', 2015,
                '+507 6500-0000', 0, 'Crew ${code}');`);
    await h.query(`insert into lots (tenant_id, code) values ('${t}', '${lot}');`);
    await h.query(`
      insert into harvests
        (tenant_id, id, date, plot_id, worker_id, cherries_kg, ripeness_pct, brix_avg, lot_code)
        values ('${t}', 'h${code}', '2026-01-02', 'p${code}', 'w${code}', 100, 90, 22, '${lot}');`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// FALSIFIABILITY — runs TODAY against the current schema. Proves the leak is real.
// ════════════════════════════════════════════════════════════════════════════
//
// No tenant_id column / no tenants table exists pre-P4-S0, so we plant two graphs
// distinguished only by their text business keys (pA/pB, JC-100/JC-200) and
// assert the OPPOSITE of isolation: under today's `using(true)` an authenticated
// session reads BOTH tenants' rows. A real returned row (not an import/SQL error) is
// the proof that `using(true)` provides ZERO cross-tenant separation — the bug the
// P4-S0 retrofit closes. Mirrors rls-posture.db.test.ts's init-only delta pattern.
describe("P4-S0 falsifiability — today's using(true) leaks cross-tenant", () => {
  let h: Harness;

  beforeAll(async () => {
    // Replay the entire CURRENT migration stack (P4-S0 is excluded simply because it
    // does not exist yet; once it does, this block still demonstrates the pre-retrofit
    // leak because it seeds NO tenant_id and reads with a plain authenticated session).
    h = await freshDb();
    // Owner role bypasses RLS — plant both "tenants'" rows. No tenant_id column today.
    for (const [code, lot] of [
      ["A", LOT_A],
      ["B", LOT_B],
    ] as const) {
      await h.query(`
        insert into plots
          (id, ord, name, block, variety, area_ha, altitude_masl, trees, shade_pct,
           established_year, status, last_inspected, expected_yield_kg, harvested_kg)
          values ('p${code}', 1, 'Plot ${code}', 'B1', 'Geisha', 1.0, 1600, 800, 35,
                  2012, 'healthy', '2026-01-01', 1500, 600);`);
      await h.query(`insert into lots (code) values ('${lot}');`);
    }
  });

  afterAll(async () => h.close());

  it("an authenticated session reads BOTH tenants' plots (no isolation today)", async () => {
    const rows = await asAuthenticated(h, (hh) =>
      hh.query<{ id: string }>("select id from plots order by id"),
    );
    const ids = rows.map((r) => r.id);
    // The leak, demonstrated: a single session sees A's AND B's land.
    expect(ids).toContain("pA");
    expect(ids).toContain("pB");
  });

  it("the strong form: a session can reach the OTHER tenant's specific row by key", async () => {
    // This is the exact assertion that flips post-P4-S0: `where id = <B's row>` returns
    // B's row TODAY (using(true)), and must return ZERO rows once the policy is
    // `tenant_id = current_tenant_id()`. Today it MUST return the row.
    const rows = await asAuthenticated(h, (hh) =>
      hh.query<{ code: string }>(`select code from lots where code = '${LOT_B}'`),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe(LOT_B);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ISOLATION MATRIX — gated on P4-S0 being present (see lifecycle note above).
// ════════════════════════════════════════════════════════════════════════════
describe.skipIf(!P4S0_PRESENT)("P4-S0 isolation matrix (post-retrofit)", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await freshDb();
    await seedTwoTenants(h);
  });

  afterAll(async () => h.close());

  // ── 1. READ ISOLATION — every scoped table × (own-only) + (strong: cannot reach B's row).
  describe("read isolation — every scoped table", () => {
    it.each(TENANT_TABLES)(
      "as A, %s exposes only A's rows (non-vacuous) and never B's specific row",
      async (table) => {
        // Some tables may legitimately have zero seeded rows; for those the strong
        // `where tenant_id = B` form still carries the isolation proof. Where rows
        // exist, every visible tenant_id must equal A.
        const visible = await asTenant(h, A, (hh) =>
          hh.query<{ tenant_id: string }>(`select tenant_id from ${table}`),
        );
        for (const row of visible) {
          expect(row.tenant_id).toBe(A);
        }
        // Strong form: A's session can NEVER see a B-owned row (this is the assertion
        // that returns a row under using(true) and zero rows under the tenant policy).
        const bRows = await asTenant(h, A, (hh) =>
          hh.query(`select 1 from ${table} where tenant_id = '${B}'`),
        );
        expect(bRows).toHaveLength(0);
      },
    );
  });

  // ── 2. WRITE ISOLATION — each cross-tenant RPC rejects AND B's row is unchanged.
  // Each entry: call AS A but pointed at a B-owned entity; expect a tenant/not-found
  // rejection, then re-read B's subject AS OWNER and assert byte-identical (catches a
  // definer fn that raised AFTER mutating — proves Move C, not merely an error).
  describe("write isolation — cross-tenant RPC rejection", () => {
    const REJECT = /tenant|not found|unknown|permission|denied|violates|foreign key/i;

    it("record_cherry_intake as A against B's plot+worker is rejected", async () => {
      await expect(
        asTenant(h, A, (hh) =>
          hh.query(
            `select record_cherry_intake(
               p_plot_id => 'pB', p_worker_id => 'wB', p_cherries_kg => 10,
               p_idempotency_key => 'xt-intake-1')`,
          ),
        ),
      ).rejects.toThrow(REJECT);
    });

    it("materialize_green_lot as A against B's lot is rejected, B's lot unchanged", async () => {
      const before = await h.query(
        `select * from lots where code = '${LOT_B}' and tenant_id = '${B}'`,
      );
      await expect(
        asTenant(h, A, (hh) =>
          hh.query(`select materialize_green_lot('${LOT_B}')`),
        ),
      ).rejects.toThrow(REJECT);
      const after = await h.query(
        `select * from lots where code = '${LOT_B}' and tenant_id = '${B}'`,
      );
      expect(after).toEqual(before);
    });

    it("approve_pay_line as A against a B pay line is rejected", async () => {
      await expect(
        asTenant(h, A, (hh) =>
          hh.query(`select approve_pay_line('pay-line-B')`),
        ),
      ).rejects.toThrow(REJECT);
    });

    it("place_qc_hold as A against a B lot is rejected", async () => {
      await expect(
        asTenant(h, A, (hh) =>
          hh.query(`select place_qc_hold('${LOT_B}', 'cup-defect')`),
        ),
      ).rejects.toThrow(REJECT);
    });

    it("record_dispatch_ack as A against a B dispatch run is rejected", async () => {
      await expect(
        asTenant(h, A, (hh) =>
          hh.query(`select record_dispatch_ack('dispatch-run-B')`),
        ),
      ).rejects.toThrow(REJECT);
    });
  });

  // ── 2b. SAME-IDEMPOTENCY-KEY CROSS-TENANT COLLISION (HIGH-1, the pre-insert leak).
  // A and B both call an idempotent intake RPC with the IDENTICAL key. Each MUST get
  // back its OWN tenant's distinct row. On pre-fix code (early-return SELECT keyed on
  // idempotency_key only) B short-circuits and returns A's row -> RED; after Move D's
  // `and tenant_id = v_tenant` clamp -> GREEN.
  it("same idempotency_key across tenants returns each tenant's OWN row (HIGH-1)", async () => {
    const KEY = "intake-2026-06-21-001";
    const aResult = await asTenant(h, A, (hh) =>
      hh.query<{ lot_code: string }>(
        `select (record_cherry_intake(
           p_plot_id => 'pA', p_worker_id => 'wA', p_cherries_kg => 50,
           p_idempotency_key => '${KEY}')).lot_code as lot_code`,
      ),
    );
    const bResult = await asTenant(h, B, (hh) =>
      hh.query<{ lot_code: string }>(
        `select (record_cherry_intake(
           p_plot_id => 'pB', p_worker_id => 'wB', p_cherries_kg => 50,
           p_idempotency_key => '${KEY}')).lot_code as lot_code`,
      ),
    );
    // Distinct, own-tenant rows — B must NEVER receive A's lot code.
    expect(bResult[0].lot_code).not.toBe(aResult[0].lot_code);
    // And cross-check ownership: each lot belongs to its own tenant.
    const owners = await h.query<{ code: string; tenant_id: string }>(
      `select code, tenant_id from lots
        where code in ('${aResult[0].lot_code}', '${bResult[0].lot_code}')`,
    );
    const ownerOf = (code: string) => owners.find((o) => o.code === code)?.tenant_id;
    expect(ownerOf(aResult[0].lot_code)).toBe(A);
    expect(ownerOf(bResult[0].lot_code)).toBe(B);
  });

  // ── 3. MATVIEW ISOLATION (keystone) — the #1 financial leak. A matview cannot carry
  // RLS, so a "tables-only" P4-S0 would pass the table probes while the matview still
  // exposes every tenant's COGS. Refresh as owner, then read AS A through whatever
  // accessor P4-S0 introduces (security_barrier view / SECDEF fn) and assert no B-band
  // (JC-2xx) lot code surfaces to A.
  describe("matview isolation — no cross-tenant COGS leak", () => {
    it.each(["mv_lot_cost", "mv_lot_cost_by_rule"])(
      "%s exposes no B-tenant lot to A",
      async (mv) => {
        await h.query(`refresh materialized view ${mv}`);
        // Read through the P4-S0 accessor if present (a security_barrier wrapper named
        // <mv>_secure), else fall back to the raw matview — the assertion is identical:
        // A must see no green_lot_code starting with the B tenant's lot prefix.
        const accessor = await h.query<{ exists: boolean }>(
          `select exists(select 1 from pg_class where relname = '${mv}_secure') as exists`,
        );
        const src = accessor[0]?.exists ? `${mv}_secure` : mv;
        const rows = await asTenant(h, A, (hh) =>
          hh.query<{ green_lot_code: string }>(`select green_lot_code from ${src}`),
        );
        for (const r of rows) {
          // B's lot graph lives in the JC-2xx band; A must never see it via the matview.
          expect(r.green_lot_code).not.toBe(LOT_B);
          expect(r.green_lot_code).not.toMatch(/^JC-2/);
        }
      },
    );
  });

  // ── 4. STATIC PARITY GUARD — driven off pg_class, not a hand literal (HIGH-2).
  // After replaying all migrations, EVERY RLS-enabled base table in public must be
  // either in TENANT_TABLES (and visibly scoped) or in the EXEMPT allowlist. A table
  // in neither REDS the suite — this is what catches "added a 55th table later but
  // forgot tenant_id." The TENANT_TABLES array is the SAME constant the migration loops.
  describe("static parity guard — every RLS table is scoped or explicitly exempt", () => {
    it("no RLS-enabled base table is missing from TENANT_TABLES ∪ EXEMPT", async () => {
      const rlsTables = await h.query<{ relname: string }>(`
        select c.relname
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relkind = 'r'
           and c.relrowsecurity = true
         order by c.relname`);
      const known = new Set<string>([...TENANT_TABLES, ...EXEMPT]);
      const orphans = rlsTables
        .map((r) => r.relname)
        .filter((name) => !known.has(name));
      expect(orphans).toEqual([]);
    });

    it("every TENANT_TABLES entry actually gained a tenant_id column", async () => {
      const cols = await h.query<{ table_name: string }>(`
        select table_name from information_schema.columns
         where table_schema = 'public' and column_name = 'tenant_id'`);
      const haveTenantId = new Set(cols.map((c) => c.table_name));
      const missing = TENANT_TABLES.filter((t) => !haveTenantId.has(t));
      expect(missing).toEqual([]);
    });

    it("every scoped table's RLS policy references current_tenant_id() (not using(true))", async () => {
      // pg_policy.qual / with_check rendered text must mention current_tenant_id and
      // must NOT be the bare `true` predicate, for every scoped table.
      const pol = await h.query<{ relname: string; qual: string; withcheck: string }>(`
        select c.relname,
               coalesce(pg_get_expr(p.polqual, p.polrelid), '')      as qual,
               coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as withcheck
          from pg_policy p
          join pg_class c on c.oid = p.polrelid
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = any($1)`.replace(
        "$1",
        `array[${TENANT_TABLES.map((t) => `'${t}'`).join(",")}]`,
      ));
      const offenders = pol.filter(
        (p) =>
          !/current_tenant_id\(\)/.test(`${p.qual} ${p.withcheck}`) ||
          /^\s*true\s*$/.test(p.qual),
      );
      expect(offenders.map((o) => o.relname)).toEqual([]);
    });
  });

  // ── 5. MEMBERSHIP-LOOKUP BRANCH (MED-4) — the SSOT trust anchor, otherwise untested.
  // asTenant only stamps the app_metadata fast path; the sub-keyed membership arm of
  // current_tenant_id() is exercised here by inserting a tenant_users row directly and
  // calling with `sub` set but NO app_metadata -> must resolve to B (membership arm,
  // not fast path, not single-tenant fallback which is NULL with two tenants).
  it("current_tenant_id() resolves via the tenant_users membership arm (MED-4)", async () => {
    await h.query(
      `insert into tenant_users (tenant_id, user_id, role) values ('${B}', '${USER_B}', 'owner')
       on conflict (tenant_id, user_id) do nothing`,
    );
    const resolved = await asAuthenticated(
      h,
      (hh) => hh.query<{ tid: string }>(`select current_tenant_id() as tid`),
      { role: "authenticated", sub: USER_B }, // NO app_metadata -> forces the membership arm
    );
    expect(resolved[0].tid).toBe(B);
  });

  // ── ADDITIONAL TARGETED ASSERTIONS (folded from the RLS facet) ──────────────
  describe("additional cross-tenant guards", () => {
    it("insert-forge: an authenticated A cannot write a row stamped tenant_id = B", async () => {
      // with check (tenant_id = current_tenant_id()) must reject an explicit foreign id.
      // (Goes through a grant-bearing path only where a direct INSERT grant exists;
      //  where writes are RPC-only the equivalent is covered by write-isolation above.)
      await expect(
        asTenant(h, A, (hh) =>
          hh.query(
            `insert into tasks (tenant_id, id, title, category, worker_id, due, status, priority)
             values ('${B}', 'forged-1', 'x', 'Harvest', 'wB', '2026-02-01', 'todo', 'high')`,
          ),
        ),
      ).rejects.toThrow(/permission|denied|policy|violates|check|tenant/i);
    });

    it("claimless fail-closed (two tenants seeded -> fallback is NULL): sees nothing", async () => {
      // With count(*) from tenants = 2 the §3 single-tenant fallback returns NULL, so a
      // no-claim authenticated session is fully fail-closed (proves the strict guard,
      // not the convenience fallback).
      const rows = await asAuthenticated(h, (hh) =>
        hh.query(`select id from plots`),
      );
      expect(rows).toHaveLength(0);
    });

    it("claimless fail-closed: a command RPC raises (no tenant in session)", async () => {
      await expect(
        asAuthenticated(h, (hh) =>
          hh.query(
            `select record_cherry_intake(
               p_plot_id => 'pA', p_worker_id => 'wA', p_cherries_kg => 1,
               p_idempotency_key => 'claimless-1')`,
          ),
        ),
      ).rejects.toThrow(/tenant|insufficient|denied|permission/i);
    });

    it("ledger stamp-integrity: an owner-injected lot_event with mismatched tenant_id raises (HIGH-3)", async () => {
      // The BEFORE-INSERT assert must reject a row whose tenant_id disagrees with the
      // chain it is appending to. Seeded under owner; the trigger fires regardless of role.
      await expect(
        h.query(`
          insert into lot_event
            (tenant_id, stream_key, kind, payload, device_id, device_seq, occurred_at)
          values ('${A}', 'lot:${LOT_B}', 'NOTE', '{}'::jsonb, 'dev-x', 1, now())`),
      ).rejects.toThrow(/tenant|mismatch|violates|integrity/i);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// EXTENDED ISOLATION — the SECURITY DEFINER write/derive RPCs the base matrix did NOT
// exercise (or exercised only via an incidental arity/FK accident, not a real tenant
// check). Each leak below was CONFIRMED by adversarial review: a definer fn that
// mutates/aggregates a SCOPED row by BARE code/id, with no `and tenant_id = v_tenant`,
// runs as owner (RLS bypassed) and — under the LOCKED per-tenant lot codes (both tenants
// legitimately mint 'JC-001') — touches the OTHER tenant's row.
//
// This block seeds a SHARED-CODE collision (both tenants own 'JC-001') so every call
// below is the COMMON case, not an edge case. Each test (a) calls the FULL signature as
// A against a B-owned key and asserts rejection / no-op, and (b) re-reads B's subject as
// OWNER and asserts it is byte-identical / still in its pre-call state.
// ════════════════════════════════════════════════════════════════════════════
describe.skipIf(!P4S0_PRESENT)("P4-S0 extended isolation — definer RPC write/derive clamps", () => {
  let h: Harness;
  const SHARED = "JC-001"; // both tenants mint this under per-tenant lot codes

  beforeAll(async () => {
    h = await freshDb();
    await seedTwoTenants(h);

    // Both tenants own the SAME lot code 'JC-001' (the per-tenant collision the locked
    // decision makes the COMMON case). Seed as owner with tenant_id LITERAL.
    for (const [t, code] of [
      [A, "A"],
      [B, "B"],
    ] as const) {
      await h.query(
        `insert into lots (tenant_id, code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
           values ('${t}', '${SHARED}', 'cherry', 'Geisha', 100, 100, true, now());`,
      );
    }

    // B owns a GREEN lot 'JC-200' + an OPEN qc_hold on it (release_qc_hold target).
    await h.query(
      `update lots set stage = 'green' where code = '${LOT_B}' and tenant_id = '${B}';`,
    );
    await h.query(
      `insert into green_lots (tenant_id, lot_code, cupping_score, location)
         values ('${B}', '${LOT_B}', 86, 'Warehouse B');`,
    );
    await h.query(
      `insert into qc_holds (tenant_id, green_lot_code, reason, placed_by, device_id, device_seq)
         values ('${B}', '${LOT_B}', 'cup-defect', 'devB', 'devB', 1);`,
    );

    // B owns a pay_period 'pp-B' (calculated) + a pay_line (calculated) on it.
    await h.query(
      `insert into pay_period (tenant_id, id, period_start, period_end, status)
         values ('${B}', 'pp-B', '2026-06-01', '2026-06-07', 'calculated');`,
    );
    await h.query(
      `insert into pay_line (tenant_id, pay_period_id, worker_id, hours_worked, worked_days,
                             piece_rate_usd, hourly_usd, status)
         values ('${B}', 'pp-B', 'wB', 8, 1, 30, 0, 'calculated');`,
    );
  });

  afterAll(async () => h.close());

  const REJECT = /tenant|not found|unknown|permission|denied|violates|foreign key|insufficient|no_data|privilege/i;

  // ── advance_processing_stage — the FULL 7-arg signature as A against B's 'JC-001' ──
  it("advance_processing_stage (full 7-arg) as A cannot mutate B's lot — B's row byte-identical", async () => {
    const before = await h.query(
      `select stage, current_kg from lots where code = '${SHARED}' and tenant_id = '${B}'`,
    );
    // As A, B owns 'JC-001' too. Without the tenant clamp the bare `update lots where
    // code='JC-001'` matched BOTH rows; with it, A only sees/touches its OWN 'JC-001'.
    await asTenant(h, A, (hh) =>
      hh.query(
        `select advance_processing_stage('${SHARED}', 'green', 5, now(), 'devA', 1, 'adv-A-1')`,
      ),
    );
    const after = await h.query(
      `select stage, current_kg from lots where code = '${SHARED}' and tenant_id = '${B}'`,
    );
    expect(after).toEqual(before); // B's lot untouched (was {cherry,100})
  });

  it("advance_processing_stage as claimless session raises (no tenant)", async () => {
    await expect(
      asAuthenticated(h, (hh) =>
        hh.query(
          `select advance_processing_stage('${SHARED}', 'green', 1, now(), 'd', 9, 'adv-claimless')`,
        ),
      ),
    ).rejects.toThrow(REJECT);
  });

  // ── reposo_status — SECURITY DEFINER read/derive; must count ONLY the caller's lot ──
  it("reposo_status as A counts only A's readings, never B's (cross-tenant read closed)", async () => {
    // Give B ten in-band moisture readings on its 'JC-001'; give A zero. Pre-fix,
    // reposo_status('JC-001') as A returned reading_count = 10 (all B's).
    for (let i = 0; i < 10; i++) {
      await h.query(
        `insert into moisture_readings
           (tenant_id, lot_code, moisture_pct, occurred_at, recorded_at, device_id, device_seq)
           values ('${B}', '${SHARED}', 11.0, now(), now(), 'devB', ${100 + i});`,
      );
    }
    const rows = await asTenant(h, A, (hh) =>
      hh.query<{ reading_count: number }>(
        `select reading_count from reposo_status('${SHARED}')`,
      ),
    );
    expect(Number(rows[0].reading_count)).toBe(0); // A has no readings; B's are invisible
  });

  // ── release_qc_hold — FULL signature as A against B's OPEN hold ──────────────
  it("release_qc_hold as A cannot clear B's open hold — B's hold stays open", async () => {
    await asTenant(h, A, (hh) =>
      hh.query(
        `select release_qc_hold('${LOT_B}', now(), 'devA', 7, 'rk-A-1')`,
      ),
    );
    const hold = await h.query<{ released_at: string | null }>(
      `select released_at from qc_holds where green_lot_code = '${LOT_B}' and tenant_id = '${B}'`,
    );
    expect(hold[0].released_at).toBeNull(); // still OPEN — A never cleared B's quarantine
  });

  // ── approve_pay_line(bigint) — the REAL write door, called DIRECTLY as A ─────
  it("approve_pay_line(bigint) as A against B's line is rejected — B's line + period unchanged", async () => {
    const lineRow = await h.query<{ id: string }>(
      `select id from pay_line where tenant_id = '${B}' and pay_period_id = 'pp-B'`,
    );
    const bLineId = lineRow[0].id;
    await expect(
      asTenant(h, A, (hh) =>
        hh.query(`select approve_pay_line(${bLineId}::bigint)`),
      ),
    ).rejects.toThrow(REJECT);
    const line = await h.query<{ status: string }>(
      `select status from pay_line where id = ${bLineId}`,
    );
    const period = await h.query<{ status: string }>(
      `select status from pay_period where id = 'pp-B' and tenant_id = '${B}'`,
    );
    expect(line[0].status).toBe("calculated"); // not approved
    expect(period[0].status).toBe("calculated"); // period not advanced
  });

  // ── weigh_event ledger — B's genesis on a SHARED stream_key must NOT chain off A ──
  // The ledgers are RPC-only at the policy/grant layer (no INSERT grant); to plant rows
  // we insert as the OWNER (which bypasses the grant) with the session GUC stamped to the
  // owning tenant, so the BEFORE-INSERT set_hash trigger's assert (new.tenant_id =
  // current_tenant_id()) is satisfied and the head-select runs under that tenant.
  async function ownerAppendWeigh(
    t: string,
    suffix: string,
    seq: number,
    key: string,
  ): Promise<void> {
    const claims = JSON.stringify({ role: "authenticated", app_metadata: { tenant_id: t } });
    await h.db.exec(`select set_config('request.jwt.claims', '${claims}', false);`);
    try {
      // each tenant weighs its OWN worker/plot/lot; lot_code 'JC-001' is owned by both
      // (the composite (tenant_id, lot_code) FK resolves to the owning tenant's row).
      await h.query(
        `insert into weigh_event
           (tenant_id, idempotency_key, stream_key, worker_id, plot_id, lot_code,
            kg, ripeness, occurred_at, device_id, device_seq)
           values ('${t}', '${key}', 'weigh:${SHARED}', 'w${suffix}', 'p${suffix}', '${SHARED}',
                   5, 'ripe'::ripeness, now(), 'dev-${key}', ${seq});`,
      );
    } finally {
      await h.db.exec(`select set_config('request.jwt.claims', '', false);`);
    }
  }

  it("weigh_event genesis for a shared stream_key has prev_hash NULL (no cross-tenant braid)", async () => {
    // Both tenants weigh their own 'JC-001' → stream_key 'weigh:JC-001' collides.
    // A appends first (genesis), then B appends its FIRST. Pre-fix B's genesis chained
    // off A's head; post-fix the head-select is tenant-scoped so B's genesis is null.
    await ownerAppendWeigh(A, "A", 1, "we-A-1");
    await ownerAppendWeigh(B, "B", 2, "we-B-1");
    const b = await h.query<{ prev_hash: string | null }>(
      `select prev_hash from weigh_event
         where tenant_id = '${B}' and idempotency_key = 'we-B-1'`,
    );
    expect(b[0].prev_hash).toBeNull(); // B's genesis is its OWN — not A's head
  });

  it("weigh_event BEFORE-INSERT assert rejects a forged cross-tenant tenant_id", async () => {
    // Session GUC = A, but the row claims tenant_id = B → the HIGH-3 assert (now on the
    // FOURTH ledger too) must raise. Insert as owner so the grant doesn't mask the assert.
    const claims = JSON.stringify({ role: "authenticated", app_metadata: { tenant_id: A } });
    await h.db.exec(`select set_config('request.jwt.claims', '${claims}', false);`);
    try {
      await expect(
        h.query(
          `insert into weigh_event
             (tenant_id, idempotency_key, stream_key, worker_id, plot_id, lot_code,
              kg, ripeness, occurred_at, device_id, device_seq)
             values ('${B}', 'we-forge-1', 'weigh:${SHARED}', 'wB', 'pB', '${SHARED}',
                     5, 'ripe'::ripeness, now(), 'devX', 9001);`,
        ),
      ).rejects.toThrow(/tenant|mismatch|violates|integrity/i);
    } finally {
      await h.db.exec(`select set_config('request.jwt.claims', '', false);`);
    }
  });

  // ── verify_chain — must walk ONLY the caller's tenant's events on a shared key ──
  it("verify_chain isolates per-tenant chains on a shared stream_key", async () => {
    // Each tenant writes its OWN valid 3-event chain on stream_key='vc-shared' via the
    // record_lot_event RPC (the granted, tenant-stamping write door). Pre-fix verify_chain
    // interleaved both tenants' events (ordered by global device_seq) and returned FALSE
    // for chains that are each individually valid; post-fix each walk is tenant-clamped.
    // device_seq must be globally monotonic per the shared lot_code_seq world; A uses the
    // 7000-band and B the 8000-band so the two interleave by global seq exactly as the
    // pre-fix leak required (A: 7001..7003, B: 8001..8003).
    for (const [t, base] of [
      [A, 7000],
      [B, 8000],
    ] as const) {
      for (let i = 1; i <= 3; i++) {
        await asTenant(h, t, (hh) =>
          hh.query(
            `select record_lot_event('vc-shared', 'NOTE', '{}'::jsonb, now(), 'dev-${t.slice(0, 4)}',
               ${base + i}, 'vc-${t.slice(0, 4)}-${i}')`,
          ),
        );
      }
    }
    const aOk = await asTenant(h, A, (hh) =>
      hh.query<{ ok: boolean }>(`select verify_chain('vc-shared') as ok`),
    );
    const bOk = await asTenant(h, B, (hh) =>
      hh.query<{ ok: boolean }>(`select verify_chain('vc-shared') as ok`),
    );
    expect(aOk[0].ok).toBe(true); // A's own chain verifies, undisturbed by B's events
    expect(bOk[0].ok).toBe(true);
  });

  // ── raw matview grant — the #1 financial leak: authenticated must NOT read it raw ──
  it("raw mv_lot_cost has NO authenticated SELECT grant (read only via the secure wrapper)", async () => {
    const raw = await h.query<{ has: boolean }>(
      `select has_table_privilege('authenticated','mv_lot_cost','select') as has`,
    );
    const rawByRule = await h.query<{ has: boolean }>(
      `select has_table_privilege('authenticated','mv_lot_cost_by_rule','select') as has`,
    );
    const secure = await h.query<{ has: boolean }>(
      `select has_table_privilege('authenticated','mv_lot_cost_secure','select') as has`,
    );
    expect(raw[0].has).toBe(false); // raw matview is owner-only
    expect(rawByRule[0].has).toBe(false);
    expect(secure[0].has).toBe(true); // the tenant-filtered surface IS granted
  });

  it("authenticated A reading raw mv_lot_cost is denied (grant revoked)", async () => {
    await h.query(`refresh materialized view mv_lot_cost`);
    await expect(
      asTenant(h, A, (hh) =>
        hh.query(`select tenant_id from mv_lot_cost`),
      ),
    ).rejects.toThrow(/permission|denied|privilege/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SYSTEMIC SWEEP ISOLATION — the ~20 SECURITY DEFINER write/derive RPCs across the
// people / dispatch / weigh / drying / payroll / IPM / EUDR surfaces that M3 did NOT
// itself redefine but that mutate or aggregate a SCOPED row by a BARE key (worker_id,
// crew_id, plot_id, run_id, lot_code, pay_period_id, idempotency_key). Each was clamped
// in its source migration (or redefined in M3 §K for the `language sql` ones). Under the
// LOCKED per-tenant codes both tenants legitimately share keys, so each call below is the
// COMMON case. Every test calls the FULL signature AS A against a B-owned key and asserts
// (a) B's subject row is byte-identical / untouched afterward, and (b) where the fn reads,
// it sees only A's data. A REGRESSION that drops a clamp re-reds exactly this block.
// ════════════════════════════════════════════════════════════════════════════
describe.skipIf(!P4S0_PRESENT)("P4-S0 sweep isolation — systemic definer-RPC clamps", () => {
  let h: Harness;
  const SHARED = "JC-001"; // both tenants mint this under per-tenant lot codes

  beforeAll(async () => {
    h = await freshDb();
    await seedTwoTenants(h);

    // Both tenants own lot 'JC-001' (cherry) and a crew 'crew-1' + active membership for
    // their own worker. Global single-col FKs (crews.id, crew_memberships.worker_id) mean
    // the keys collide across tenants — the per-tenant collision the locked decision makes
    // the common case. Seed as OWNER with tenant_id LITERAL.
    for (const [t, code] of [
      [A, "A"],
      [B, "B"],
    ] as const) {
      await h.query(
        `insert into lots (tenant_id, code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
           values ('${t}', '${SHARED}', 'cherry', 'Geisha', 100, 100, true, now());`,
      );
      // crews.id / drying_stations.id are GLOBAL single-col PKs — give each tenant a
      // distinct id (the cross-tenant collision the sweep guards against is on the
      // tenant-scoped CHILD rows the RPCs mutate, not on these parent PKs).
      await h.query(
        `insert into crews (tenant_id, id, name, season) values ('${t}', 'crew-${code}', 'Crew ${code}', '2026');`,
      );
      await h.query(
        `insert into crew_memberships (tenant_id, worker_id, crew_id, joined_at)
           values ('${t}', 'w${code}', 'crew-${code}', now());`,
      );
      await h.query(
        `insert into worker_identity (tenant_id, worker_id, rehire_eligible)
           values ('${t}', 'w${code}', true);`,
      );
      await h.query(
        `insert into drying_stations (tenant_id, id, name, kind, capacity_kg)
           values ('${t}', 'st-${code}', 'Station ${code}', 'patio', 5000);`,
      );
    }

    // B owns a DRAFT dispatch_run for crew-B (mark_dispatch_sent / generate_dispatch target).
    await h.query(
      `insert into dispatch_run (tenant_id, crew_id, dispatch_date, season, status, occurred_at, device_id, device_seq)
         values ('${B}', 'crew-B', '2026-06-20', '2026', 'draft', now(), 'devB', 1);`,
    );

    // B owns an OPEN drying assignment on its 'JC-001' (assign_drying_station target).
    await h.query(
      `insert into drying_assignments (tenant_id, lot_code, station_id, committed_kg, assigned_at)
         values ('${B}', '${SHARED}', 'st-B', 50, now());`,
    );

    // B owns a processing_batch on its 'JC-001' (record_moisture_reading mirror target).
    await h.query(
      `insert into processing_batches
         (tenant_id, id, lot_code, variety, method, stage, started_date,
          cherries_kg, current_kg, moisture_pct, patio, progress_pct)
         values ('${B}', 'pb-B-001', '${SHARED}', 'Geisha', 'Washed', 'drying', '2026-06-19',
                 50, 50, 18.0, 'Patio B', 40);`,
    );
  });

  afterAll(async () => h.close());

  const REJECT = /tenant|not found|unknown|permission|denied|violates|foreign key|insufficient|no_data|privilege|not an active/i;

  // ── people RPCs ──────────────────────────────────────────────────────────
  it("rehire_worker as A cannot reach B's worker_identity / crews / crew_memberships", async () => {
    // B owns worker wB + crew-1. As A (who has no wB / its own crew-1), a rehire of 'wB'
    // must resolve B's identity as INVISIBLE → fail closed, never close B's membership or
    // stamp B's crew season. Re-read B's membership + crew afterward: untouched.
    const beforeMembership = await h.query(
      `select left_at from crew_memberships where tenant_id = '${B}' and worker_id = 'wB'`,
    );
    const beforeCrew = await h.query(
      `select season from crews where tenant_id = '${B}' and id = 'crew-B'`,
    );
    await expect(
      asTenant(h, A, (hh) =>
        hh.query(
          `select rehire_worker('wB', 'crew-A', '2099-SEASON', now(), 'devA', 1, 'rh-A-1')`,
        ),
      ),
    ).rejects.toThrow(REJECT);
    const afterMembership = await h.query(
      `select left_at from crew_memberships where tenant_id = '${B}' and worker_id = 'wB'`,
    );
    const afterCrew = await h.query(
      `select season from crews where tenant_id = '${B}' and id = 'crew-B'`,
    );
    expect(afterMembership).toEqual(beforeMembership); // B's membership still open
    expect(afterCrew).toEqual(beforeCrew); // B's crew season NOT overwritten to '2099-SEASON'
  });

  it("enroll_crew_member as A cannot close B's active membership", async () => {
    // As A, enrolling 'wB' (B's worker) into A's crew must not close B's existing membership.
    const before = await h.query(
      `select left_at from crew_memberships where tenant_id = '${B}' and worker_id = 'wB'`,
    );
    await expect(
      asTenant(h, A, (hh) =>
        hh.query(`select enroll_crew_member('wB', 'crew-A', now(), 'devA', 1, 'en-A-1')`),
      ),
    ).rejects.toThrow(REJECT);
    const after = await h.query(
      `select left_at from crew_memberships where tenant_id = '${B}' and worker_id = 'wB'`,
    );
    expect(after).toEqual(before); // B's membership untouched (still open)
  });

  // ── dispatch RPCs ────────────────────────────────────────────────────────
  it("mark_dispatch_sent as A cannot flip B's draft run to sent", async () => {
    const run = await h.query<{ id: string }>(
      `select id from dispatch_run where tenant_id = '${B}' and crew_id = 'crew-B'`,
    );
    const bRunId = run[0].id;
    await expect(
      asTenant(h, A, (hh) =>
        hh.query(
          `select mark_dispatch_sent(${bRunId}::bigint, 'web-share', now(), 'devA', 1, 'ms-A-1')`,
        ),
      ),
    ).rejects.toThrow(REJECT);
    const after = await h.query<{ status: string }>(
      `select status from dispatch_run where id = ${bRunId}`,
    );
    expect(after[0].status).toBe("draft"); // B's run NOT sent
  });

  // ── weigh RPC ──────────────────────────────────────────────────────────────
  it("record_weigh_in as A cannot inflate B's shared 'JC-001' lot mass", async () => {
    // Seed an A-owned weigh_event on (pA, today) bound to A's OWN 'JC-001' cherry lot, so
    // A's NEXT weigh on pA reuses 'JC-001' and hits the subsequent-weigh `update lots
    // where code = v_lot` branch. Without the tenant clamp that bare-code UPDATE grows
    // BOTH A's and B's 'JC-001'. Stamp the session GUC to A so the weigh_event_set_hash
    // BEFORE-INSERT tenant assert (new.tenant_id = current_tenant_id()) is satisfied.
    {
      const claims = JSON.stringify({ role: "authenticated", app_metadata: { tenant_id: A } });
      await h.db.exec(`select set_config('request.jwt.claims', '${claims}', false);`);
      try {
        await h.query(
          `insert into weigh_event
             (tenant_id, idempotency_key, stream_key, worker_id, plot_id, lot_code,
              kg, ripeness, occurred_at, device_id, device_seq)
             values ('${A}', 'we-seed-A', 'weigh:${SHARED}', 'wA', 'pA', '${SHARED}',
                     5, 'ripe'::ripeness, now(), 'devA-seed', 4000);`,
        );
      } finally {
        await h.db.exec(`select set_config('request.jwt.claims', '', false);`);
      }
    }
    const before = await h.query(
      `select origin_kg, current_kg from lots where tenant_id = '${B}' and code = '${SHARED}'`,
    );
    // A's weigh on pA reuses A's 'JC-001' (a subsequent weigh → the `update lots` branch).
    // The bare-code UPDATE must touch ONLY A's row, never B's same-coded lot.
    await asTenant(h, A, (hh) =>
      hh.query(
        `select record_weigh_in('wA', 'pA', 7, 'ripe'::ripeness, null, null, null, null,
           now(), 'devA', 5001, 'we-mass-A-1')`,
      ),
    ).catch(() => undefined); // tolerate any A-side validation; B-invariance is the assertion
    const after = await h.query(
      `select origin_kg, current_kg from lots where tenant_id = '${B}' and code = '${SHARED}'`,
    );
    expect(after).toEqual(before); // B's 'JC-001' mass unchanged
  });

  // ── drying RPCs ──────────────────────────────────────────────────────────
  it("assign_drying_station as A cannot close B's open drying assignment", async () => {
    const before = await h.query(
      `select released_at from drying_assignments where tenant_id = '${B}' and lot_code = '${SHARED}'`,
    );
    // As A, assigning A's own 'JC-001' to A's own station must not close B's open
    // assignment on the same lot code.
    await asTenant(h, A, (hh) =>
      hh.query(`select assign_drying_station('${SHARED}', 'st-A', now())`),
    ).catch(() => undefined);
    const after = await h.query(
      `select released_at from drying_assignments where tenant_id = '${B}' and lot_code = '${SHARED}'`,
    );
    expect(after).toEqual(before); // B's assignment still OPEN
  });

  it("record_moisture_reading as A cannot stamp B's processing_batch", async () => {
    const before = await h.query(
      `select moisture_pct from processing_batches where tenant_id = '${B}' and lot_code = '${SHARED}'`,
    );
    await asTenant(h, A, (hh) =>
      hh.query(
        `select record_moisture_reading('${SHARED}', 9.9, now(), 'devA', 6001, 'mr-A-1')`,
      ),
    ).catch(() => undefined);
    const after = await h.query(
      `select moisture_pct from processing_batches where tenant_id = '${B}' and lot_code = '${SHARED}'`,
    );
    expect(after).toEqual(before); // B's batch moisture NOT overwritten
  });

  // ── payroll: compute_pay_period must NOT run payroll across every tenant ──
  it("compute_pay_period as A writes pay_line ONLY for A's workers, never B's", async () => {
    await asTenant(h, A, (hh) =>
      hh.query(
        `select compute_pay_period('pp-sweep-A', '2026-06-08', '2026-06-14', '2026')`,
      ),
    );
    // The unfiltered `for r in select id from workers` loop runs payroll over EVERY
    // tenant's workers — so B's worker 'wB' would get a pay_line in A's period (the
    // INSERT mis-stamps it tenant_id=A via the column default, hiding it from a tenant_id
    // check). Assert by WORKER_ID: only A's own workers may appear, never B's 'wB'.
    const lines = await h.query<{ worker_id: string }>(
      `select worker_id from pay_line where pay_period_id = 'pp-sweep-A'`,
    );
    const workerIds = lines.map((l) => l.worker_id);
    expect(workerIds).not.toContain("wB"); // B's worker must NOT be in A's payroll run
    expect(workerIds).toContain("wA"); // A's own worker IS (non-vacuous)
  });

  it("compute_pay_period as a claimless session raises (no tenant — never all-estates payroll)", async () => {
    await expect(
      asAuthenticated(h, (hh) =>
        hh.query(
          `select compute_pay_period('pp-claimless', '2026-06-08', '2026-06-14', '2026')`,
        ),
      ),
    ).rejects.toThrow(REJECT);
  });

  // ── EUDR: a definer plot-declaration write must not reach B's plot ──────────
  it("eudr_declare_plot as A cannot rewrite B's plot deforestation declaration", async () => {
    const before = await h.query(
      `select eudr_deforestation_free from plots where tenant_id = '${B}' and id = 'pB'`,
    );
    // As A, declaring plot 'pB' (B's plot) deforestation-free must fail closed (A sees no
    // 'pB'), never flip B's compliance flag — an export-fraud surface. A VALID basis is
    // used so the ONLY barrier is the tenant clamp (not the basis CHECK constraint).
    await expect(
      asTenant(h, A, (hh) =>
        hh.query(`select eudr_declare_plot('pB', true, 'satellite-monitoring')`),
      ),
    ).rejects.toThrow(REJECT);
    const after = await h.query(
      `select eudr_deforestation_free from plots where tenant_id = '${B}' and id = 'pB'`,
    );
    expect(after).toEqual(before); // B's EUDR declaration untouched
  });
});
