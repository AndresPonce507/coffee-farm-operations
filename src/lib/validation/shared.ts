/** Shared, pure validation helpers used by every domain's form validator. */

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: Record<string, string> };

export const trimmed = (v: unknown): string =>
  typeof v === "string" ? v.trim() : "";

export const isISODate = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Coerce a form value to a finite number, or null if it isn't one. */
export const toNumber = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.trim()) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

export function formToRecord(formData: FormData): Record<string, unknown> {
  return Object.fromEntries(formData.entries());
}
