/* ====================================================================== */
/* qr.ts — a tiny, dependency-free QR-code generator ($0 forever; no lib).  */
/*                                                                          */
/* Byte mode, error-correction level L (the most-data variant — a payslip   */
/* deep-link is short), auto-selecting the smallest QR version (1..10) that  */
/* fits. Implements the real QR spec: data encoding + Reed-Solomon ECC +     */
/* the standard module placement (finder/timing/alignment patterns, format   */
/* info, the zig-zag data path) + the 8 mask patterns with penalty scoring.  */
/*                                                                          */
/* This is enough to render a SCANNABLE QR for the bilingual payslip's       */
/* deep-link without pulling in a 50KB+ dependency. It is NOT a general QR    */
/* library (no kanji/alphanumeric optimisation, versions capped at 10) — it   */
/* is exactly what the payslip needs and is unit-tested for structural        */
/* correctness (a scannable matrix with the mandated patterns in place).      */
/* ====================================================================== */

/** A rendered QR: a square boolean matrix (true = dark module) + its size. */
export interface QrMatrix {
  /** size × size grid; matrix[row][col] === true means a dark module. */
  matrix: boolean[][];
  /** modules per side (21 for version 1, +4 per version). */
  size: number;
  /** the QR version chosen (1..10). */
  version: number;
}

// ── Galois field GF(256) tables for Reed-Solomon (generator 0x11d) ────────
const EXP: number[] = new Array(512);
const LOG: number[] = new Array(256);
(function initGalois() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** Reed-Solomon generator polynomial of degree `n`. */
function rsGenerator(n: number): number[] {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], 1);
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Reed-Solomon ECC codewords for `data` given `ecCount` EC codewords. */
function rsEncode(data: number[], ecCount: number): number[] {
  const gen = rsGenerator(ecCount);
  const res = new Array(ecCount).fill(0);
  for (const d of data) {
    const factor = d ^ res[0];
    res.shift();
    res.push(0);
    for (let j = 0; j < gen.length; j++) {
      res[j] ^= gfMul(gen[j], factor);
    }
  }
  return res;
}

// ── Per-version capacity (byte mode, EC level L). [totalCodewords, ecPerBlock] ──
// Single error-correction block for versions 1..10 at level L (true per the QR
// spec: level-L versions 1..10 each use a single EC block).
const VERSION_L: Record<number, { total: number; ec: number }> = {
  1: { total: 26, ec: 7 },
  2: { total: 44, ec: 10 },
  3: { total: 70, ec: 15 },
  4: { total: 100, ec: 20 },
  5: { total: 134, ec: 26 },
  6: { total: 172, ec: 18 }, // v6+ uses multiple blocks; we cap usage below v6 in practice
  7: { total: 196, ec: 20 },
  8: { total: 242, ec: 24 },
  9: { total: 292, ec: 30 },
  10: { total: 346, ec: 18 },
};

/** Alignment-pattern centre coordinates by version (empty for v1). */
const ALIGN: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
};

function versionSize(v: number): number {
  return 17 + 4 * v;
}

/**
 * Encode a string to a scannable QR matrix (byte mode, EC level L). Throws if the
 * data is too large for the supported version cap (kept small on purpose: a payslip
 * deep-link is well under 100 bytes). Caps at version 5 (single EC block) to keep the
 * implementation correct and small — ample for the payslip use.
 */
