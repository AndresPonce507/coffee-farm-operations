import { type InputHTMLAttributes } from "react";

/**
 * form-field — the ONE home for the glass input styling (facet-03 §1.2).
 *
 * `FIELD` / `LABEL` are verbatim from the three existing form idioms
 * (start-ferment-form.tsx etc.) hoisted here so every Phase-5 form imports the literal
 * instead of re-declaring it (CLAUDE.md "Contract — don't fork these"). Existing forms
 * are NOT migrated (flag-don't-fix); new slices import these.
 */

/** Glass input: 44px touch target, rounded, line-border, forest focus ring. */
export const FIELD =
  "h-11 w-full rounded-xl border border-line bg-white/70 px-3 text-sm text-ink outline-none transition focus:border-forest-300 focus:ring-2 focus:ring-forest-100";

/** Field label: small, muted. */
export const LABEL = "text-xs font-medium text-muted-fg";

/**
 * FormField — a labelled glass `<input>` with a wired per-field error. The default
 * smart-bar field; a form supplies `label` + `name` and (from `SmartForm`'s
 * `fieldError`) an optional `error`. `aria-invalid` is set only when errored.
 */
export function FormField({
  label,
  name,
  error,
  className,
  ...rest
}: {
  label: string;
  name: string;
  error?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "name">) {
  const id = `field-${name}`;
  const errorId = `${id}-error`;
  return (
    <div className="space-y-1">
      <label className={LABEL} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        name={name}
        className={className ?? FIELD}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...rest}
      />
      {error && (
        <p id={errorId} className="text-xs text-cherry">
          {error}
        </p>
      )}
    </div>
  );
}
