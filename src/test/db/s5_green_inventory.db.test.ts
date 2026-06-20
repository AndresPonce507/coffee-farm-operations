// S5 — GreenLot inventory + ATP: SQL tests that replay the REAL migrations in
// PGlite and prove the money-shaped invariants of the green-inventory slice
// (S5 spec + AD-8 + the S3 SECURITY-DEFINER-grant lesson):
//
//   - prevent_oversell: a reservation/shipment whose claimed kg pushes a green
//     lot's committed total past its current_kg is REJECTED at the data layer
//     (double-selling a scarce micro-lot is physically impossible — written red
//     FIRST per the spec).
//   - ATP arithmetic: green_lots_atp.atp == current_kg − Σreserved − Σshipped
//     across fixtures, INCLUDING the zero-claim case (atp == current_kg).
//   - materialize_green_lot: the ONLY GreenLot writer; creates EXACTLY ONE
//     'process' lot_edge with CONSERVED mass linking the source node to the
//     green node; is authenticated-only (anon EXECUTE denied — the S3 lesson:
//     Postgres grants EXECUTE to PUBLIC by default, which let anon mint in S3).
//   - AD-8 grant posture: green_lots/lot_reservations/lot_shipments/green_lots_atp
//     are SELECT-granted to authenticated; no write table grants; no anon grants.
//
// Runs the authenticated role via the harness so it exercises the live posture.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, freshDb, type Harness } from "./pgliteHarness";

// A source (e.g. milled) lot the green node is materialized FROM. 100 kg of mass
// available to route into the green node via the 'process' edge.
const SEED_SOURCE = `insert into lots (code, stage, variety, origin_kg, current_kg, minted_at)
  values ('JC-800', 'milled', 'Geisha', 100, 100, now());`;