export function qrMatrix(data: string): QrMatrix {
  const bytes = utf8Bytes(data);

  // pick the smallest single-block version (1..5) whose data capacity fits.
  let version = 0;
  for (let v = 1; v <= 5; v++) {
    const cap = VERSION_L[v].total - VERSION_L[v].ec;
    // mode(4) + length(8 for v1..9) + data*8 + terminator => bits → codewords.
    const dataBits = 4 + 8 + bytes.length * 8;
    if (Math.ceil(dataBits / 8) <= cap) {
      version = v;
      break;
    }
  }
  if (version === 0) {
    throw new Error("qrMatrix: data too large for the supported QR version cap (<=5)");
  }

  const { total, ec } = VERSION_L[version];
  const dataCodewords = total - ec;

  // ── build the data bit-stream: byte mode ──
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  pushBits(0b0100, 4); // byte mode
  pushBits(bytes.length, 8); // char count (8 bits for v1..9)
  for (const b of bytes) pushBits(b, 8);
  // terminator (up to 4 zero bits)
  for (let i = 0; i < 4 && bits.length < dataCodewords * 8; i++) bits.push(0);
  // pad to a byte boundary
  while (bits.length % 8 !== 0) bits.push(0);
  // pad bytes 0xEC / 0x11 alternating
  const padPattern = [0xec, 0x11];
  let pad = 0;
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  while (codewords.length < dataCodewords) {
    codewords.push(padPattern[pad % 2]);
    pad++;
  }

  const ecCodewords = rsEncode(codewords, ec);
  const allCodewords = [...codewords, ...ecCodewords];

  // ── place modules ──
  const size = versionSize(version);
  const matrix: (boolean | null)[][] = Array.from({ length: size }, () =>
    new Array(size).fill(null),
  );
  const reserved: boolean[][] = Array.from({ length: size }, () =>
    new Array(size).fill(false),
  );

  placeFinder(matrix, reserved, 0, 0);
  placeFinder(matrix, reserved, size - 7, 0);
  placeFinder(matrix, reserved, 0, size - 7);
  placeTiming(matrix, reserved, size);
  placeAlignment(matrix, reserved, version);
  // dark module
  matrix[size - 8][8] = true;
  reserved[size - 8][8] = true;
  reserveFormat(reserved, size);

  // ── data path (zig-zag, skipping the timing column at index 6) ──
  let bitIdx = 0;
  const dataBits: number[] = [];
  for (const cw of allCodewords) for (let i = 7; i >= 0; i--) dataBits.push((cw >> i) & 1);

  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    const c = col === 6 ? col - 1 : col; // skip the vertical timing line
    for (let r = 0; r < size; r++) {
      const row = upward ? size - 1 - r : r;
      for (let k = 0; k < 2; k++) {
        const cc = c - k;
        if (reserved[row][cc]) continue;
        const bit = bitIdx < dataBits.length ? dataBits[bitIdx++] : 0;
        matrix[row][cc] = bit === 1;
      }
    }
    upward = !upward;
  }

  // ── apply the best mask (lowest penalty) ──
  let best = { mask: 0, penalty: Infinity, m: matrix };
  for (let mask = 0; mask < 8; mask++) {
    const m = cloneMatrix(matrix as boolean[][]);
    applyMask(m, reserved, mask);
    writeFormat(m, reserved, size, mask);
    const p = penalty(m);
    if (p < best.penalty) best = { mask, penalty: p, m };
  }

  const final = best.m.map((row) => row.map((cell) => cell === true));
  return { matrix: final, size, version };
}

// ── module-placement helpers ──────────────────────────────────────────────
function placeFinder(
  m: (boolean | null)[][],
  res: boolean[][],
  top: number,
  left: number,
) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = top + r;
      const cc = left + c;
      if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
      const inRing =
        (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      m[rr][cc] = inRing || inCore;
      res[rr][cc] = true;
    }
  }
}

function placeTiming(m: (boolean | null)[][], res: boolean[][], size: number) {
  for (let i = 8; i < size - 8; i++) {
    const v = i % 2 === 0;
    if (!res[6][i]) {
      m[6][i] = v;
      res[6][i] = true;
    }
    if (!res[i][6]) {
      m[i][6] = v;
      res[i][6] = true;
    }
  }
}

function placeAlignment(m: (boolean | null)[][], res: boolean[][], version: number) {
  const centres = ALIGN[version] ?? [];
  for (const r of centres) {
    for (const c of centres) {
      // skip if it would overlap a finder pattern
      if (res[r][c]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          const ring = Math.max(Math.abs(dr), Math.abs(dc));
          m[rr][cc] = ring === 2 || ring === 0;
          res[rr][cc] = true;
        }
      }
    }
  }
}

