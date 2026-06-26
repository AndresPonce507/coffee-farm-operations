// P3-S19 — Reputation ledger (cup scores / awards / certs bound to a lot). Replays the
// REAL migrations in PGlite (AD-9) and proves the slice's data-layer invariants against
// HAND-COMPUTED seeds — written RED first per the spec (docs/design/PHASE3-DESIGN.md
// lines 403–410 + §1 rails).
//
//   (1) FK + CHECK — an accolade can't claim a non-existent lot; a cup-score MUST carry a
//       score in [0,100] (kind='cup-score'/'score-revision' ⇒ score not null in range).
//   (2) APPEND-ONLY + CORRECTION — lot_accolades is immutable (update/delete throw); a
//       revision is a 'score-revision' REVERSING row (reverses_id), never an edit. The net
//       live view excludes the reversed original and surfaces the revised score.
//   (3) HASH-CHAINED — lot_accolades carries its own per-lot chain ('accolade:<lot>') via
//       the shared event_set_hash; verify_chain('accolade:<lot>') verifies, a tamper flips
//       it false.
//   (4) RECONCILIATION — v_lot_reputation reconciles the best accolade cup score against
//       green_lots.cupping_score / sca_grade (the QC truth); awards/certs aggregated.
//   (5) PUBLIC PROJECTION — v_lot_reputation_public is the NARROW title/score/awarded_by/
//       award_year projection; granted to authenticated only this slice (anon deferred to
//       P3-S13).
//   (6) AD-8 GRANTS / posture — authenticated reads tables+views, holds no write grant;
//       anon reads/executes NOTHING; every RPC's EXECUTE is revoked from public; the
//       internal trigger fns are not granted.
//   (7) TENANT ISOLATION — an accolade in tenant A is invisible to tenant B.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asTenant, freshDb, type Harness } from "./pgliteHarness";

