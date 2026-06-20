/** Tiny class-name joiner (no external deps). */
export function cn(...inputs: Array<string | false | null | undefined>): string {
  return inputs.filter(Boolean).join(" ");
}

/** Format a number with thousands separators, no decimals by default. */
export function num(value: number, decimals = 0): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Kilograms, e.g. 1240 -> "1,240 kg". */
export function kg(value: number): string {
  return `${num(value)} kg`;
}

/** US dollars, e.g. 1850 -> "$1,850". */
export function usd(value: number, decimals = 0): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Percent from a 0–100 number, e.g. 82 -> "82%". */
export function pct(value: number): string {
  return `${Math.round(value)}%`;
}

/** ISO date -> "Jun 18" style short label. */
export function shortDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** ISO date -> "Jun 18, 2026". */
export function longDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Relative day label from an ISO date vs a fixed "today" used across the mock data. */
export function relativeDay(iso: string, today = "2026-06-20"): string {
  const a = new Date(iso + "T00:00:00").getTime();
  const b = new Date(today + "T00:00:00").getTime();
  const days = Math.round((a - b) / 86_400_000);
  if (days === 0) return "Today";
  if (days === -1) return "Yesterday";
  if (days === 1) return "Tomorrow";
  if (days < 0) return `${Math.abs(days)}d ago`;
  return `in ${days}d`;
}

/** Initials from a person's name, e.g. "Miguel Janson" -> "MJ". */
export function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
