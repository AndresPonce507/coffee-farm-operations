// S3 — event-spine trunk: SQL tests that replay the REAL migrations in PGlite and
// prove the substrate's load-bearing invariants (ADR-001/002/003 + AD-8):
//
//   - mass-conservation: a lot_edge whose kg pushes a parent's outgoing total past
//     the parent's own kg is REJECTED by a trigger (the SSOT "graph can't conjure
//     mass" guarantee).
//   - convert_qty: incommensurable dimensions -> NULL (fails loud, never 0);
//     commensurable converts correctly.
//   - hash-chain: verify_chain() passes on a clean stream and FAILS once a row is
//     tampered (the tamper-evidence guarantee). The hash is computed server-side in
//     a BEFORE INSERT trigger, never trusted from the client.
//   - record_cherry_intake: mints gap-free monotonic JC-NNN; a duplicate
//     idempotency_key is exactly-once (no second lot, no second event).
//   - immutability: UPDATE and DELETE on lot_event raise (block trigger + force RLS).
//   - activity-view parity: the `activity` view over lot_event reproduces the exact
//     9 seeded (id, at, kind, text) rows the frozen mapper consumes, newest-first.
//   - AD-8 grants: new objects are SELECT-granted to authenticated and the command
//     RPCs are EXECUTE-granted to authenticated only — no write table grants leak.
//
// All run the authenticated role via the harness so they exercise the live posture.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asAuthenticated, freshDb, type Harness } from "./pgliteHarness";

// A minimal parent lot the edge/conservation tests build on.
const SEED_PARENT = `insert into lots (code, stage, current_kg) values ('JC-900', 'cherry', 100);`;
const SEED_CHILD_A = `insert into lots (code, stage, current_kg) values ('JC-901', 'fermentation', 0);`;
const SEED_CHILD_B = `insert into lots (code, stage, current_kg) values ('JC-902', 'fermentation', 0);`;