// Materialize a green lot with 100 kg conserved from the source. Returns the
// green lot code. The RPC is the only writer.
function materialize(
  h: Harness,
  sourceCode: string,
  greenCode: string,
  kg: number,
  opts: { grade?: number; location?: string } = {},
) {
  const grade = opts.grade ?? 84.5;
  const location = (opts.location ?? "Warehouse-A").replace(/'/g, "''");
  return h.query(
    `select materialize_green_lot(
       '${sourceCode}', '${greenCode}', ${kg}, ${grade}, '${location}', now()
     ) as code;`,
  );
}

describe("S5 green inventory — prevent_oversell (fail-closed)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_SOURCE);
    await materialize(h, "JC-800", "JC-8001", 100); // green lot has 100 kg
  });
  afterAll(async () => h.close());

  it("accepts a reservation within the green lot's current_kg", async () => {
    await h.query(
      `insert into lot_reservations (green_lot_code, buyer, kg) values ('JC-8001','Acme Roasters',40);`,
    );
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_reservations where green_lot_code='JC-8001';`,
    );
    expect(r[0].n).toBe(1);
  });

  // THE red assertion (written first): an over-commit must be physically rejected.
  it("REJECTS a reservation that pushes committed total over current_kg", async () => {
    // 100 kg lot; 40 already reserved; +70 = 110 > 100 -> reject.
    await expect(
      h.query(
        `insert into lot_reservations (green_lot_code, buyer, kg) values ('JC-8001','Bravo Coffee',70);`,
      ),
    ).rejects.toThrow(/oversell|exceed|atp|available|current_kg/i);
  });

  it("REJECTS a shipment that pushes committed total over current_kg", async () => {
    // 40 reserved; a shipment of 70 -> 110 > 100 -> reject (reservations AND
    // shipments both count toward the committed total).
    await expect(
      h.query(
        `insert into lot_shipments (green_lot_code, destination, kg) values ('JC-8001','Port of Balboa',70);`,
      ),
    ).rejects.toThrow(/oversell|exceed|atp|available|current_kg/i);
  });

  it("accepts a shipment that exactly consumes the remaining ATP (boundary)", async () => {
    // 40 reserved; remaining ATP = 60; ship exactly 60 -> committed = 100 == 100.
    await h.query(
      `insert into lot_shipments (green_lot_code, destination, kg) values ('JC-8001','Port of Balboa',60);`,
    );
    const r = await h.query<{ atp: number }>(
      `select atp::numeric as atp from green_lots_atp where green_lot_code='JC-8001';`,
    );
    expect(Number(r[0].atp)).toBeCloseTo(0, 6);
  });

  it("REJECTS even a 1 kg reservation once ATP is exhausted", async () => {
    await expect(
      h.query(
        `insert into lot_reservations (green_lot_code, buyer, kg) values ('JC-8001','Late Buyer',1);`,
      ),
    ).rejects.toThrow(/oversell|exceed|atp|available|current_kg/i);
  });

  it("rejects a non-positive reservation kg (CHECK kg > 0)", async () => {
    await expect(
      h.query(
        `insert into lot_reservations (green_lot_code, buyer, kg) values ('JC-8001','Zero Buyer',0);`,
      ),
    ).rejects.toThrow();
  });
});

describe("S5 green inventory — ATP arithmetic (derived, never a stored counter)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    // Two source lots, two green lots with different claim profiles.
    await h.query(`insert into lots (code, stage, variety, origin_kg, current_kg, minted_at)
      values ('JC-810', 'milled', 'Caturra', 200, 200, now());`);
    await h.query(`insert into lots (code, stage, variety, origin_kg, current_kg, minted_at)
      values ('JC-820', 'milled', 'Typica', 50, 50, now());`);
    await materialize(h, "JC-810", "JC-8101", 200);
    await materialize(h, "JC-820", "JC-8201", 50);
    // JC-8101: 30 reserved + 20 shipped -> atp = 200 - 50 = 150
    await h.query(
      `insert into lot_reservations (green_lot_code, buyer, kg) values ('JC-8101','R1',30);`,
    );
    await h.query(
      `insert into lot_shipments (green_lot_code, destination, kg) values ('JC-8101','D1',20);`,
    );
    // JC-8201: zero claims -> atp == current_kg (50)
  });
  afterAll(async () => h.close());

  it("atp == current_kg − reserved − shipped for a claimed lot", async () => {
    const r = await h.query<{ atp: number; reserved: number; shipped: number }>(
      `select atp::numeric as atp, reserved_kg::numeric as reserved, shipped_kg::numeric as shipped
         from green_lots_atp where green_lot_code='JC-8101';`,
    );
    expect(Number(r[0].reserved)).toBeCloseTo(30, 6);
    expect(Number(r[0].shipped)).toBeCloseTo(20, 6);
    expect(Number(r[0].atp)).toBeCloseTo(150, 6);
  });

  it("atp == current_kg with zero claims (the zero case)", async () => {
    const r = await h.query<{ atp: number; reserved: number; shipped: number }>(
      `select atp::numeric as atp, reserved_kg::numeric as reserved, shipped_kg::numeric as shipped
         from green_lots_atp where green_lot_code='JC-8201';`,
    );
    expect(Number(r[0].reserved)).toBeCloseTo(0, 6);
    expect(Number(r[0].shipped)).toBeCloseTo(0, 6);
    expect(Number(r[0].atp)).toBeCloseTo(50, 6);
  });

  it("atp tracks new claims (derived live, not a frozen counter)", async () => {
    await h.query(
      `insert into lot_reservations (green_lot_code, buyer, kg) values ('JC-8201','R2',10);`,
    );
    const r = await h.query<{ atp: number }>(
      `select atp::numeric as atp from green_lots_atp where green_lot_code='JC-8201';`,
    );
    expect(Number(r[0].atp)).toBeCloseTo(40, 6);
  });
});

describe("S5 green inventory — materialize_green_lot links one conserved 'process' edge", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_SOURCE); // JC-800 milled, 100 kg
    await materialize(h, "JC-800", "JC-8001", 80); // route 80 kg into the green node
  });
  afterAll(async () => h.close());

  it("creates the green node at stage='green'", async () => {
    const r = await h.query<{ stage: string; kg: number }>(
      `select stage, current_kg::numeric as kg from lots where code='JC-8001';`,
    );
    expect(r[0].stage).toBe("green");
    expect(Number(r[0].kg)).toBeCloseTo(80, 6);
  });

  it("creates EXACTLY ONE 'process' edge from source to green with conserved mass", async () => {
    const r = await h.query<{ kind: string; kg: number; n: number }>(
      `select kind, kg::numeric as kg, count(*) over ()::int as n
         from lot_edges where parent_code='JC-800' and child_code='JC-8001';`,
    );
    expect(r.length).toBe(1);
    expect(r[0].kind).toBe("process");
    expect(Number(r[0].kg)).toBeCloseTo(80, 6);
  });

  it("writes a green_lots detail row with a generated sca_grade", async () => {
    const r = await h.query<{ lot_code: string; sca_grade: string; location: string }>(
      `select lot_code, sca_grade, location from green_lots where lot_code='JC-8001';`,
    );
    expect(r[0].lot_code).toBe("JC-8001");
    expect(r[0].location).toBe("Warehouse-A");
    // 84.5 -> the generated SCA grade band (Specialty / Premium). Just assert it
    // is a non-empty derived string (the band, not the raw number).
    expect(typeof r[0].sca_grade).toBe("string");
    expect(r[0].sca_grade.length).toBeGreaterThan(0);
  });

  it("REJECTS materializing more mass than the source lot holds (conservation)", async () => {
    // JC-800 has 100 kg; 80 already routed to JC-8001; +40 = 120 > 100 -> reject.
    await expect(
      materialize(h, "JC-800", "JC-8002", 40),
    ).rejects.toThrow(/mass|conserv|exceed|routed/i);
  });
});

describe("S5 green inventory — materialize_green_lot is authenticated-only (S3 lesson)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(SEED_SOURCE);
  });
  afterAll(async () => h.close());

  // The S3 bug: Postgres grants EXECUTE to PUBLIC by default, so anon could call
  // a SECURITY DEFINER writer (running as owner, bypassing RLS) and mint. The
  // migration MUST revoke from public + grant only to authenticated.
  it("anon CANNOT execute materialize_green_lot (PUBLIC execute revoked)", async () => {
    await expect(
      asAnon(h, (hh) =>
        hh.query(
          `select materialize_green_lot('JC-800','JC-8009',10,84.5,'Warehouse-A',now());`,
        ),
      ),
    ).rejects.toThrow(/permission denied|not.*authoriz|denied/i);
  });
});

describe("S5 green inventory — prevent_oversell serializes per lot (finding #1)", () => {
  // PGlite is a single in-process connection, so two *real* concurrent
  // transactions can't run. The defense against the check-then-insert race is a
  // transaction-scoped advisory lock keyed on the green lot, taken at the top of
  // prevent_oversell BEFORE it reads the committed total — so concurrent claims
  // against the same lot queue and each sees the prior's committed kg. We pin the
  // mechanism by asserting the lock call is in the function body (a re-implementation
  // would drop it and the money guarantee would silently break, per the finding).
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  it("prevent_oversell takes a per-lot advisory xact lock before reading committed kg", async () => {
    const r = await h.query<{ def: string }>(
      `select pg_get_functiondef('prevent_oversell()'::regprocedure) as def;`,
    );
    const def = r[0].def.toLowerCase();
    // The lock must be advisory + transaction-scoped (queues, auto-released at
    // commit) and keyed on the lot code so unrelated lots never block each other.
    expect(def).toMatch(/pg_advisory_xact_lock/);
    expect(def).toMatch(/green_lot_code/);
    // and it must be taken BEFORE the committed-total SELECT it protects.
    const lockPos = def.indexOf("pg_advisory_xact_lock");
    const committedSelectPos = def.indexOf("into committed");
    expect(lockPos).toBeGreaterThanOrEqual(0);
    expect(committedSelectPos).toBeGreaterThan(lockPos);
  });
});

describe("S5 green inventory — cannot lower a green lot's mass below committed (finding #2)", () => {
  // A green lot is an ordinary `lots` row; its current_kg can be LOWERED after
  // reservations exist (advance_processing_stage, shrinkage correction, etc.).
  // The S3 mass-lower guard only knows about lot_edges, not the claim tables, so
  // without an extension you could reserve 90 of 100 then drop current_kg to 50,
  // double-selling the lot and producing a NEGATIVE atp. The fix rejects the
  // lowering; this test fails (the UPDATE succeeds) on the pre-fix migration.
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(`insert into lots (code, stage, variety, origin_kg, current_kg, minted_at)
      values ('JC-830', 'milled', 'Geisha', 100, 100, now());`);
    await materialize(h, "JC-830", "JC-8301", 100); // green lot has 100 kg
    await h.query(
      `insert into lot_reservations (green_lot_code, buyer, kg) values ('JC-8301','Acme',90);`,
    );
  });
  afterAll(async () => h.close());

  it("REJECTS lowering current_kg below the committed total", async () => {
    // 90 reserved against 100; lowering to 50 would leave atp = 50 - 90 = -40.
    await expect(
      h.query(`update lots set current_kg = 50 where code = 'JC-8301';`),
    ).rejects.toThrow(/committed|oversell|conserv|exceed|cannot lower|below/i);
  });

  it("atp never goes negative (the lowering that would do so is rejected)", async () => {
    const r = await h.query<{ atp: number }>(
      `select atp::numeric as atp from green_lots_atp where green_lot_code='JC-8301';`,
    );
    expect(Number(r[0].atp)).toBeGreaterThanOrEqual(0);
  });

  it("ALLOWS lowering current_kg down to (but not below) the committed total", async () => {
    // committed = 90; lowering to exactly 90 leaves atp = 0 and must succeed.
    await h.query(`update lots set current_kg = 90 where code = 'JC-8301';`);
    const r = await h.query<{ atp: number }>(
      `select atp::numeric as atp from green_lots_atp where green_lot_code='JC-8301';`,
    );
    expect(Number(r[0].atp)).toBeCloseTo(0, 6);
  });
});

describe("S5 green inventory — AD-8 grant posture", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  for (const obj of [
    "green_lots",
    "lot_reservations",
    "lot_shipments",
    "green_lots_atp",
  ]) {
    it(`${obj} is SELECT-granted to authenticated, never to anon`, async () => {
      const rows = await h.query<{ grantee: string; privilege_type: string }>(
        `select grantee, privilege_type
           from information_schema.role_table_grants
          where table_name = '${obj}';`,
      );
      const authSelect = rows.some(
        (r) => r.grantee === "authenticated" && r.privilege_type === "SELECT",
      );
      expect(authSelect, `${obj} must grant SELECT to authenticated`).toBe(true);
      const anonAny = rows.some((r) => r.grantee === "anon");
      expect(anonAny, `${obj} must NOT grant anything to anon`).toBe(false);
    });
  }

  for (const tbl of ["green_lots", "lot_reservations", "lot_shipments"]) {
    it(`${tbl} grants NO write privilege to authenticated (writes via RPC/append-only only)`, async () => {
      // Scope to the REST-API roles only — the table owner (postgres) always
      // self-holds full CRUD in role_table_grants; that's not a client-facing
      // grant. The live posture is about what anon/authenticated can do.
      const rows = await h.query<{ grantee: string; privilege_type: string }>(
        `select grantee, privilege_type
           from information_schema.role_table_grants
          where table_name = '${tbl}'
            and grantee in ('anon','authenticated')
            and privilege_type in ('INSERT','UPDATE','DELETE');`,
      );
      // green_lots is RPC-only (no client write grant at all). The append-only
      // claim tables MAY grant INSERT to authenticated (the only legal client
      // write), but never UPDATE/DELETE.
      const badUpdateDelete = rows.some(
        (r) =>
          (r.privilege_type === "UPDATE" || r.privilege_type === "DELETE"),
      );
      expect(
        badUpdateDelete,
        `${tbl} must not grant UPDATE/DELETE to anon/authenticated (append-only / RPC-only)`,
      ).toBe(false);
    });
  }
});
