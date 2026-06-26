// P3-S20 — Storage / controlled-environment monitoring + lifecycle marketing (the
// wave's LAST slice). Replays the REAL migrations in PGlite (AD-9) and proves the
// slice's data-layer invariants against HAND-COMPUTED seeds — written RED first per
// the spec (docs/design/PHASE3-DESIGN.md lines 411–430 + §1 rails).
//
//   STORAGE
//   (1) A certificate CANNOT be issued without its evidence: readings_count=0 ⇒
//       issue_storage_certificate RAISES (never a fabricated 'in-band'). With in-spec
//       readings the verdict is 'in-band' and a cert_hash binds the cert to the window;
//       one out-of-band reading flips the verdict to 'excursion'.
//   (2) record_storage_reading is idempotent (a re-synced offline/LoRaWAN uplink never
//       double-counts); storage_readings + storage_certificates are append-only.
//
//   MARKETING
//   (3) CONSENT GATE (the legal promise): queue_campaign_send enqueues ZERO outbound
//       rows for a non-consenting / unsubscribed contact; a direct outbound insert for a
//       non-consenting contact is REJECTED by the before-insert guard; the
//       consent_verified CHECK forbids an unverified row.
//   (4) record_unsubscribe sets unsubscribed_at + withdraws consent → no later campaign
//       can target that row (CAN-SPAM/GDPR as DB enforcement).
//   (5) NO UNTRUSTED INBOUND DRIVES A SEND: queue builds a DRAFT queue; nothing is 'sent'
//       until mark_campaign_sent (the human-confirmed button), which appends a hash-
//       chained 'campaign_sent' lot_event onto the lot's provenance chain.
//   (6) the lot-launch trigger drafts a campaign the moment a green node is minted.
//
//   (7) AD-8 GRANTS / posture — authenticated reads tables+views, holds no write grant;
//       anon reads/executes NOTHING; every RPC's EXECUTE is revoked from public.
//   (8) TENANT ISOLATION — storage + marketing data does not leak cross-tenant.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asTenant, freshDb, type Harness } from "./pgliteHarness";

/** Seed a source (milled) lot + materialize a green lot from it (default tenant). */
async function seedGreen(
  h: Harness,
  opts: { source: string; green: string; kg: number; score: number },
) {
  await h.query(
    `insert into lots (code, stage, variety, origin_kg, current_kg, is_single_origin, minted_at)
       values ('${opts.source}', 'milled', 'Geisha', ${opts.kg}, ${opts.kg}, true, now());`,
  );
  await h.query(
    `select materialize_green_lot('${opts.source}','${opts.green}',${opts.kg},${opts.score},'Bodega A', now());`,
  );
}

/** Create a contact (consenting or not) via the only writer; returns its id. */
async function seedContact(
  h: Harness,
  key: string,
  opts: { consent: boolean; name?: string } = { consent: false },
): Promise<number> {
  const name = opts.name ?? "Onyx Coffee Lab";
  const consent = opts.consent ? "true" : "false";
  const src = opts.consent ? "'web-form'" : "null";
  const r = await h.query<{ id: number }>(
    `select upsert_contact(null, '${name}', 'roaster', 'active', 'US', 'buy@onyx.test',
        null, null, ${consent}, ${src}, '${key}') as id;`,
  );
  return Number(r[0].id);
}

/** Resolve a storage location code -> id (default tenant). */
async function seedLocation(h: Harness, code: string): Promise<number> {
  const r = await h.query<{ id: number }>(
    `select upsert_storage_location('${code}', 'Bodega A', 15, 25, 50, 65, 0.65, 'loc-${code}') as id;`,
  );
  return Number(r[0].id);
}

