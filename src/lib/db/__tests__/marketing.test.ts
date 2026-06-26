import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CampaignBoardRow,
  DeliveryLogRow,
  MarketingAudienceRow,
  MarketingCampaignRow,
} from "@/lib/db/marketing";

/**
 * Coverage of the `marketing.ts` READ-port (P3-S20 — lifecycle marketing). The
 * pure mappers (snake_case view/table row → camelCase domain, numeric coercion of
 * the queued/sent tallies PostgREST may serialize as strings, NULL passthrough for
 * an optional lot / subject / sent_at) and the `cache()`-wrapped getters:
 *
 *   - `getMarketingAudience()` reads `v_marketing_audience` (the CONSENT-GATED audience — the
 *                              builder reads ONLY this view; a non-consenting / unsubscribed
 *                              contact is physically absent).
 *   - `getCampaignBoard()`     reads `v_campaign_board`     (campaigns + trigger + status + tallies).
 *   - `getCampaign(id)`        reads `marketing_campaigns`  (one campaign; null when absent).
 *   - `getDeliveryLog()`       reads `v_delivery_log`       (the live delivery log).
 *
 * Strategy mirrors `pricing.test.ts`: mock `@/lib/supabase/server` so `getSupabase()`
 * returns a chainable, thenable query-builder. Consent enforcement is the DB's job
 * (the CHECK + the before-insert guard, pinned by the migration's PGlite tests); this
 * port only proves the row→domain seam survives `cache()` and hits the right view —
 * crucially that the audience reads the consent-filtered VIEW, never the raw table.
 */

// ----- chainable, per-table Supabase query-builder stub ---------------------

interface QueryResult<T> {
  data: T;
  error: { message: string } | null;
}

type TableResults = Record<string, QueryResult<unknown>>;

function makeClient(results: TableResults) {
  const fromCalls: string[] = [];
  const client = {
    from: (table: string) => {
      fromCalls.push(table);
      const result = results[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {
        select: vi.fn(() => builder),
        order: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        then: (
          onFulfilled: (value: QueryResult<unknown>) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => Promise.resolve(result).then(onFulfilled, onRejected),
      };
      return builder;
    },
  };
  return { client, fromCalls };
}

const getSupabaseMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getSupabase: () => getSupabaseMock(),
}));