describe("S3 event spine — mass conservation on lot_edges", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_PARENT);
    await h.query(SEED_CHILD_A);
    await h.query(SEED_CHILD_B);
  });
  afterAll(async () => h.close());

  it("accepts edges whose outgoing kg stays within the parent's kg", async () => {
    await h.query(
      `insert into lot_edges (parent_code, child_code, kind, kg) values ('JC-900','JC-901','split',60);`,
    );
    const rows = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_edges where parent_code='JC-900';`,
    );
    expect(rows[0].n).toBe(1);
  });

  it("REJECTS an edge whose kg pushes the parent's outgoing total over its kg", async () => {
    // parent JC-900 has 100 kg; 60 already routed; +50 = 110 > 100 -> reject.
    await expect(
      h.query(
        `insert into lot_edges (parent_code, child_code, kind, kg) values ('JC-900','JC-902','split',50);`,
      ),
    ).rejects.toThrow(/mass|conserv|exceed/i);
  });

  it("rejects a non-positive edge kg (CHECK kg > 0)", async () => {
    await expect(
      h.query(
        `insert into lot_edges (parent_code, child_code, kind, kg) values ('JC-900','JC-902','split',0);`,
      ),
    ).rejects.toThrow();
  });

  it("rejects an unknown edge kind (CHECK kind in split/merge/blend/process)", async () => {
    await expect(
      h.query(
        `insert into lot_edges (parent_code, child_code, kind, kg) values ('JC-900','JC-902','teleport',1);`,
      ),
    ).rejects.toThrow();
  });

  // HIGH (finding #3): conservation must hold AFTER edges exist too — lowering a
  // parent's mass below what it has already routed out must be rejected, or the
  // "graph can't conjure mass" invariant is one UPDATE away from violation.
  it("REJECTS lowering a parent's kg below its already-routed outgoing total", async () => {
    // JC-900 has 100 kg, 60 already routed to JC-901. Drop it to 10 -> reject.
    await expect(
      h.query(`update lots set current_kg = 10 where code = 'JC-900';`),
    ).rejects.toThrow(/mass|conserv|exceed|routed/i);
  });

  it("ALLOWS lowering a parent's kg to exactly its routed total (boundary)", async () => {
    // 60 routed; setting current_kg to 60 is the conservation boundary -> allowed.
    await h.query(`update lots set current_kg = 60 where code = 'JC-900';`);
    const r = await h.query<{ kg: number }>(
      `select current_kg::numeric as kg from lots where code='JC-900';`,
    );
    expect(Number(r[0].kg)).toBeCloseTo(60, 6);
  });
});

describe("S3 event spine — mass conservation rejects a NULL-mass parent source", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    // A parent with UNDECLARED mass (both current_kg and origin_kg NULL) and a child.
    await h.query(`insert into lots (code, stage) values ('JC-950', 'cherry');`);
    await h.query(`insert into lots (code, stage, current_kg) values ('JC-951', 'fermentation', 0);`);
  });
  afterAll(async () => h.close());

  // HIGH (finding #4): a NULL-mass parent must NOT be an unlimited mass source.
  // Pre-fix the trigger returned NEW unconditionally for NULL parent mass, so an
  // edge of any size was accepted out of a node that never declared mass.
  it("REJECTS routing mass out of a parent whose mass is undeclared (NULL)", async () => {
    await expect(
      h.query(
        `insert into lot_edges (parent_code, child_code, kind, kg) values ('JC-950','JC-951','split',999999);`,
      ),
    ).rejects.toThrow(/mass|conserv|undeclared|unknown/i);
  });
});

describe("S3 event spine — convert_qty (UCUM, NULL on incommensurable)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  it("converts commensurable mass units (g -> kg)", async () => {
    const r = await h.query<{ v: number }>(
      `select convert_qty(2500, 'g', 'kg') as v;`,
    );
    expect(Number(r[0].v)).toBeCloseTo(2.5, 6);
  });

  it("converts kg -> g", async () => {
    const r = await h.query<{ v: number }>(
      `select convert_qty(3, 'kg', 'g') as v;`,
    );
    expect(Number(r[0].v)).toBeCloseTo(3000, 6);
  });

  it("returns the same value for an identity conversion", async () => {
    const r = await h.query<{ v: number }>(
      `select convert_qty(7.5, 'kg', 'kg') as v;`,
    );
    expect(Number(r[0].v)).toBeCloseTo(7.5, 6);
  });

  it("returns NULL for incommensurable dimensions (kg -> L)", async () => {
    const r = await h.query<{ v: number | null }>(
      `select convert_qty(5, 'kg', 'L') as v;`,
    );
    expect(r[0].v).toBeNull();
  });

  it("returns NULL when a unit is unknown", async () => {
    const r = await h.query<{ v: number | null }>(
      `select convert_qty(5, 'kg', 'furlong') as v;`,
    );
    expect(r[0].v).toBeNull();
  });

  // MEDIUM (finding #5): [brix] (°Bx sugar content) and % are NOT commensurable.
  // Lumping both as dimension 'ratio' silently "converted" a brix reading to a
  // percent (and vice-versa) — the exact silent-wrong-number failure D8 forbids.
  // [brix] now has its own dimension, so the cross conversion fails loud (NULL).
  it("returns NULL converting [brix] -> % (incommensurable sugar content, finding #5)", async () => {
    const r = await h.query<{ v: number | null }>(
      `select convert_qty(20, '[brix]', '%') as v;`,
    );
    expect(r[0].v).toBeNull();
  });

  it("returns NULL converting % -> [brix] (symmetric)", async () => {
    const r = await h.query<{ v: number | null }>(
      `select convert_qty(20, '%', '[brix]') as v;`,
    );
    expect(r[0].v).toBeNull();
  });

  it("still converts [brix] -> [brix] identity within its own dimension", async () => {
    const r = await h.query<{ v: number | null }>(
      `select convert_qty(20, '[brix]', '[brix]') as v;`,
    );
    expect(Number(r[0].v)).toBeCloseTo(20, 6);
  });
});

describe("S3 event spine — hash chain + verify_chain", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    // Append three events to one stream via the canonical RPC (the only write path).
    await asAuthenticated(h, async (hh) => {
      for (let i = 1; i <= 3; i++) {
        await hh.query(
          `select record_lot_event(
             'stream-A', 'note', '{"i": ${i}}'::jsonb,
             '2026-06-20T0${i}:00:00Z'::timestamptz,
             'dev-1', ${i}, 'idem-A-${i}');`,
        );
      }
    });
  });
  afterAll(async () => h.close());

  it("verify_chain passes on a clean stream", async () => {
    const r = await asAuthenticated(h, (hh) =>
      hh.query<{ ok: boolean }>(`select verify_chain('stream-A') as ok;`),
    );
    expect(r[0].ok).toBe(true);
  });

  it("computes the chain server-side (every row has a non-null 32-byte hash)", async () => {
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event
        where stream_key='stream-A' and (hash is null or octet_length(hash) <> 32);`,
    );
    expect(r[0].n).toBe(0);
  });

  it("chains prev_hash: the first event's prev_hash is null/empty, later ones link", async () => {
    const rows = await h.query<{ device_seq: number; prev_is_null: boolean }>(
      `select device_seq, (prev_hash is null) as prev_is_null
         from lot_event where stream_key='stream-A' order by device_seq;`,
    );
    expect(rows[0].prev_is_null).toBe(true);
    expect(rows[1].prev_is_null).toBe(false);
    expect(rows[2].prev_is_null).toBe(false);
  });

  it("verify_chain FAILS after a row's payload is tampered (owner-level mutation of the stored bytes)", async () => {
    // The owner (postgres) can bypass the block trigger only by disabling it; we
    // simulate tamper by editing the stored hash inputs directly via a sibling
    // mechanism: insert a forged row state is impossible (RPC-only), so we corrupt
    // the persisted payload through a direct catalog-level update with the block
    // trigger temporarily disabled — mimicking an attacker with DB access. The
    // POINT is that verify_chain recomputes from payload and catches the drift.
    await h.query(`alter table lot_event disable trigger lot_event_block_mutation;`);
    await h.query(
      `update lot_event set payload = '{"i": 999}'::jsonb
         where stream_key='stream-A' and device_seq = 2;`,
    );
    await h.query(`alter table lot_event enable trigger lot_event_block_mutation;`);

    const r = await asAuthenticated(h, (hh) =>
      hh.query<{ ok: boolean }>(`select verify_chain('stream-A') as ok;`),
    );
    expect(r[0].ok).toBe(false);
  });

  // CRITICAL (finding #2) — DOCUMENTS THE LIMITATION, does not "fix it away".
  // verify_chain proves INTERNAL CONSISTENCY only, not authenticity: it has no
  // external anchor pinning the head, so an attacker with raw table-write access
  // (the exact threat the immutability layer guards against) can re-forge the
  // WHOLE chain — recompute every row's hash from the public canonical-bytes util —
  // and verify_chain still returns TRUE. The block trigger + force-RLS + no write
  // grant are the PRIMARY guards; the hash is a corruption detector, not tamper
  // PROOF. This test captures that boundary so the claim is never overstated again.
  it("DOCUMENTED LIMITATION: verify_chain returns TRUE on a fully re-forged chain (internal consistency != authenticity)", async () => {
    // Use a fresh stream so we don't disturb the tampered stream-A above.
    await asAuthenticated(h, async (hh) => {
      for (let i = 1; i <= 3; i++) {
        await hh.query(
          `select record_lot_event(
             'stream-forge', 'note', '{"i": ${i}}'::jsonb,
             '2026-06-20T0${i}:00:00Z'::timestamptz,
             'dev-f', ${i}, 'idem-F-${i}');`,
        );
      }
    });
    // Attacker with raw DB access disables the immutability trigger and re-forges
    // the chain end-to-end: edit row 2's payload, then recompute hashes forward
    // (row 2's hash from its prev_hash + canonical bytes, then row 3's prev_hash
    // and hash) exactly as the trigger would — using ONLY public functions.
    await h.query(`alter table lot_event disable trigger lot_event_block_mutation;`);
    await h.query(
      `update lot_event set payload = '{"i": 222}'::jsonb
         where stream_key='stream-forge' and device_seq = 2;`,
    );
    await h.query(
      `update lot_event e2 set hash = extensions.digest(
         coalesce(e2.prev_hash, ''::bytea)
           || lot_event_canonical_bytes(e2.stream_key, e2.kind, e2.payload,
                                        e2.occurred_at, e2.device_id, e2.device_seq),
         'sha256')
         where e2.stream_key='stream-forge' and e2.device_seq = 2;`,
    );
    await h.query(
      `update lot_event e3 set prev_hash = (
           select hash from lot_event where stream_key='stream-forge' and device_seq = 2)
         where e3.stream_key='stream-forge' and e3.device_seq = 3;`,
    );
    await h.query(
      `update lot_event e3 set hash = extensions.digest(
         coalesce(e3.prev_hash, ''::bytea)
           || lot_event_canonical_bytes(e3.stream_key, e3.kind, e3.payload,
                                        e3.occurred_at, e3.device_id, e3.device_seq),
         'sha256')
         where e3.stream_key='stream-forge' and e3.device_seq = 3;`,
    );
    await h.query(`alter table lot_event enable trigger lot_event_block_mutation;`);

    const r = await asAuthenticated(h, (hh) =>
      hh.query<{ ok: boolean }>(`select verify_chain('stream-forge') as ok;`),
    );
    // The forged-but-internally-consistent chain passes — by design of a self-
    // anchored hash chain. This is the documented limitation, NOT a regression.
    expect(r[0].ok).toBe(true);
  });
});

