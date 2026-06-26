import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PosTerminal, SellableSku } from "@/app/(app)/pos/data";

// router.refresh is a no-op in jsdom.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// The register's ONLY write path is the Server Action — stub it so the island test
// never touches Supabase, and assert the exact server-bound payload (lines + the
// client-minted idempotency key + the offline device coordinate).
const { recordMock } = vi.hoisted(() => ({ recordMock: vi.fn() }));
vi.mock("@/app/(app)/pos/actions", () => ({
  recordPosSaleAction: recordMock,
}));

import { PosRegister } from "@/app/(app)/pos/pos-register.client";

const TERMINALS: PosTerminal[] = [
  { id: 1, code: "FARM-STORE", name: "Janson Farm Store", location: "Volcán", isActive: true },
];

const SKUS: SellableSku[] = [
  {
    skuId: 10,
    productName: "Geisha Natural",
    productSlug: "geisha-natural",
    greenLotCode: "JC-204",
    packFormat: "whole-bean",
    bagSize: "250g",
    priceUsdCents: 1800,
    isReserveClub: true,
    availableUnits: 3,
  },
  {
    skuId: 11,
    productName: "Caturra Washed",
    productSlug: "caturra-washed",
    greenLotCode: "JC-310",
    packFormat: "ground",
    bagSize: "340g",
    priceUsdCents: 1200,
    isReserveClub: false,
    availableUnits: 0,
  },
];

beforeEach(() => {
  recordMock.mockReset();
  recordMock.mockResolvedValue({ ok: true, saleNo: "POS-0001" });
  try {
    window.localStorage.clear();
  } catch {
    /* jsdom always has it; guard anyway */
  }
});
afterEach(cleanup);

describe("PosRegister (interactive)", () => {
  it("renders a touch tile per sellable SKU with its price", () => {
    render(<PosRegister terminals={TERMINALS} skus={SKUS} />);
    expect(screen.getByTestId("pos-tile-10")).toBeInTheDocument();
    expect(within(screen.getByTestId("pos-tile-10")).getByText("$18.00")).toBeInTheDocument();
  });

  it("disables a sold-out tile (UI mirror of the fail-closed finished_goods guard)", () => {
    render(<PosRegister terminals={TERMINALS} skus={SKUS} />);
    const soldOut = within(screen.getByTestId("pos-tile-11")).getByRole("button");
    expect(soldOut).toBeDisabled();
  });

  it("builds a cart and computes the ITBMS-inclusive total preview", () => {
    render(<PosRegister terminals={TERMINALS} skus={SKUS} />);
    fireEvent.click(within(screen.getByTestId("pos-tile-10")).getByRole("button"));
    fireEvent.click(within(screen.getByTestId("pos-tile-10")).getByRole("button"));
    // two 250g Geisha @ $18.00 = $36.00 subtotal, ITBMS 7% = $2.52, total $38.52.
    const cart = screen.getByTestId("pos-cart");
    expect(within(cart).getByTestId("pos-subtotal")).toHaveTextContent("$36.00");
    expect(within(cart).getByTestId("pos-tax")).toHaveTextContent("$2.52");
    expect(within(cart).getByTestId("pos-total")).toHaveTextContent("$38.52");
  });

  it("charges the sale through the Server Action with server-bound lines + an idempotency key", async () => {
    render(<PosRegister terminals={TERMINALS} skus={SKUS} />);
    fireEvent.click(within(screen.getByTestId("pos-tile-10")).getByRole("button"));
    fireEvent.click(screen.getByTestId("pos-charge"));

    await screen.findByText("Sale POS-0001 recorded.");

    expect(recordMock).toHaveBeenCalledTimes(1);
    const payload = recordMock.mock.calls[0][0];
    expect(payload.terminalCode).toBe("FARM-STORE");
    expect(payload.lines).toEqual([{ skuId: 10, qtyUnits: 1 }]);
    // Client supplies NO total — the server computes it (rail: server-computed totals).
    expect(payload).not.toHaveProperty("totalCents");
    // Exactly-once anchors: a client-minted key + the offline (device_id, device_seq).
    expect(typeof payload.idempotencyKey).toBe("string");
    expect(payload.idempotencyKey.length).toBeGreaterThan(0);
    expect(typeof payload.deviceId).toBe("string");
    expect(Number.isInteger(payload.deviceSeq)).toBe(true);
  });

  it("surfaces the friendly error and does not clear the cart on a rejected sale", async () => {
    recordMock.mockResolvedValue({ ok: false, error: "finished-goods oversell guard" });
    render(<PosRegister terminals={TERMINALS} skus={SKUS} />);
    fireEvent.click(within(screen.getByTestId("pos-tile-10")).getByRole("button"));
    fireEvent.click(screen.getByTestId("pos-charge"));

    expect(await screen.findByRole("alert")).toHaveTextContent("finished-goods oversell guard");
    // cart kept so the cashier can retry
    expect(within(screen.getByTestId("pos-cart")).getByTestId("pos-total")).toBeInTheDocument();
  });
});
