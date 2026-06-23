import { describe, expect, it } from "vitest";

import {
  methodLabelEs,
  statusLabelEs,
  usd,
} from "@/components/sections/pay-period/labels";

describe("statusLabelEs", () => {
  it("maps each known status to its es-PA label", () => {
    expect(statusLabelEs("approved")).toBe("aprobado");
    expect(statusLabelEs("paid")).toBe("pagado");
    expect(statusLabelEs("calculated")).toBe("calculado");
    expect(statusLabelEs("open")).toBe("abierto");
  });

  it("falls back to the raw status when unknown", () => {
    expect(statusLabelEs("frozen")).toBe("frozen");
  });
});

describe("methodLabelEs", () => {
  it("keeps the brand names for the digital rails", () => {
    expect(methodLabelEs("yappy")).toBe("Yappy");
    expect(methodLabelEs("nequi")).toBe("Nequi");
    expect(methodLabelEs("ach")).toBe("ACH");
  });

  it("is case-insensitive on the method key", () => {
    expect(methodLabelEs("YAPPY")).toBe("Yappy");
    expect(methodLabelEs("Nequi")).toBe("Nequi");
  });

  it('labels the canonical signed-cash rail "cash-signed" as "efectivo firmado"', () => {
    expect(methodLabelEs("cash-signed")).toBe("efectivo firmado");
    expect(methodLabelEs("CASH-SIGNED")).toBe("efectivo firmado");
  });

  it('labels plain cash as "efectivo" (not "firmado")', () => {
    expect(methodLabelEs("cash")).toBe("efectivo");
    expect(methodLabelEs("efectivo")).toBe("efectivo");
  });

  it("falls back to the raw method when unknown", () => {
    expect(methodLabelEs("paypal")).toBe("paypal");
  });
});

describe("usd", () => {
  it("formats whole dollars with two decimal places", () => {
    expect(usd(120)).toBe("$120.00");
  });

  it("formats cents and rounds to two places", () => {
    expect(usd(3.5)).toBe("$3.50");
    expect(usd(0.005)).toBe("$0.01");
  });

  it("formats reversing (negative) ledger rows", () => {
    expect(usd(-12.5)).toBe("-$12.50");
  });
});
