import { describe, expect, it } from "vitest";

import { payslipQrSvg, qrMatrix } from "@/lib/payroll/qr";

describe("qrMatrix — structural correctness", () => {
  it("produces a square matrix of the version's module size", () => {
    const { matrix, size, version } = qrMatrix("janson://payslip/pp-1/w-06");
    expect(version).toBeGreaterThanOrEqual(1);
    expect(matrix.length).toBe(size);
    expect(matrix.every((row) => row.length === size)).toBe(true);
    // version 1 = 21 modules; size grows by 4 per version.
    expect(size).toBe(17 + 4 * version);
  });

  it("places the three finder patterns (7×7 dark ring) at the corners", () => {
    const { matrix, size } = qrMatrix("hello");
    // a finder's outer ring corner module is dark; its (1,1) inner ring is light.
    const finderTopLeftDark = matrix[0][0] && matrix[6][0] && matrix[0][6] && matrix[6][6];
    expect(finderTopLeftDark).toBe(true);
    expect(matrix[1][1]).toBe(false); // the light ring inside the finder
    // top-right + bottom-left finders too.
    expect(matrix[0][size - 1]).toBe(true);
    expect(matrix[size - 1][0]).toBe(true);
  });

  it("lays the timing patterns (alternating dark/light on row/col 6)", () => {
    const { matrix, size } = qrMatrix("timing-check");
    // between the finders, row 6 / col 6 alternate; index 8 is even → dark.
    expect(matrix[6][8]).toBe(true);
    expect(matrix[6][9]).toBe(false);
    expect(matrix[8][6]).toBe(true);
    void size;
  });

  it("sets the mandatory dark module", () => {
    const { matrix, size } = qrMatrix("dark-module");
    expect(matrix[size - 8][8]).toBe(true);
  });

  it("grows the version as the payload grows", () => {
    const small = qrMatrix("x").version;
    const big = qrMatrix("x".repeat(60)).version;
    expect(big).toBeGreaterThan(small);
  });

  it("throws when the payload exceeds the supported version cap", () => {
    expect(() => qrMatrix("x".repeat(200))).toThrow(/too large/);
  });

  it("is deterministic — the same input yields the same matrix", () => {
    const a = qrMatrix("janson://payslip/pp-1/w-06");
    const b = qrMatrix("janson://payslip/pp-1/w-06");
    expect(a.matrix).toEqual(b.matrix);
  });
});

describe("payslipQrSvg — SVG output", () => {
  it("renders a valid svg with a viewBox sized to the QR + quiet zone", () => {
    const svg = payslipQrSvg("janson://payslip/pp-1/w-06");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("viewBox=");
    expect(svg).toContain("<rect"); // at least some dark modules
    expect(svg).toContain('role="img"');
    expect(svg).toContain("</svg>");
  });

  it("honours a custom dark-module colour", () => {
    const svg = payslipQrSvg("color-test", { cssColor: "#00291D" });
    expect(svg).toContain("#00291D");
  });

  it("encodes utf-8 multibyte content (ngäbere/é) without throwing", () => {
    expect(() => payslipQrSvg("Lucía · köbö")).not.toThrow();
  });
});
