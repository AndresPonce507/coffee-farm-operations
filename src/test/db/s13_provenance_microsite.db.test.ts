// P3-S13 — PUBLIC per-lot QR provenance microsite (GS1 Digital Link).
//
// THE SECURITY-CRITICAL SLICE. These tests replay the REAL migrations in PGlite
// (AD-9) and prove the keystone invariant of the entire phase:
//
//   NO PUBLIC PII / COST / OVERSELL / UNPUBLISHED LEAK.
//
// The provenance microsite opens the ONE anon door in all of Phase 3 — a curated,
// published-only projection of a green lot's story. Everything below is written RED
// first (the migration does not yet exist when this file lands):
//
//   (1) PUBLISH + ANON RESOLVE — publish_provenance curates a page; an anonymous
//       caller resolves a PUBLISHED slug to the assembled public JSON (product +
//       cup score + SCA grade + EUDR status + origin plots + anonymized crew label).
//   (2) WHITELIST / NO LEAK — the resolver JSON NEVER contains worker phone, the
//       picker's name, the daily wage, the warehouse location, COGS, or a buyer.
//   (3) UNPUBLISHED / UNKNOWN ⇒ NULL — the curation gate: an unpublished or unknown
//       slug resolves to NULL (nothing public until the owner publishes); unpublish
//       takes it back down.
//   (4) THE ANON-SURFACE STATIC GUARD (the dead-guard-is-an-incident keystone) —
//       anon's table/view SELECT surface == EXACTLY {sku_provenance_public}; anon can
//       EXECUTE resolve_provenance and NOTHING else of this slice's writers; anon
//       CANNOT reach green_lots / provenance_pages / workers / plots / lot_reservations
//       / cost_entry. Any future migration that widens the anon surface fails here.
//   (5) CURATION IS OWNER-ONLY — publish/unpublish are authenticated-only SECDEF RPCs;
//       no client UPDATE/DELETE grant on provenance_pages; tenant-scoped read.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asTenant, freshDb, type Harness } from "./pgliteHarness";

// ──────────────────────────────────────────────────────────────────────────
// Fixture — a fully traceable green lot: source → green edge (via materialize),
// a harvest from a geolocated, EUDR-declared plot, picked by a worker whose PII
// (name, phone, wage) MUST never surface publicly, then a lot-linked retail SKU.
// ──────────────────────────────────────────────────────────────────────────
const SLUG = "janson-geisha-jc901";
const GTIN = "0840012345678";
const PHONE = "+507 6000-9999"; // worker PII — must NEVER appear in public JSON
const PICKER = "Zzpicker Secretname"; // worker name — must NEVER appear publicly
const WAGE = "18.50"; // daily_rate_usd — must NEVER appear publicly
const LOCATION = "WH-VAULT-7"; // green-lot warehouse location — never public

async function seedTraceableSku(h: Harness): Promise<number> {
  // Source milled lot + materialized green lot (materialize creates the lot_edge).
  await h.query(
    `insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
       values ('JC-900', 'milled', 'Geisha', 600, 600, true, now());`,
  );
  await h.query(
    `select materialize_green_lot('JC-900', 'JC-901', 600, 91, '${LOCATION}', now());`,
  );

  // A geolocated plot established pre-cutoff (so 'established-pre-cutoff' is valid).
  await h.query(
    `insert into plots
       (id, ord, name, block, variety, area_ha, altitude_masl, trees, shade_pct,
        established_year, status, last_inspected, expected_yield_kg, harvested_kg,
        geom, centroid)
     values
       ('P1', 1, 'Quetzal Ridge', 'B-1', 'Geisha', 2.5, 1650, 4200, 35,
        2018, 'healthy', now()::date, 800, 600,
        '{"type":"Polygon","coordinates":[[[0,0],[0,1],[1,1],[0,0]]]}'::jsonb,
        '{"type":"Point","coordinates":[-82.5,8.8]}'::jsonb);`,
  );
  // The picker — PII-bearing. None of name/phone/wage may ever reach the public JSON.
  await h.query(
    `insert into workers (id, name, role, daily_rate_usd, attendance, started_year, phone, crew)
       values ('W1', '${PICKER}', 'Picker', ${WAGE}, 'present', 2019, '${PHONE}', 'Crew Quetzal');`,
  );
  // The harvest that fed the source lot (the origin-plot trace anchor).
  await h.query(
    `insert into harvests (id, date, plot_id, worker_id, cherries_kg, ripeness_pct, brix_avg, lot_code)
       values ('H1', now()::date, 'P1', 'W1', 700, 95, 21, 'JC-900');`,
  );
  // Owner declares the plot deforestation-free (pre-cutoff basis) → EUDR compliant.
  await h.query(`select eudr_declare_plot('P1', true, 'established-pre-cutoff');`);

  // The lot-linked retail SKU (the bag the QR lives on).
  const p = await h.query<{ id: number }>(
    `select create_product('janson-geisha', 'Janson Geisha', 'Geisha', 'Washed',
       'jasmine, bergamot, honey', 'prov-prod-1') as id;`,
  );
  const s = await h.query<{ id: number }>(
    `select create_sku(${Number(p[0].id)}, 'JC-901', null, 'whole-bean', '250g',
       4200, '${GTIN}', null, false, 'prov-sku-1') as id;`,
  );
  return Number(s[0].id);
}