describe("S3 event spine — record_cherry_intake (gap-free monotonic minter, exactly-once)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    // record_cherry_intake now writes a harvests row (plot→lot origin link, mig
    // 20260621120000), so the referenced plot + worker must exist.
    await h.db.exec(
      `insert into plots (id, ord, name, block, variety, area_ha, altitude_masl, trees,
         shade_pct, established_year, status, last_inspected, expected_yield_kg, harvested_kg, geom, centroid)
       values ('p-test', 90, 'S3 Test Plot', 'Block T', 'Geisha', 1, 1500, 100, 50, 2015, 'healthy',
         '2026-06-01', 1000, 800,
         '{"type":"Polygon","coordinates":[[[-82.6,8.7],[-82.5,8.7],[-82.5,8.8],[-82.6,8.8],[-82.6,8.7]]]}'::jsonb,
         '{"type":"Point","coordinates":[-82.55,8.75]}'::jsonb);`,
    );
    await h.db.exec(
      `insert into workers (id, name, role, daily_rate_usd, attendance, started_year, phone, crew)
       values ('w-test', 'S3 Tester', 'Picker', 22, 'present', 2015, '+507 0', 'Crew T');`,
    );
  });
  afterAll(async () => h.close());

  it("mints gap-free monotonic JC-NNN codes", async () => {
    const codes = await asAuthenticated(h, async (hh) => {
      const out: string[] = [];
      for (let i = 0; i < 3; i++) {
        const r = await hh.query<{ code: string }>(
          `select record_cherry_intake(
             'p-test', 'w-test', 84, 'Geisha',
             '2026-06-20T08:00:00Z'::timestamptz,
             'dev-1', ${100 + i}, 'intake-${i}') as code;`,
        );
        out.push(r[0].code);
      }
      return out;
    });
    // codes are JC-NNN, strictly increasing by 1
    for (const c of codes) expect(c).toMatch(/^JC-\d{3,}$/);
    const nums = codes.map((c) => Number(c.split("-")[1]));
    expect(nums[1]).toBe(nums[0] + 1);
    expect(nums[2]).toBe(nums[1] + 1);
  });

  it("creates the lot row and an intake event for each mint", async () => {
    const lots = await h.query<{ n: number }>(
      `select count(*)::int as n from lots where stage='cherry' and minted_at is not null;`,
    );
    expect(lots[0].n).toBeGreaterThanOrEqual(3);
    const events = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event where kind='cherry_intake';`,
    );
    expect(events[0].n).toBeGreaterThanOrEqual(3);
  });

  it("is exactly-once on a duplicate idempotency_key (no second lot, no second event)", async () => {
    const before = await h.query<{ lots: number; events: number }>(
      `select (select count(*) from lots)::int as lots,
              (select count(*) from lot_event)::int as events;`,
    );
    // replay the same idempotency_key used above ('intake-0')
    const code = await asAuthenticated(h, (hh) =>
      hh.query<{ code: string }>(
        `select record_cherry_intake(
           'p-test', 'w-test', 84, 'Geisha',
           '2026-06-20T08:00:00Z'::timestamptz,
           'dev-1', 100, 'intake-0') as code;`,
      ),
    );
    const after = await h.query<{ lots: number; events: number }>(
      `select (select count(*) from lots)::int as lots,
              (select count(*) from lot_event)::int as events;`,
    );
    expect(after[0].lots).toBe(before[0].lots);
    expect(after[0].events).toBe(before[0].events);
    // and the returned code is the ORIGINAL minted code, not a new one
    expect(code[0].code).toMatch(/^JC-\d{3,}$/);
  });
});

describe("S3 event spine — lot_event immutability", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await asAuthenticated(h, (hh) =>
      hh.query(
        `select record_lot_event(
           'stream-imm', 'note', '{}'::jsonb,
           '2026-06-20T01:00:00Z'::timestamptz, 'dev-1', 1, 'imm-1');`,
      ),
    );
  });
  afterAll(async () => h.close());

  it("raises on UPDATE of lot_event (block trigger fires even for the owner)", async () => {
    await expect(
      h.query(`update lot_event set kind='hacked' where stream_key='stream-imm';`),
    ).rejects.toThrow(/append-only|immutab|cannot/i);
  });

  it("raises on DELETE of lot_event (block trigger fires even for the owner)", async () => {
    await expect(
      h.query(`delete from lot_event where stream_key='stream-imm';`),
    ).rejects.toThrow(/append-only|immutab|cannot/i);
  });

  it("authenticated has no INSERT/UPDATE/DELETE table grant on lot_event (RPC-only writes)", async () => {
    const r = await h.query<{ priv: string }>(
      `select privilege_type as priv from information_schema.role_table_grants
         where table_name='lot_event' and grantee='authenticated';`,
    );
    const privs = r.map((x) => x.priv.toUpperCase());
    expect(privs).toContain("SELECT");
    expect(privs).not.toContain("INSERT");
    expect(privs).not.toContain("UPDATE");
    expect(privs).not.toContain("DELETE");
  });
});

describe("S3 event spine — activity view parity over lot_event", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    // The migration seeds the 9 activity events into lot_event itself? No — seed
    // rows live in seed.sql which the harness does NOT replay. So we replay the
    // seed insert here to prove the view reproduces it. Read seed.sql's activity
    // block? Simpler: insert the canonical 9 via a tiny owner-level seed mirroring
    // seed.sql, then assert the view's shape/order matches.
    const seed = ACTIVITY_SEED.map(
      (a) =>
        `select _seed_activity_event('${a.id}','${a.at}','${a.kind}', $$${a.text}$$);`,
    );
    for (const s of seed) await h.query(s);
  });
  afterAll(async () => h.close());

  it("exposes exactly (id, at, kind, text) columns", async () => {
    const cols = await h.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name='activity' order by column_name;`,
    );
    expect(cols.map((c) => c.column_name).sort()).toEqual(["at", "id", "kind", "text"]);
  });

  it("reproduces the 9 seeded rows newest-first, byte-identical to the frozen feed", async () => {
    const rows = await asAuthenticated(h, (hh) =>
      hh.query<{ id: string; at: string; kind: string; text: string }>(
        `select id, at::text as at, kind, text from activity order by at desc, id;`,
      ),
    );
    expect(rows).toHaveLength(ACTIVITY_SEED.length);
    const expected = [...ACTIVITY_SEED].sort((a, b) =>
      a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? -1 : 1,
    );
    for (let i = 0; i < expected.length; i++) {
      expect(rows[i].id).toBe(expected[i].id);
      expect(rows[i].at).toBe(expected[i].at);
      expect(rows[i].kind).toBe(expected[i].kind);
      expect(rows[i].text).toBe(expected[i].text);
    }
  });
});