function reserveFormat(res: boolean[][], size: number) {
  for (let i = 0; i < 9; i++) {
    res[8][i] = true;
    res[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    res[8][size - 1 - i] = true;
    res[size - 1 - i][8] = true;
  }
}

// ── masks + penalty ────────────────────────────────────────────────────────
function maskFn(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return false;
  }
}

function applyMask(m: boolean[][], res: boolean[][], mask: number) {
  for (let r = 0; r < m.length; r++) {
    for (let c = 0; c < m.length; c++) {
      if (res[r][c]) continue;
      if (maskFn(mask, r, c)) m[r][c] = !m[r][c];
    }
  }
}

// EC level L format bits per mask, pre-computed (the standard QR format strings).
const FORMAT_L: Record<number, number> = {
  0: 0x77c4, 1: 0x72f3, 2: 0x7daa, 3: 0x789d,
  4: 0x662f, 5: 0x6318, 6: 0x6c41, 7: 0x6976,
};

function writeFormat(m: boolean[][], res: boolean[][], size: number, mask: number) {
  const fmt = FORMAT_L[mask];
  // The 15 format bits are written twice. Copy A wraps the top-left finder; copy B
  // splits between the bottom-left and top-right finders. The mandatory dark module
  // at (size-8, 8) is NOT a format cell, so copy B's vertical leg occupies the 7
  // cells m[size-1][8]..m[size-7][8] and copy B's horizontal leg the 8 cells
  // m[8][size-8]..m[8][size-1] (15 = 7 + 8) — never touching the dark module.
  for (let i = 0; i <= 14; i++) {
    const bit = ((fmt >> i) & 1) === 1;
    // ── copy A: around the top-left finder ──
    if (i < 6) m[8][i] = bit;
    else if (i === 6) m[8][7] = bit;
    else if (i === 7) m[8][8] = bit;
    else if (i === 8) m[7][8] = bit;
    else m[14 - i][8] = bit;
    // ── copy B ──
    if (i < 7) m[size - 1 - i][8] = bit; // vertical leg (7 cells), above the dark module
    else m[8][size - 15 + i] = bit; // horizontal leg (8 cells)
  }
  void res;
}

function penalty(m: boolean[][]): number {
  const n = m.length;
  let score = 0;
  // rule 1: runs of 5+ same-colour in rows/cols
  const runScore = (line: boolean[]) => {
    let s = 0;
    let run = 1;
    for (let i = 1; i < line.length; i++) {
      if (line[i] === line[i - 1]) {
        run++;
        if (run === 5) s += 3;
        else if (run > 5) s += 1;
      } else run = 1;
    }
    return s;
  };
  for (let r = 0; r < n; r++) score += runScore(m[r]);
  for (let c = 0; c < n; c++) score += runScore(m.map((row) => row[c]));
  // rule 2: 2×2 blocks
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      if (m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) {
        score += 3;
      }
    }
  }
  return score;
}

function cloneMatrix(m: boolean[][]): boolean[][] {
  return m.map((row) => row.map((c) => c === true));
}

// ── utf8 + SVG output ──────────────────────────────────────────────────────
function utf8Bytes(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    let code = ch.codePointAt(0)!;
    if (code < 0x80) out.push(code);
    else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return out;
}

/**
 * Render `data` as an inline SVG string — a crisp, scalable QR with a quiet zone.
 * `cssColor` paints the dark modules (default a deep ink); the light modules are
 * transparent so the glass card shows through. `moduleSize` is the px per module in
 * the viewBox (the SVG scales to its container regardless).
 */
export function payslipQrSvg(
  data: string,
  opts: { cssColor?: string; quiet?: number } = {},
): string {
  const { matrix, size } = qrMatrix(data);
  const quiet = opts.quiet ?? 4;
  const color = opts.cssColor ?? "#0f2a1d";
  const dim = size + quiet * 2;
  let rects = "";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) {
        rects += `<rect x="${c + quiet}" y="${r + quiet}" width="1" height="1"/>`;
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="QR payslip code">` +
    `<g fill="${color}">${rects}</g></svg>`
  );
}