// ──────────────────────────────────────────────────────────────────────────
// 1 + 2. PUBLISH → ANON RESOLVE, and the no-leak whitelist.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S13 provenance — publish + anon resolve, no PII/cost leak", () => {
  let h: Harness;
  let skuId: number;
  beforeAll(async () => {
    h = await freshDb();
    skuId = await seedTraceableSku(h);
    await h.query(
      `select publish_provenance(${skuId}, '${SLUG}', '${GTIN}',
         'Grown on Quetzal Ridge at 1650m, hand-picked at peak ripeness.', 'pub-1');`,
    );
  });
  afterAll(async () => h.close());

  it("anon resolves a PUBLISHED slug to assembled public JSON", async () => {
    const r = await asAnon(h, (hh) =>
      hh.query<{ j: Record<string, unknown> }>(
        `select resolve_provenance('${SLUG}') as j;`,
      ),
    );
    const j = r[0].j;
    expect(j).not.toBeNull();
    expect(j.slug).toBe(SLUG);
    expect(j.gtin).toBe(GTIN);
    expect(j.green_lot_code).toBe("JC-901");
    expect(j.product_name).toBe("Janson Geisha");
    expect(j.sca_grade).toBe("Presidential"); // cupping 91 ⇒ Presidential band
    expect(Number(j.cupping_score)).toBe(91);
    expect(j.eudr_status).toBe("compliant"); // geolocated + declared free
  });

  it("the public JSON carries the origin plot AND an anonymized crew label", async () => {
    const r = await asAnon(h, (hh) =>
      hh.query<{ j: Record<string, unknown> }>(
        `select resolve_provenance('${SLUG}') as j;`,
      ),
    );
    const blob = JSON.stringify(r[0].j);
    expect(blob).toContain("Quetzal Ridge"); // origin plot name (public)
    expect(blob).toContain("Crew Quetzal"); // anonymized crew label (public)
  });

  it("NO LEAK — the public JSON never exposes worker PII, wage, location, or cost", async () => {
    const r = await asAnon(h, (hh) =>
      hh.query<{ j: Record<string, unknown> }>(
        `select resolve_provenance('${SLUG}') as j;`,
      ),
    );
    const blob = JSON.stringify(r[0].j);
    expect(blob).not.toContain(PHONE); // worker phone
    expect(blob).not.toContain(PICKER); // worker name
    expect(blob).not.toContain(WAGE); // daily wage
    expect(blob).not.toContain(LOCATION); // warehouse location
    expect(blob.toLowerCase()).not.toContain("cost"); // no COGS key anywhere
  });

  it("anon can read the published row directly from sku_provenance_public", async () => {
    const r = await asAnon(h, (hh) =>
      hh.query<{ slug: string; sca_grade: string }>(
        `select slug, sca_grade from sku_provenance_public where slug = '${SLUG}';`,
      ),
    );
    expect(r).toHaveLength(1);
    expect(r[0].sca_grade).toBe("Presidential");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. THE CURATION GATE — unpublished / unknown ⇒ NULL; unpublish takes it down.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S13 curation gate — nothing public until published", () => {
  let h: Harness;
  let skuId: number;
  beforeAll(async () => {
    h = await freshDb();
    skuId = await seedTraceableSku(h);
  });
  afterAll(async () => h.close());

  it("an UNKNOWN slug resolves to NULL", async () => {
    const r = await asAnon(h, (hh) =>
      hh.query<{ j: unknown }>(`select resolve_provenance('no-such-slug') as j;`),
    );
    expect(r[0].j).toBeNull();
  });

  it("a page that exists but is UNPUBLISHED resolves to NULL", async () => {
    // Publish then immediately unpublish — the row exists, is_published = false.
    await h.query(
      `select publish_provenance(${skuId}, '${SLUG}', '${GTIN}', 'story', 'pub-2');`,
    );
    await h.query(`select unpublish_provenance(${skuId}, 'unpub-1');`);
    const r = await asAnon(h, (hh) =>
      hh.query<{ j: unknown }>(`select resolve_provenance('${SLUG}') as j;`),
    );
    expect(r[0].j).toBeNull();
    // And it has vanished from the public view too.
    const v = await asAnon(h, (hh) =>
      hh.query(`select 1 from sku_provenance_public where slug = '${SLUG}';`),
    );
    expect(v).toHaveLength(0);
  });

  it("re-publishing brings it back", async () => {
    await h.query(
      `select publish_provenance(${skuId}, '${SLUG}', '${GTIN}', 'story', 'pub-3');`,
    );
    const r = await asAnon(h, (hh) =>
      hh.query<{ j: Record<string, unknown> }>(
        `select resolve_provenance('${SLUG}') as j;`,
      ),
    );
    expect(r[0].j).not.toBeNull();
    expect((r[0].j as Record<string, unknown>).slug).toBe(SLUG);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. THE ANON-SURFACE STATIC GUARD — the keystone leak this phase must never ship.
//    anon's table/view SELECT surface == EXACTLY {sku_provenance_public}.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S13 anon-surface guard — exactly one curated door", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  it("anon's ENTIRE table/view SELECT grant set is exactly {sku_provenance_public}", async () => {
    const rows = await h.query<{ table_name: string }>(
      `select distinct table_name
         from information_schema.role_table_grants
        where grantee = 'anon' and privilege_type = 'SELECT'
        order by 1;`,
    );
    const surface = rows.map((r) => r.table_name);
    // This is THE keystone assertion: the one anon door in all of Phase 3.
    expect(surface).toEqual(["sku_provenance_public"]);
  });

  it("anon can EXECUTE resolve_provenance", async () => {
    const r = await h.query<{ ex: boolean }>(
      `select has_function_privilege('anon', 'resolve_provenance(text)', 'execute') as ex;`,
    );
    expect(r[0].ex).toBe(true);
  });

  it("anon canNOT execute the owner curation writers", async () => {
    const pub = await h.query<{ ex: boolean }>(
      `select has_function_privilege('anon',
         'publish_provenance(bigint,text,text,text,text)', 'execute') as ex;`,
    );
    const unp = await h.query<{ ex: boolean }>(
      `select has_function_privilege('anon',
         'unpublish_provenance(bigint,text)', 'execute') as ex;`,
    );
    expect(pub[0].ex).toBe(false);
    expect(unp[0].ex).toBe(false);
  });

  it("anon canNOT read any sensitive source table", async () => {
    for (const t of [
      "provenance_pages",
      "green_lots",
      "workers",
      "plots",
      "lot_reservations",
      "cost_entry",
    ]) {
      await expect(
        asAnon(h, (hh) => hh.query(`select * from ${t};`)),
        `anon must NOT read ${t}`,
      ).rejects.toThrow();
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. CURATION IS OWNER-ONLY — authenticated-only writers, tenant-scoped read,
//    no client UPDATE/DELETE grant on the curation table.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S13 curation — owner-only, no client mutation", () => {
  let h: Harness;
  let skuId: number;
  beforeAll(async () => {
    h = await freshDb();
    skuId = await seedTraceableSku(h);
    await h.query(
      `select publish_provenance(${skuId}, '${SLUG}', '${GTIN}', 'story', 'pub-own');`,
    );
  });
  afterAll(async () => h.close());

  it("authenticated reads provenance_pages; the writers are authenticated-only", async () => {
    const sel = await h.query<{ a: boolean }>(
      `select has_table_privilege('authenticated', 'provenance_pages', 'select') as a;`,
    );
    expect(sel[0].a).toBe(true);
    const ex = await h.query<{ p: boolean; u: boolean }>(
      `select has_function_privilege('authenticated',
                'publish_provenance(bigint,text,text,text,text)', 'execute') as p,
              has_function_privilege('authenticated',
                'unpublish_provenance(bigint,text)', 'execute') as u;`,
    );
    expect(ex[0].p).toBe(true);
    expect(ex[0].u).toBe(true);
  });

  it("authenticated holds NO update/delete grant on provenance_pages", async () => {
    const r = await h.query<{ up: boolean; del: boolean }>(
      `select has_table_privilege('authenticated', 'provenance_pages', 'update') as up,
              has_table_privilege('authenticated', 'provenance_pages', 'delete') as del;`,
    );
    expect(r[0].up).toBe(false);
    expect(r[0].del).toBe(false);
  });

  it("the publish appends a lot_event on the green lot's chain (commercial audit)", async () => {
    const r = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event
        where stream_key = 'JC-901' and kind = 'provenance_published';`,
    );
    expect(Number(r[0].n)).toBeGreaterThanOrEqual(1);
  });
});
