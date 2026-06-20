import { Coffee, Sprout, Wallet } from "lucide-react";

import { StatRing } from "@/components/charts/stat-ring";
import { BRAND } from "@/lib/brand";
import { SEASON } from "@/lib/data/trends";
import { kg, num, usd } from "@/lib/utils";

/** A single light stat shown inline on the forest band. */
function HeroStat({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-paper/10 text-honey-100 ring-1 ring-inset ring-paper/15"
        aria-hidden="true"
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-paper/60">
          {label}
        </p>
        <p className="font-display text-xl font-bold leading-tight text-paper">
          {value}
        </p>
        <p className="truncate text-xs text-paper/55">{sub}</p>
      </div>
    </div>
  );
}

/**
 * SeasonHero — the dashboard's marquee band.
 *
 * A forest-tinted, full-width card that greets the family, frames the season
 * story, and surfaces today's cherry intake alongside a ring tracking progress
 * toward the full-season goal. Pure presentation; safe as a server component.
 */
export function SeasonHero() {
  const seasonPct = (SEASON.harvestedKg / SEASON.targetKg) * 100;
  const remainingKg = Math.max(0, SEASON.targetKg - SEASON.harvestedKg);

  return (
    <section
      className="animate-rise relative isolate overflow-hidden rounded-2xl bg-forest text-paper ring-card-lg"
      aria-labelledby="season-hero-heading"
    >
      {/* Layered warm wash + canopy texture for depth. */}
      <div className="bg-canopy pointer-events-none absolute inset-0" aria-hidden="true" />
      <div
        className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-honey-100/15 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-forest-500/30 blur-3xl"
        aria-hidden="true"
      />

      <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.5fr_auto] lg:items-center lg:gap-10 lg:p-10">
        {/* Left — greeting, story, headline figure */}
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-paper/10 px-3 py-1 text-xs font-medium tracking-wide text-honey-100 ring-1 ring-inset ring-paper/15">
            <span
              className="h-1.5 w-1.5 rounded-full bg-honey-100"
              aria-hidden="true"
            />
            Harvest season · {BRAND.location}
          </span>

          <h1
            id="season-hero-heading"
            className="mt-5 font-display text-3xl font-bold tracking-tight text-paper sm:text-4xl"
          >
            Buenos días, {BRAND.shortName}
          </h1>
          <p className="mt-2 max-w-xl text-sm text-paper/70 sm:text-base">
            {BRAND.tagline}. We&apos;re at the peak of the {BRAND.varieties[0]}
            {" "}and {BRAND.varieties[1]} pickings — the cherries are coming in
            beautifully.
          </p>

          {/* Headline: today's cherries */}
          <div className="mt-7 flex flex-wrap items-end gap-x-3 gap-y-1">
            <span className="font-display text-5xl font-bold leading-none text-paper sm:text-6xl">
              {num(SEASON.todayKg)}
            </span>
            <span className="pb-1 text-lg font-semibold text-honey-100">kg</span>
            <span className="pb-1.5 text-sm text-paper/60">
              cherries received today
            </span>
          </div>

          {/* Inline supporting stats */}
          <div className="mt-8 grid gap-5 border-t border-paper/10 pt-6 sm:grid-cols-3">
            <HeroStat
              label="Harvested YTD"
              value={kg(SEASON.harvestedKg)}
              sub={`${num(remainingKg)} kg to target`}
              icon={Sprout}
            />
            <HeroStat
              label="Est. revenue"
              value={usd(SEASON.ytdRevenueUsd)}
              sub="Season to date"
              icon={Wallet}
            />
            <HeroStat
              label="Season target"
              value={kg(SEASON.targetKg)}
              sub="Full-season goal"
              icon={Coffee}
            />
          </div>
        </div>

        {/* Right — progress ring on a lighter inset surface for contrast */}
        <div className="flex justify-center lg:justify-end">
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-paper px-7 py-7 text-center ring-card-lg">
            <StatRing
              value={seasonPct}
              size={168}
              label="Season target"
              sublabel={`${kg(SEASON.harvestedKg)} of ${num(SEASON.targetKg)}`}
              color="#C8922E"
              track="#E7DED0"
            />
            <p className="max-w-[12rem] text-xs leading-relaxed text-muted-fg">
              On pace toward this season&apos;s cherry goal across all plots.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