beforeEach(() => {
  getSupabaseMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

// ----- sample rows ----------------------------------------------------------

const audienceRow: MarketingAudienceRow = {
  contact_id: 4,
  name: "Onyx Coffee Lab",
  kind: "roaster",
  country_code: "US",
  preferred_channel: "email",
  consent_source: "trade-show-2026",
  consent_at: "2026-05-01T10:00:00Z",
};

const boardRow: CampaignBoardRow = {
  campaign_id: 7,
  name: "Lot launch — JC-701",
  trigger_kind: "lot-launch",
  green_lot_code: "JC-701",
  status: "queued",
  created_at: "2026-06-20T10:00:00Z",
  updated_at: "2026-06-20T11:00:00Z",
  queued_total: "14",
  sent_total: "0",
};

const manualBoardRow: CampaignBoardRow = {
  campaign_id: 8,
  name: "Spring newsletter",
  trigger_kind: "manual",
  green_lot_code: null, // a lot-less manual campaign is legal
  status: "draft",
  created_at: "2026-06-20T10:00:00Z",
  updated_at: "2026-06-20T10:00:00Z",
  queued_total: "0",
  sent_total: "0",
};

const campaignRow: MarketingCampaignRow = {
  id: 7,
  name: "Lot launch — JC-701",
  trigger_kind: "lot-launch",
  green_lot_code: "JC-701",
  subject: "New release: {{lot_code}} ({{sca_grade}})",
  body_template: "Fresh from Janson — lot {{lot_code}}, cup {{cup_score}}.",
  status: "queued",
  created_at: "2026-06-20T10:00:00Z",
  updated_at: "2026-06-20T11:00:00Z",
};

const deliveryRow: DeliveryLogRow = {
  outbound_id: 21,
  campaign_id: 7,
  campaign_name: "Lot launch — JC-701",
  contact_id: 4,
  contact_name: "Onyx Coffee Lab",
  channel: "email",
  status: "sent",
  sent_at: "2026-06-21T09:00:00Z",
  created_at: "2026-06-20T12:00:00Z",
};

// ----- pure mapper: mapMarketingAudienceContact -----------------------------

describe("mapMarketingAudienceContact", () => {
  it("maps a v_marketing_audience row to a camelCase contact", async () => {
    const { mapMarketingAudienceContact } = await import("@/lib/db/marketing");
    expect(mapMarketingAudienceContact(audienceRow)).toEqual({
      contactId: 4,
      name: "Onyx Coffee Lab",
      kind: "roaster",
      countryCode: "US",
      preferredChannel: "email",
      consentSource: "trade-show-2026",
      consentAt: "2026-05-01T10:00:00Z",
    });
  });

  it("passes null country/channel/consent fields through unchanged", async () => {
    const { mapMarketingAudienceContact } = await import("@/lib/db/marketing");
    const c = mapMarketingAudienceContact({
      ...audienceRow,
      country_code: null,
      preferred_channel: null,
      consent_source: null,
      consent_at: null,
    });
    expect(c.countryCode).toBeNull();
    expect(c.preferredChannel).toBeNull();
    expect(c.consentSource).toBeNull();
    expect(c.consentAt).toBeNull();
  });
});

// ----- pure mapper: mapCampaignBoardEntry -----------------------------------

describe("mapCampaignBoardEntry", () => {
  it("maps a v_campaign_board row, coercing the queued/sent tallies", async () => {
    const { mapCampaignBoardEntry } = await import("@/lib/db/marketing");
    expect(mapCampaignBoardEntry(boardRow)).toEqual({
      campaignId: 7,
      name: "Lot launch — JC-701",
      triggerKind: "lot-launch",
      greenLotCode: "JC-701",
      status: "queued",
      createdAt: "2026-06-20T10:00:00Z",
      updatedAt: "2026-06-20T11:00:00Z",
      queuedTotal: 14,
      sentTotal: 0,
    });
  });

  it("passes a null green_lot_code through (a lot-less manual campaign)", async () => {
    const { mapCampaignBoardEntry } = await import("@/lib/db/marketing");
    const e = mapCampaignBoardEntry(manualBoardRow);
    expect(e.greenLotCode).toBeNull();
    expect(e.triggerKind).toBe("manual");
  });
});

// ----- pure mapper: mapMarketingCampaign ------------------------------------

describe("mapMarketingCampaign", () => {
  it("maps a marketing_campaigns row to a camelCase campaign", async () => {
    const { mapMarketingCampaign } = await import("@/lib/db/marketing");
    expect(mapMarketingCampaign(campaignRow)).toEqual({
      id: 7,
      name: "Lot launch — JC-701",
      triggerKind: "lot-launch",
      greenLotCode: "JC-701",
      subject: "New release: {{lot_code}} ({{sca_grade}})",
      bodyTemplate: "Fresh from Janson — lot {{lot_code}}, cup {{cup_score}}.",
      status: "queued",
      createdAt: "2026-06-20T10:00:00Z",
      updatedAt: "2026-06-20T11:00:00Z",
    });
  });

  it("passes null subject/body through (a freshly auto-drafted shell)", async () => {
    const { mapMarketingCampaign } = await import("@/lib/db/marketing");
    const c = mapMarketingCampaign({
      ...campaignRow,
      subject: null,
      body_template: null,
      green_lot_code: null,
    });
    expect(c.subject).toBeNull();
    expect(c.bodyTemplate).toBeNull();
    expect(c.greenLotCode).toBeNull();
  });
});

// ----- pure mapper: mapDeliveryLogEntry -------------------------------------

describe("mapDeliveryLogEntry", () => {
  it("maps a v_delivery_log row to a camelCase entry", async () => {
    const { mapDeliveryLogEntry } = await import("@/lib/db/marketing");
    expect(mapDeliveryLogEntry(deliveryRow)).toEqual({
      outboundId: 21,
      campaignId: 7,
      campaignName: "Lot launch — JC-701",
      contactId: 4,
      contactName: "Onyx Coffee Lab",
      channel: "email",
      status: "sent",
      sentAt: "2026-06-21T09:00:00Z",
      createdAt: "2026-06-20T12:00:00Z",
    });
  });

  it("preserves a NULL sent_at for a still-queued row", async () => {
    const { mapDeliveryLogEntry } = await import("@/lib/db/marketing");
    const e = mapDeliveryLogEntry({
      ...deliveryRow,
      status: "queued",
      sent_at: null,
    });
    expect(e.sentAt).toBeNull();
    expect(e.status).toBe("queued");
  });
});

// ----- getter: getMarketingAudience -----------------------------------------

describe("getMarketingAudience", () => {
  it("reads the CONSENT-GATED v_marketing_audience view (never the raw contacts table)", async () => {
    const { client, fromCalls } = makeClient({
      v_marketing_audience: { data: [audienceRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getMarketingAudience } = await import("@/lib/db/marketing");
    const rows = await getMarketingAudience();

    expect(fromCalls).toContain("v_marketing_audience");
    expect(fromCalls).not.toContain("contacts");
    expect(rows).toHaveLength(1);
    expect(rows[0].contactId).toBe(4);
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_marketing_audience: { data: null, error: { message: "aud boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getMarketingAudience } = await import("@/lib/db/marketing");
    await expect(getMarketingAudience()).rejects.toThrow(
      "getMarketingAudience: aud boom",
    );
  });
});

// ----- getter: getCampaignBoard ---------------------------------------------

describe("getCampaignBoard", () => {
  it("reads v_campaign_board and returns camelCase entries", async () => {
    const { client, fromCalls } = makeClient({
      v_campaign_board: { data: [boardRow, manualBoardRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getCampaignBoard } = await import("@/lib/db/marketing");
    const rows = await getCampaignBoard();

    expect(fromCalls).toContain("v_campaign_board");
    expect(rows).toHaveLength(2);
    expect(rows[0].queuedTotal).toBe(14);
    expect(rows[1].greenLotCode).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_campaign_board: { data: null, error: { message: "board boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getCampaignBoard } = await import("@/lib/db/marketing");
    await expect(getCampaignBoard()).rejects.toThrow(
      "getCampaignBoard: board boom",
    );
  });
});

// ----- getter: getCampaign --------------------------------------------------

describe("getCampaign", () => {
  it("reads marketing_campaigns for one id and returns the single campaign", async () => {
    const { client, fromCalls } = makeClient({
      marketing_campaigns: { data: [campaignRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getCampaign } = await import("@/lib/db/marketing");
    const c = await getCampaign(7);

    expect(fromCalls).toContain("marketing_campaigns");
    expect(c).not.toBeNull();
    expect(c?.id).toBe(7);
    expect(c?.triggerKind).toBe("lot-launch");
  });

  it("returns null when the campaign id has no row", async () => {
    const { client } = makeClient({
      marketing_campaigns: { data: [], error: null },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getCampaign } = await import("@/lib/db/marketing");
    expect(await getCampaign(999)).toBeNull();
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      marketing_campaigns: { data: null, error: { message: "camp boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getCampaign } = await import("@/lib/db/marketing");
    await expect(getCampaign(7)).rejects.toThrow("getCampaign: camp boom");
  });
});

// ----- getter: getDeliveryLog -----------------------------------------------

describe("getDeliveryLog", () => {
  it("reads v_delivery_log and returns camelCase entries", async () => {
    const { client, fromCalls } = makeClient({
      v_delivery_log: { data: [deliveryRow], error: null },
    });
    getSupabaseMock.mockReturnValue(client);

    const { getDeliveryLog } = await import("@/lib/db/marketing");
    const rows = await getDeliveryLog();

    expect(fromCalls).toContain("v_delivery_log");
    expect(rows[0].outboundId).toBe(21);
    expect(rows[0].status).toBe("sent");
  });

  it("throws a labelled error when the query fails", async () => {
    const { client } = makeClient({
      v_delivery_log: { data: null, error: { message: "log boom" } },
    });
    getSupabaseMock.mockReturnValue(client);
    const { getDeliveryLog } = await import("@/lib/db/marketing");
    await expect(getDeliveryLog()).rejects.toThrow(
      "getDeliveryLog: log boom",
    );
  });
});
