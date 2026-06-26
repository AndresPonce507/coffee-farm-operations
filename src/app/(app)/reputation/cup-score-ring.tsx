import { num } from "@/lib/utils";

/**
 * CupScoreRing — a pure server-SVG progress ring for a 0–100 cup score, with the
 * number in the centre. No client JS, no motion (the only transform is the static
 * -rotate-90 that puts the arc's start at 12 o'clock). A NULL score renders an empty
 * track + an em-dash — never a fabricated 0 arc (rail §5). Accessible: the wrapper is
 * `role="img"` with a spoken label; the SVG is aria-hidden.
 */
export function CupScoreRing({
  score,
  size = 60,
  label,
  emptyLabel,
}: {
  /** The cup score in [0,100], or null when the lot is not cupped. */
  score: number | null;
  size?: number;
  /** Spoken label when a score is present (already interpolated). */
  label: string;
  /** Spoken label when the score is null. */
  emptyLabel: string;
}) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const frac = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const dash = circ * frac;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={score == null ? emptyLabel : label}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-forest/12"
        />
        {score != null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`}
            className="text-forest"
          />
        )}
      </svg>
      <span className="absolute inset-0 grid place-items-center font-display text-sm font-bold tabular-nums text-ink">
        {score == null ? "—" : num(score, 1)}
      </span>
    </div>
  );
}
