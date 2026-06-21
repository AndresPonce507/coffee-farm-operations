import { MapPin, Mountain } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn, num } from "@/lib/utils";
import type { DispatchCard, RipenessTarget } from "@/lib/types";

import { renderDispatchCardText } from "./dispatch-card-text";
import { bilingual, DISPATCH_TERMS, RIPENESS_LABELS } from "./labels";

/**
 * DispatchCardPreview — the shareable morning-dispatch card, rendered as a
 * world-class glass card AND mirrored as a plain-text region the share island reads.
 *
 * Presentational Server Component (no client JS): it takes a fully-assembled
 * DispatchCard (the read port already sorted the plots in pasada/readiness order)
 * plus the crew's languages (so the copy goes bilingual es · ngäbere when the crew
 * speaks ngäbere) and renders:
 *   • a header (crew + date + "a cosechar hoy"), bilingual when applicable;
 *   • one glass row per plot — name, variety, altitude, ripeness band chip;
 *   • a hidden-but-present `<pre data-testid="dispatch-card-text">` carrying the
 *     exact plain-text the web-share adapter delivers (so the visual card and the
 *     shared text are guaranteed identical — one renderer, two surfaces).
 *
 * Glass discipline: glass-card surface, no blur on content; the ripeness chip
 * conveys state by icon + text + token, never colour alone; AA on the paper canvas;
 * no motion here (the only animation lives on the composer's buttons). Bilingual
 * field-facing copy. The ngäbere strings are PLACEHOLDERS (see ./labels).
 */
export interface DispatchCardPreviewProps {
  card: DispatchCard;
  /** The crew's languages (from the roster) — drives the bilingual rendering. */
  languages?: string[];
  className?: string;
}

const RIPENESS_TONE: Record<RipenessTarget, string> = {
  high: "border-forest/30 bg-forest-100/60 text-forest",
  medium: "border-honey/30 bg-honey-100/60 text-honey-700",
  low: "border-sky/30 bg-sky-100/60 text-sky",
};

export function DispatchCardPreview({
  card,
  languages = [],
  className,
}: DispatchCardPreviewProps) {
  const cardText = renderDispatchCardText(card, { languages });
  const pickToday = bilingual(DISPATCH_TERMS.pickToday, languages, "A cosechar hoy");

  return (
    <article
      className={cn("glass-card rounded-2xl p-5", className)}
      aria-label={`Dispatch card for ${card.crewName}`}
    >
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line/70 pb-4">
        <div>
          <p className="font-display text-lg font-bold tracking-tight text-ink">
            {card.crewName}
          </p>
          <p className="mt-0.5 text-sm text-muted-fg">
            {pickToday} · {card.dispatchDate}
          </p>
        </div>
        <Badge
          tone={card.status === "sent" || card.status === "acknowledged" ? "forest" : "neutral"}
        >
          {card.status}
        </Badge>
      </header>

      {/* Plot lines */}
      {card.plots.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-fg">
          {bilingual(
            DISPATCH_TERMS.noPlots,
            languages,
            "Ninguna parcela lista para hoy",
          )}
        </p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {card.plots.map((p) => {
            const ripeLabel = bilingual(
              RIPENESS_LABELS[p.ripenessTarget],
              languages,
              p.ripenessTarget,
            );
            return (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-line/60 bg-white/55 px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate font-medium text-ink">
                    <MapPin
                      className="h-3.5 w-3.5 shrink-0 text-forest"
                      aria-hidden="true"
                    />
                    {p.plotName}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-fg">
                    <span>{p.variety}</span>
                    <span aria-hidden>·</span>
                    <Mountain className="h-3 w-3" aria-hidden="true" />
                    <span>{num(p.altitudeMasl)} masl</span>
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium",
                    RIPENESS_TONE[p.ripenessTarget],
                  )}
                >
                  {ripeLabel}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* The exact shared text — the SSOT the web-share adapter delivers. Visually
          muted but present + readable (a copyable region), so the visual card and
          the WhatsApp-pasted text can never drift. */}
      <pre
        data-testid="dispatch-card-text"
        className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl border border-line/50 bg-paper/60 p-3 font-sans text-xs leading-relaxed text-muted-fg"
      >
        {cardText}
      </pre>
    </article>
  );
}