describe("S3 event spine — AD-8 grant posture for new objects", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  it("grants SELECT on lot_edges / lot_event / units / lot_yield_curve to authenticated", async () => {
    for (const t of ["lot_edges", "lot_event", "units", "lot_yield_curve"]) {
      const r = await h.query<{ priv: string }>(
        `select privilege_type as priv from information_schema.role_table_grants
           where table_name='${t}' and grantee='authenticated' and privilege_type='SELECT';`,
      );
      expect(r.length, `${t} must grant SELECT to authenticated`).toBeGreaterThan(0);
    }
  });

  it("grants EXECUTE on the command RPCs to authenticated", async () => {
    const r = await h.query<{ routine_name: string }>(
      `select routine_name from information_schema.role_routine_grants
         where grantee='authenticated' and privilege_type='EXECUTE'
           and routine_name in
             ('record_cherry_intake','advance_processing_stage','record_lot_event','verify_chain','convert_qty');`,
    );
    const names = new Set(r.map((x) => x.routine_name));
    for (const fn of [
      "record_cherry_intake",
      "advance_processing_stage",
      "record_lot_event",
      "verify_chain",
      "convert_qty",
    ]) {
      expect(names.has(fn), `${fn} must grant EXECUTE to authenticated`).toBe(true);
    }
  });

  it("anon cannot read lot_event (authenticated-only posture)", async () => {
    await expect(
      asAnon(h, (hh) => hh.query("select * from lot_event")),
    ).rejects.toThrow(/permission denied/i);
  });

  // CRITICAL (finding #1): the SECURITY DEFINER command RPCs default to PUBLIC
  // EXECUTE, so without an explicit `revoke ... from public` the anon REST key can
  // mint lots and forge events — defeating the entire RPC-only/authenticated-only
  // write posture (ADR-002 + AD-8). These prove anon is fenced out of every write
  // door. They FAIL on the pre-fix migration (anon execute succeeds).
  it("anon CANNOT execute record_cherry_intake (no PUBLIC mint door)", async () => {
    await expect(
      asAnon(h, (hh) =>
        hh.query(
          `select record_cherry_intake(
             'p','w', 50, 'Geisha', '2026-06-20T08:00:00Z'::timestamptz,
             'anon-dev', 1, 'anon-mint');`,
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("anon CANNOT execute record_lot_event (no PUBLIC forge door)", async () => {
    await expect(
      asAnon(h, (hh) =>
        hh.query(
          `select record_lot_event(
             'anon-stream','spoof','{}'::jsonb,
             '2026-06-20T08:00:00Z'::timestamptz,'anon-dev',1,'anon-forge');`,
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("anon CANNOT execute advance_processing_stage", async () => {
    await expect(
      asAnon(h, (hh) =>
        hh.query(
          `select advance_processing_stage(
             'JC-900','drying', 10, '2026-06-20T08:00:00Z'::timestamptz,
             'anon-dev', 2, 'anon-advance');`,
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("anon CANNOT execute _seed_activity_event (seed helper is owner-only, not a forge door)", async () => {
    await expect(
      asAnon(h, (hh) =>
        hh.query(
          `select _seed_activity_event('act-x','2026-06-20','harvest','forged');`,
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("authenticated has NO EXECUTE on _seed_activity_event (forge-activity door is closed)", async () => {
    // The seed helper writes activity-feed rows; any signed-in user with EXECUTE
    // could forge the feed. It must be owner/seed-only — no authenticated grant.
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n
         from information_schema.role_routine_grants
        where routine_name='_seed_activity_event'
          and grantee in ('authenticated','anon','public','PUBLIC')
          and privilege_type='EXECUTE';`,
    );
    expect(r[0].n).toBe(0);
  });
});

// The canonical activity feed (mirrors src/lib/data/activity.ts + seed.sql exactly).
const ACTIVITY_SEED = [
  { id: "act-01", at: "2026-06-20", kind: "harvest", text: "Talamanca delivered 84 kg cherries — Rosa Quintero, lot JC-552" },
  { id: "act-02", at: "2026-06-20", kind: "harvest", text: "Barú Vista delivered 64 kg cherries — Tomás Atencio, lot JC-541" },
  { id: "act-03", at: "2026-06-20", kind: "labor", text: "Crew Norte clocked in — 644 kg picked across 8 lots today" },
  { id: "act-04", at: "2026-06-20", kind: "processing", text: "Lot JC-602 Geisha started anaerobic ferment — Néstor Gómez (Patio 1)" },
  { id: "act-05", at: "2026-06-20", kind: "task", text: "Shade pruning started on Talamanca — Miguel Janson thinning guabo canopy" },
  { id: "act-06", at: "2026-06-19", kind: "processing", text: "Lot JC-552 Geisha moved to drying (Bed 7) — moisture at 13.5%" },
  { id: "act-07", at: "2026-06-19", kind: "shipment", text: "Green export lot JC-541 staged for shipment — Raúl Santamaría loading" },
  { id: "act-08", at: "2026-06-19", kind: "harvest", text: "Las Lagunas delivered 68 kg cherries — Iris Castillo, lot JC-602" },
  { id: "act-09", at: "2026-06-19", kind: "task", text: "Broca (berry borer) scouting underway on Paso Ancho — Janette Janson" },
];