// ──────────────────────────────────────────────────────────────────────────
// 1. STORAGE certificate — evidence-bound verdict; no evidence ⇒ refuse.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S20 storage certificate — verdict is evidence-bound, never fabricated", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedGreen(h, { source: "JC-500", green: "JC-504", kg: 100, score: 92 });
    await seedLocation(h, "BOD-A");
  });
  afterAll(async () => h.close());

  it("issuing a certificate with ZERO readings in the window RAISES (never 'in-band')", async () => {
    await expect(
      h.query(
        `select issue_storage_certificate('JC-504', 'BOD-A',
            '2026-06-01T00:00:00Z', '2026-06-02T00:00:00Z', 'cert-empty');`,
      ),
    ).rejects.toThrow(/insufficient|no readings|evidence/i);
  });

  it("three in-spec readings ⇒ verdict 'in-band', in_band_pct=100, cert_hash present", async () => {
    for (let i = 0; i < 3; i++) {
      await h.query(
        `select record_storage_reading('BOD-A', 21, 58, 0.61, 'manual', null,
            '2026-06-10T0${i}:00:00Z', 'rd-ok-${i}');`,
      );
    }
    const r = await h.query<{ id: number }>(
      `select issue_storage_certificate('JC-504', 'BOD-A',
          '2026-06-10T00:00:00Z', '2026-06-11T00:00:00Z', 'cert-ok') as id;`,
    );
    const cert = await h.query<{
      verdict: string;
      pct: number;
      cnt: number;
      hash: string | null;
    }>(
      `select verdict, in_band_pct as pct, readings_count as cnt, encode(cert_hash,'hex') as hash
         from storage_certificates where id = ${Number(r[0].id)};`,
    );
    expect(cert[0].verdict).toBe("in-band");
    expect(Number(cert[0].pct)).toBeCloseTo(100, 6);
    expect(Number(cert[0].cnt)).toBe(3);
    expect(cert[0].hash).toBeTruthy();
  });

  it("one out-of-band reading (aw 0.80 > 0.65) flips the verdict to 'excursion'", async () => {
    await h.query(
      `select record_storage_reading('BOD-A', 21, 58, 0.80, 'manual', null,
          '2026-06-20T00:00:00Z', 'rd-bad');`,
    );
    await h.query(
      `select record_storage_reading('BOD-A', 21, 58, 0.61, 'manual', null,
          '2026-06-20T01:00:00Z', 'rd-good2');`,
    );
    const r = await h.query<{ id: number }>(
      `select issue_storage_certificate('JC-504', 'BOD-A',
          '2026-06-20T00:00:00Z', '2026-06-21T00:00:00Z', 'cert-exc') as id;`,
    );
    const cert = await h.query<{ verdict: string; pct: number }>(
      `select verdict, in_band_pct as pct from storage_certificates where id = ${Number(r[0].id)};`,
    );
    expect(cert[0].verdict).toBe("excursion");
    expect(Number(cert[0].pct)).toBeCloseTo(50, 6); // 1 of 2 in band
  });

  it("issuing a certificate appends a 'storage_certified' lot_event (verify_chain holds)", async () => {
    const ev = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event
         where stream_key = 'JC-504' and kind = 'storage_certified';`,
    );
    expect(ev[0].n).toBeGreaterThanOrEqual(1);
    const ok = await h.query<{ ok: boolean }>(`select verify_chain('JC-504') as ok;`);
    expect(ok[0].ok).toBe(true);
  });

  it("record_storage_reading is idempotent; readings + certificates are append-only", async () => {
    await h.query(
      `select record_storage_reading('BOD-A', 21, 58, 0.61, 'manual', null,
          '2026-06-10T00:00:00Z', 'rd-ok-0');`,
    );
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from storage_readings where idempotency_key like '%rd-ok-0';`,
    );
    expect(n[0].n).toBe(1);
    await expect(
      h.query(`update storage_readings set temp_c = 99 where idempotency_key like '%rd-ok-0';`),
    ).rejects.toThrow(/append-only|not permitted/i);
    await expect(
      h.query(`delete from storage_certificates where idempotency_key like '%cert-ok';`),
    ).rejects.toThrow(/append-only|not permitted/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. MARKETING consent gate — the legal promise enforced at the data layer.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S20 consent gate — only consenting contacts can ever be queued", () => {
  let h: Harness;
  let consenting: number;
  let nonConsenting: number;
  let campaign: number;
  beforeAll(async () => {
    h = await freshDb();
    await seedGreen(h, { source: "JC-510", green: "JC-514", kg: 100, score: 92 });
    consenting = await seedContact(h, "c-yes", { consent: true, name: "Onyx Coffee Lab" });
    nonConsenting = await seedContact(h, "c-no", { consent: false, name: "No Consent Co" });
    const c = await h.query<{ id: number }>(
      `select draft_campaign('BoP Geisha launch', 'manual', 'JC-514',
          'Fresh {{lot_code}}', 'Cup {{cup_score}} — {{sca_grade}} — lot {{lot_code}}', 'camp-1') as id;`,
    );
    campaign = Number(c[0].id);
  });
  afterAll(async () => h.close());

  it("queue_campaign_send enqueues ONLY the consenting contact (the non-consenting is skipped)", async () => {
    const q = await h.query<{ n: number }>(
      `select queue_campaign_send(${campaign}, 'q-1')::int as n;`,
    );
    expect(Number(q[0].n)).toBe(1); // exactly one consenting contact
    const rows = await h.query<{ contact_id: number; body: string }>(
      `select contact_id, rendered_body as body from marketing_outbound where campaign_id = ${campaign};`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].contact_id).toBe(consenting);
    // merge tags resolved from the lot's reputation/grade (cup 92 ⇒ Presidential).
    expect(rows[0].body).toMatch(/92/);
    expect(rows[0].body).toMatch(/Presidential/);
    expect(rows[0].body).toMatch(/JC-514/);
    expect(rows[0].body).not.toMatch(/\{\{/); // no unresolved tags
  });

  it("a direct outbound insert for a NON-consenting contact is REJECTED by the guard", async () => {
    await expect(
      h.query(
        `insert into marketing_outbound (campaign_id, contact_id, rendered_body, consent_verified)
           values (${campaign}, ${nonConsenting}, 'hi', true);`,
      ),
    ).rejects.toThrow(/consent|not.*consent|suppress/i);
  });

  it("the consent_verified CHECK forbids storing an unverified outbound row", async () => {
    // a fresh consenting contact (passes the guard) so the CHECK — not the guard or the
    // per-(campaign,contact) unique — is what rejects the consent_verified=false row.
    const fresh = await seedContact(h, "c-check", { consent: true, name: "Check Co" });
    await expect(
      h.query(
        `insert into marketing_outbound (campaign_id, contact_id, rendered_body, consent_verified)
           values (${campaign}, ${fresh}, 'hi', false);`,
      ),
    ).rejects.toThrow(/consent_verified|check/i);
  });

  it("queue_campaign_send is idempotent — a replay enqueues no duplicate per contact", async () => {
    await h.query(`select queue_campaign_send(${campaign}, 'q-1')::int;`);
    const n = await h.query<{ n: number }>(
      `select count(*)::int as n from marketing_outbound
         where campaign_id = ${campaign} and contact_id = ${consenting};`,
    );
    expect(n[0].n).toBe(1); // the already-queued contact gets no second row
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. unsubscribe + the human-confirmed send.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S20 unsubscribe suppression + human-confirmed send", () => {
  let h: Harness;
  let contact: number;
  let campaign: number;
  beforeAll(async () => {
    h = await freshDb();
    await seedGreen(h, { source: "JC-520", green: "JC-524", kg: 100, score: 92 });
    contact = await seedContact(h, "c-unsub", { consent: true });
    const c = await h.query<{ id: number }>(
      `select draft_campaign('Replenish', 'manual', 'JC-524', 'Re: {{lot_code}}',
          'Restock {{lot_code}}', 'camp-2') as id;`,
    );
    campaign = Number(c[0].id);
  });
  afterAll(async () => h.close());

  it("record_unsubscribe stamps unsubscribed_at + withdraws consent + logs the event", async () => {
    await h.query(`select record_unsubscribe(${contact}, 'unsub-1');`);
    const c = await h.query<{ unsub: string | null; consent: boolean }>(
      `select unsubscribed_at as unsub, consent_marketing as consent from contacts where id = ${contact};`,
    );
    expect(c[0].unsub).not.toBeNull();
    expect(c[0].consent).toBe(false);
    const e = await h.query<{ n: number }>(
      `select count(*)::int as n from contact_events
         where contact_id = ${contact} and kind = 'consent_withdrawn';`,
    );
    expect(e[0].n).toBe(1);
  });

  it("after unsubscribe NO campaign can target that contact (zero enqueued)", async () => {
    const q = await h.query<{ n: number }>(
      `select queue_campaign_send(${campaign}, 'q-2')::int as n;`,
    );
    expect(Number(q[0].n)).toBe(0);
  });

  it("nothing is 'sent' until mark_campaign_sent; then a 'campaign_sent' lot_event chains", async () => {
    // re-consent + queue a fresh contact so there is something to send.
    const buyer = await seedContact(h, "c-send", { consent: true, name: "Sender Co" });
    await h.query(`select queue_campaign_send(${campaign}, 'q-3')::int;`);
    const queued = await h.query<{ status: string }>(
      `select status from marketing_outbound where campaign_id = ${campaign} and contact_id = ${buyer};`,
    );
    expect(queued[0].status).toBe("queued"); // a draft queue, not sent
    const sent = await h.query<{ n: number }>(
      `select mark_campaign_sent(${campaign}, 'send-1')::int as n;`,
    );
    expect(Number(sent[0].n)).toBeGreaterThanOrEqual(1);
    const after = await h.query<{ status: string; sent_at: string | null }>(
      `select status, sent_at from marketing_outbound where campaign_id = ${campaign} and contact_id = ${buyer};`,
    );
    expect(after[0].status).toBe("sent");
    expect(after[0].sent_at).not.toBeNull();
    const ev = await h.query<{ n: number }>(
      `select count(*)::int as n from lot_event where stream_key = 'JC-524' and kind = 'campaign_sent';`,
    );
    expect(ev[0].n).toBeGreaterThanOrEqual(1);
    const ok = await h.query<{ ok: boolean }>(`select verify_chain('JC-524') as ok;`);
    expect(ok[0].ok).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. lot-launch trigger — drafts a campaign the moment a green node is minted.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S20 lot-launch trigger — minting a green lot drafts a campaign", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await seedGreen(h, { source: "JC-530", green: "JC-534", kg: 100, score: 89 });
  });
  afterAll(async () => h.close());

  it("a draft lot-launch campaign exists for the freshly minted lot (status 'draft')", async () => {
    const r = await h.query<{ status: string; kind: string }>(
      `select status, trigger_kind as kind from marketing_campaigns
         where green_lot_code = 'JC-534' and trigger_kind = 'lot-launch';`,
    );
    expect(r.length).toBe(1);
    expect(r[0].status).toBe("draft"); // a draft, never auto-sent
  });

  it("the auto-draft carries the merge-tag template (resolved only at queue time)", async () => {
    const r = await h.query<{ body: string }>(
      `select body_template as body from marketing_campaigns
         where green_lot_code = 'JC-534' and trigger_kind = 'lot-launch';`,
    );
    expect(r[0].body).toMatch(/\{\{lot_code\}\}/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. AD-8 grants / posture.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S20 AD-8 grants + posture", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
  });
  afterAll(async () => h.close());

  it("new tables grant NO insert/update/delete to authenticated or anon (RPC-only write)", async () => {
    for (const t of [
      "storage_locations",
      "storage_readings",
      "storage_certificates",
      "marketing_campaigns",
      "marketing_segments",
      "marketing_outbound",
    ]) {
      const r = await h.query<{ ai: boolean; au: boolean; ad: boolean; ani: boolean }>(
        `select has_table_privilege('authenticated','${t}','insert') as ai,
                has_table_privilege('authenticated','${t}','update') as au,
                has_table_privilege('authenticated','${t}','delete') as ad,
                has_table_privilege('anon','${t}','insert') as ani;`,
      );
      expect(r[0].ai, `${t} insert`).toBe(false);
      expect(r[0].au, `${t} update`).toBe(false);
      expect(r[0].ad, `${t} delete`).toBe(false);
      expect(r[0].ani, `${t} anon insert`).toBe(false);
    }
  });

  it("authenticated reads the tables+views; anon reads NONE", async () => {
    for (const t of [
      "storage_locations",
      "storage_readings",
      "storage_certificates",
      "marketing_campaigns",
      "marketing_segments",
      "marketing_outbound",
      "v_storage_status",
      "v_lot_storage_history",
      "v_marketing_audience",
      "v_campaign_board",
      "v_delivery_log",
    ]) {
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
      "upsert_storage_location(text, text, numeric, numeric, numeric, numeric, numeric, text)",
      "record_storage_reading(text, numeric, numeric, numeric, text, text, timestamptz, text)",
      "issue_storage_certificate(text, text, timestamptz, timestamptz, text)",
      "draft_campaign(text, text, text, text, text, text)",
      "queue_campaign_send(bigint, text)",
      "mark_campaign_sent(bigint, text)",
      "record_unsubscribe(bigint, text)",
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

  it("anon cannot read marketing_outbound through the live role posture", async () => {
    await expect(
      asAnon(h, (hh) => hh.query(`select * from marketing_outbound limit 1;`)),
    ).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 6. tenant isolation — storage + marketing do not leak cross-tenant.
// ──────────────────────────────────────────────────────────────────────────
describe("P3-S20 tenant isolation — storage + marketing rows do not leak cross-tenant", () => {
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  let h: Harness;
  beforeAll(async () => {
    h = await freshDb();
    await h.query(
      `insert into tenants (id, slug, name) values
         ('${A}','tenant-a','Estate A'),('${B}','tenant-b','Estate B');`,
    );
    await h.query(
      `insert into storage_locations (tenant_id, code, name) values ('${A}','BOD-A','Bodega A');`,
    );
  });
  afterAll(async () => h.close());

  it("as tenant A, A's storage location is visible", async () => {
    const rows = await asTenant(h, A, (hh) =>
      hh.query<{ tenant_id: string }>(`select tenant_id from storage_locations;`),
    );
    expect(rows.length).toBe(1);
    expect(rows[0].tenant_id).toBe(A);
  });

  it("as tenant B, A's storage location is invisible", async () => {
    const rows = await asTenant(h, B, (hh) =>
      hh.query(`select 1 from storage_locations where tenant_id = '${A}';`),
    );
    expect(rows).toHaveLength(0);
  });
});