/** Seed a source (milled) lot and materialize a green lot from it (default tenant). */
async function seedGreen(
  h: Harness,
  opts: { source: string; green: string; kg: number; score: number },
) {
  await h.query(
    `insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
       values ('${opts.source}', 'milled', 'Geisha', ${opts.kg}, ${opts.kg}, true, now());`,
  );
  await h.query(
    `select materialize_green_lot('${opts.source}','${opts.green}',${opts.kg},${opts.score},'WH-A', now());`,
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 1. record_accolade — FK + CHECK invariants.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S19 record_accolade — FK + cup-score CHECK", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedGreen(h, { source: "JC-400", green: "JC-404", kg: 100, score: 89.5 });
  });
  afterAll(async () => h.close());

  it("records a cup-score accolade and returns its id", async () => {
    const r = await h.query<{ id: number }>(
      `select record_accolade('JC-404','cup-score','BoP cupping', 88, 'BoP Panama', 2026,
          null, null, 'acc-1') as id;`,
    );
    expect(Number(r[0].id)).toBeGreaterThan(0);
  });

  it("an accolade against a NON-EXISTENT lot is rejected (FK)", async () => {
    await expect(
      h.query(
        `select record_accolade('JC-NOPE','award','Ghost', null, 'Nobody', 2026, null, null, 'acc-ghost');`,
      ),
    ).rejects.toThrow(/unknown lot|foreign key|does not exist/i);
  });

  it("a cup-score with NO score is rejected (a cup-score must carry a score)", async () => {
    await expect(
      h.query(
        `select record_accolade('JC-404','cup-score','No score', null, 'X', 2026, null, null, 'acc-noscore');`,
      ),
    ).rejects.toThrow(/score/i);
  });

  it("a cup-score out of [0,100] is rejected", async () => {
    await expect(
      h.query(
        `select record_accolade('JC-404','cup-score','Too high', 140, 'X', 2026, null, null, 'acc-hi');`,
      ),
    ).rejects.toThrow(/score|check|between|range/i);
  });

  it("an AWARD does not require a score (score may be null)", async () => {
    const r = await h.query<{ id: number }>(
      `select record_accolade('JC-404','award','Cup of Excellence', null, 'CoE', 2026,
          'https://coe.test/medal', null, 'acc-award') as id;`,
    );
    expect(Number(r[0].id)).toBeGreaterThan(0);
  });

  it("record_accolade is idempotent — a replay creates no second row", async () => {
    const a = await h.query<{ id: number }>(
      `select record_accolade('JC-404','certification','Organic', null, 'USDA', 2025,
          null, null, 'acc-cert') as id;`,
    );
    const b = await h.query<{ id: number }>(
      `select record_accolade('JC-404','certification','Organic', null, 'USDA', 2025,
          null, null, 'acc-cert') as id;`,
    );
    expect(Number(a[0].id)).toBe(Number(b[0].id));
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_accolades where idempotency_key like '%acc-cert';`,
    );
    expect(n[0].n).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. revise_accolade — a score-revision reversing row, append-only.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S19 revise_accolade — reversing row, never an edit", () => {
  let h: Harness;
  let original: number;
  beforeAll(async () => {
    h = await freshDb();
    await seedGreen(h, { source: "JC-410", green: "JC-414", kg: 100, score: 90 });
    const r = await h.query<{ id: number }>(
      `select record_accolade('JC-414','cup-score','First cupping', 87.5, 'House', 2026,
          null, null, 'acc-orig') as id;`,
    );
    original = Number(r[0].id);
  });
  afterAll(async () => h.close());

  it("v_lot_reputation best_cup_score is the original (87.5) before any revision", async () => {
    const r = await h.query<{ best: number; qc: number; grade: string }>(
      `select best_cup_score as best, qc_cupping_score as qc, sca_grade as grade
         from v_lot_reputation where lot_code='JC-414';`,
    );
    expect(Number(r[0].best)).toBeCloseTo(87.5, 6);
    expect(Number(r[0].qc)).toBeCloseTo(90, 6); // reconciled against green_lots.cupping_score
    expect(r[0].grade).toBe("Presidential"); // 90 ⇒ Presidential
  });

  it("revise_accolade posts a score-revision that supersedes the original score", async () => {
    await h.query(
      `select revise_accolade(${original}, 89.5, 'recalibrated', 'acc-rev') as id;`,
    );
    const r = await h.query<{ best: number; live: number }>(
      `select best_cup_score as best, accolade_count as live from v_lot_reputation where lot_code='JC-414';`,
    );
    expect(Number(r[0].best)).toBeCloseTo(89.5, 6); // the revised score wins
    // the original is reversed (excluded from live); only the revision counts.
    expect(Number(r[0].live)).toBe(1);
  });

  it("lot_accolades is append-only — UPDATE and DELETE both throw", async () => {
    await expect(
      h.query(`update lot_accolades set score = 99 where lot_code='JC-414';`),
    ).rejects.toThrow(/append-only|not permitted/i);
    await expect(
      h.query(`delete from lot_accolades where lot_code='JC-414';`),
    ).rejects.toThrow(/append-only|not permitted/i);
  });

  it("revise_accolade on an unknown accolade throws", async () => {
    await expect(
      h.query(`select revise_accolade(999999, 90, 'x', 'acc-rev-bad');`),
    ).rejects.toThrow(/unknown accolade|foreign key/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. Hash chain — verify_chain('accolade:<lot>') verifies; a tamper flips it.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S19 lot_accolades hash chain — verify_chain('accolade:<lot>')", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedGreen(h, { source: "JC-420", green: "JC-424", kg: 100, score: 88 });
    await h.query(
      `select record_accolade('JC-424','cup-score','C1', 86, 'House', 2026, null, null, 'acc-c1');`,
    );
    await h.query(
      `select record_accolade('JC-424','award','Best of Panama', null, 'BoP', 2026, null, null, 'acc-c2');`,
    );
  });
  afterAll(async () => h.close());

  it("the accolade chain verifies under event_set_hash", async () => {
    const r = await h.query<{ ok: boolean }>(`select verify_chain('accolade:JC-424') as ok;`);
    expect(r[0].ok).toBe(true);
    // the lot's own provenance chain also gained the appended accolade events.
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event where stream_key='JC-424' and kind like 'accolade%';`,
    );
    expect(n[0].n).toBeGreaterThanOrEqual(2);
  });

  it("a tampered accolade payload makes verify_chain return false", async () => {
    await h.query(`alter table lot_accolades disable trigger lot_accolades_no_update;`);
    await h.query(
      `update lot_accolades set payload = payload || '{"tampered":true}'::jsonb
         where stream_key='accolade:JC-424';`,
    );
    await h.query(`alter table lot_accolades enable trigger lot_accolades_no_update;`);
    const r = await h.query<{ ok: boolean }>(`select verify_chain('accolade:JC-424') as ok;`);
    expect(r[0].ok).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. Reputation views — reconciliation + the narrow public projection.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S19 v_lot_reputation + v_lot_reputation_public", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedGreen(h, { source: "JC-430", green: "JC-434", kg: 100, score: 89.5 });
    await h.query(
      `select record_accolade('JC-434','cup-score','BoP cupping', 89.5, 'BoP', 2026, null, null, 'r-cup');`,
    );
    await h.query(
      `select record_accolade('JC-434','award','BoP #1', null, 'Best of Panama', 2026, null, null, 'r-award');`,
    );
    await h.query(
      `select record_accolade('JC-434','certification','Organic', null, 'USDA', 2025, null, null, 'r-cert');`,
    );
  });
  afterAll(async () => h.close());

  it("v_lot_reputation aggregates awards + certs and reconciles to the QC grade", async () => {
    const r = await h.query<{
      best: number; grade: string; awards: number; certs: number; total: number;
    }>(
      `select best_cup_score as best, sca_grade as grade,
              award_count as awards, cert_count as certs, accolade_count as total
         from v_lot_reputation where lot_code='JC-434';`,
    );
    expect(Number(r[0].best)).toBeCloseTo(89.5, 6);
    expect(r[0].grade).toBe("Specialty"); // 89.5 ⇒ Specialty (85..89.99)
    expect(Number(r[0].awards)).toBe(1);
    expect(Number(r[0].certs)).toBe(1);
    expect(Number(r[0].total)).toBe(3);
  });

  it("v_lot_reputation_public exposes only the narrow projection columns", async () => {
    const rows = await h.query<{ title: string; score: number | null; awarded_by: string }>(
      `select title, score, awarded_by, award_year from v_lot_reputation_public
         where lot_code='JC-434' order by title;`,
    );
    expect(rows.length).toBe(3);
    // the public view holds no internal/PII columns (idempotency_key/device_seq/hash etc.)
    const cols = await h.query<{ c: string }>(
      `select column_name as c from information_schema.columns
         where table_name='v_lot_reputation_public' order by 1;`,
    );
    const names = cols.map((x) => x.c);
    expect(names).not.toContain("idempotency_key");
    expect(names).not.toContain("hash");
    expect(names).not.toContain("device_seq");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. AD-8 grants / posture.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S19 AD-8 grants + posture", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  it("lot_accolades grants NO insert/update/delete (RPC-only write)", async () => {
    const r = await h.query<{ ai: boolean; au: boolean; ad: boolean; ani: boolean }>(
      `select has_table_privilege('authenticated','lot_accolades','insert') as ai,
              has_table_privilege('authenticated','lot_accolades','update') as au,
              has_table_privilege('authenticated','lot_accolades','delete') as ad,
              has_table_privilege('anon','lot_accolades','insert') as ani;`,
    );
    expect(r[0].ai).toBe(false);
    expect(r[0].au).toBe(false);
    expect(r[0].ad).toBe(false);
    expect(r[0].ani).toBe(false);
  });

  it("authenticated reads the table+views; anon reads NONE", async () => {
    for (const t of ["lot_accolades", "v_lot_reputation", "v_lot_reputation_public"]) {
      const r = await h.query<{ a: boolean; an: boolean }>(
        `select has_table_privilege('authenticated','${t}','select') as a,
                has_table_privilege('anon','${t}','select') as an;`,
      );
      expect(r[0].a, `authenticated reads ${t}`).toBe(true);
      expect(r[0].an, `anon must NOT read ${t}`).toBe(false);
    }
  });

  it("every command RPC is executable by authenticated, not anon, not public", async () => {
    const fns = [
      "record_accolade(text, text, text, numeric, text, integer, text, bigint, text)",
      "revise_accolade(bigint, numeric, text, text)",
    ];
    for (const fn of fns) {
      const r = await h.query<{ a: boolean; an: boolean; pub: boolean }>(
        `select has_function_privilege('authenticated','${fn}','execute') as a,
                has_function_privilege('anon','${fn}','execute') as an,
                has_function_privilege('public','${fn}','execute') as pub;`,
      );
      expect(r[0].a, `authenticated executes ${fn}`).toBe(true);
      expect(r[0].an, `anon must NOT execute ${fn}`).toBe(false);
      expect(r[0].pub, `public must NOT execute ${fn}`).toBe(false);
    }
  });

  it("the internal append-only/hash trigger fns are NOT granted to anon/public", async () => {
    const r = await h.query<{ hpub: boolean; ipub: boolean }>(
      `select has_function_privilege('public','_lot_accolade_set_hash()','execute') as hpub,
              has_function_privilege('public','_lot_accolades_immutable()','execute') as ipub;`,
    );
    expect(r[0].hpub).toBe(false);
    expect(r[0].ipub).toBe(false);
  });

  it("anon cannot read lot_accolades through the live role posture", async () => {
    await expect(
      asAnon(h, (hh) => hh.query(`select * from lot_accolades limit 1;`)),
    ).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 6. Tenant isolation — accolades do not leak cross-tenant.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S19 tenant isolation — accolades do not leak cross-tenant", () => {
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(
      `insert into tenants (id, slug, name) values
         ('${A}','tenant-a','Estate A'),('${B}','tenant-b','Estate B');`,
    );
    // tenant A: a lot (authored with A's tenant_id) + an accolade via the write door
    // under A's session (the hash trigger asserts the ledger row's tenant matches the
    // session tenant, so the accolade is minted inside asTenant(A)).
    await h.query(
      `insert into lots (tenant_id, code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
         values ('${A}','JC-901','milled','Geisha',100,100,true, now());`,
    );
    await asTenant(h, A, (hh) =>
      hh.query(
        `select record_accolade('JC-901','cup-score','A cup', 90, 'A', 2026, null, null, 'acc-a1');`,
      ),
    );
  });
  afterAll(async () => h.close());

  it("as tenant A, A's accolade is visible", async () => {
    const rows = await asTenant(h, A, (hh) =>
      hh.query<{ tenant_id: string }>(`select tenant_id from lot_accolades;`),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].tenant_id).toBe(A);
  });

  it("as tenant B, A's accolade is invisible", async () => {
    const rows = await asTenant(h, B, (hh) =>
      hh.query(`select 1 from lot_accolades where tenant_id = '${A}';`),
    );
    expect(rows).toHaveLength(0);
  });
});
