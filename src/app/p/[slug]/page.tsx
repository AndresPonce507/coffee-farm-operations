import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  ArrowRight,
  Coffee,
  Leaf,
  MapPin,
  Mountain,
  ShieldCheck,
  Sprout,
  Users,
} from "lucide-react";

import { longDate, num } from "@/lib/utils";
import { getProvenance, type Provenance } from "./data";

/**
 * /p/[slug] — the PUBLIC per-lot QR provenance microsite (P3-S13).
 *
 * Served outside the authenticated `(app)` shell: an anonymous visitor scans the bag
 * QR (a GS1 Digital Link) and lands here. The page reads the ONE anon door —
 * `resolve_provenance(slug)` — which returns the curated, PUBLISHED-only whitelist;
 * an unpublished or unknown slug resolves to NULL and the page 404s (nothing public
 * until the owner publishes; never a leak). Every fact on this page is a whitelisted
 * field of the typed `Provenance` payload, so there is NO surface here that could
 * reach a worker name/phone/wage, the warehouse location, COGS, or a buyer — the
 * keystone of the slice is structurally impossible to violate from the UI.
 *
 * Server Component, force-dynamic (DB at request time keeps the build DB-free). The
 * marquee is fully server-rendered scrollytelling — entrance motion is CSS-only
 * (`animate-rise`/`stagger`, globally neutralized under prefers-reduced-motion), so
 * the page ships effectively zero client JS for a fast, SEO-clean public surface.
 * Spanish-first (es-PA) buyer copy via the `provenance` namespace.
 */
export const dynamic = "force-dynamic";

type ProvenanceT = Awaited<ReturnType<typeof getTranslations<"provenance">>>;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await getProvenance(decodeURIComponent(slug)).catch(() => null);
  if (!page) return { title: "Janson Coffee", robots: { index: false } };
  const t = await getTranslations("provenance");
  const product = page.productName ?? page.greenLotCode;
  return {
    title: t("public.meta.title", { product }),
    description: t("public.meta.description", { product }),
    openGraph: {
      title: t("public.meta.title", { product }),
      description: t("public.meta.description", { product }),
    },
  };
}

export default async function ProvenancePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await getProvenance(decodeURIComponent(slug)).catch(() => null);
  if (!page) notFound();

  const t = await getTranslations("provenance");
  const product = page.productName ?? page.greenLotCode;
  const facets = [page.variety, page.process].filter(Boolean).join(" · ");

  return (
    <main className="min-h-screen bg-paper text-ink">
      {/* ── Hero: forest band, marquee product name ───────────────────────── */}
      <header className="glass-forest relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_80%_-10%,rgba(255,255,255,0.16),transparent_55%)]"
        />
        <div className="animate-rise relative mx-auto w-full max-w-3xl px-5 py-14 md:px-8 md:py-20">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-paper/75">
            {t("public.eyebrow")}
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold leading-tight tracking-tight text-paper md:text-5xl">
            {product}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-paper/85">
            {facets && <span>{facets}</span>}
            {facets && <span aria-hidden className="text-paper/40">•</span>}
            <span className="tabular-nums">{t("public.lotLine", { lot: page.greenLotCode })}</span>
            {page.isSingleOrigin && (
              <span className="inline-flex items-center gap-1 rounded-full bg-paper/15 px-2.5 py-1 text-xs font-medium text-paper">
                <Sprout className="h-3.5 w-3.5" aria-hidden />
                {t("public.single")}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl space-y-10 px-5 py-10 md:px-8 md:py-12">
        {/* ── Quality: cup-score dial + SCA grade ─────────────────────────── */}
        <section className="stagger grid grid-cols-1 gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
          <CupDial score={page.cuppingScore} t={t} />
          <div className="glass-card rounded-2xl p-5">
            <p className="text-xs uppercase tracking-wide text-muted-fg">
              {t("public.cup.grade")}
            </p>
            <p className="mt-1 font-display text-2xl font-bold text-forest">
              {page.scaGrade ?? t("public.cup.unscored")}
            </p>
            {page.curatedStory && (
              <p className="mt-3 text-sm leading-relaxed text-ink/80">
                {page.curatedStory}
              </p>
            )}
          </div>
        </section>

        {/* ── Forest check (EUDR) ─────────────────────────────────────────── */}
        <EudrBanner status={page.eudrStatus} t={t} />

        {/* ── Origin: where it grew ───────────────────────────────────────── */}
        <Section icon={Mountain} title={t("public.origin.heading")}>
          {page.originPlots.length === 0 ? (
            <p className="text-sm text-muted-fg">{t("public.origin.empty")}</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {page.originPlots.map((plot, i) => (
                <PlotCard key={`${plot.plotName}-${i}`} plot={plot} t={t} />
              ))}
            </div>
          )}
        </Section>

        {/* ── Picked by hand (anonymized crew labels) ─────────────────────── */}
        <Section icon={Users} title={t("public.crew.heading")}>
          <p className="text-sm leading-relaxed text-ink/80">{t("public.crew.body")}</p>
          {page.crewLabels.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {page.crewLabels.map((crew) => (
                <span
                  key={crew}
                  className="inline-flex items-center gap-1.5 rounded-full border border-forest/15 bg-forest/[0.05] px-3 py-1.5 text-sm font-medium text-forest"
                >
                  <Leaf className="h-3.5 w-3.5" aria-hidden />
                  {crew}
                </span>
              ))}
            </div>
          )}
        </Section>

        {/* ── How it was made (leak-safe timeline) ────────────────────────── */}
        <Section icon={Coffee} title={t("public.timeline.heading")}>
          {page.processingTimeline.length === 0 ? (
            <p className="text-sm text-muted-fg">{t("public.timeline.empty")}</p>
          ) : (
            <ol data-testid="provenance-timeline" className="relative space-y-4 pl-6">
              <span
                aria-hidden
                className="absolute left-[7px] top-1.5 bottom-1.5 w-px bg-gradient-to-b from-forest/40 via-line to-transparent"
              />
              {page.processingTimeline.map((step, i) => (
                <li key={`${step.kind}-${i}`} className="relative">
                  <span
                    aria-hidden
                    className="absolute -left-6 top-1 grid h-3.5 w-3.5 place-items-center rounded-full border-2 border-forest bg-paper"
                  />
                  <p className="text-sm font-medium text-ink">{kindLabel(step.kind, t)}</p>
                  <p className="text-xs tabular-nums text-muted-fg">
                    {longDate(step.occurredAt)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Section>

        {/* ── The reserve / quetzal forest story ──────────────────────────── */}
        <section className="glass-card glass-sheen overflow-hidden rounded-2xl p-6">
          <h2 className="font-display text-lg font-semibold text-forest">
            {t("public.reserve.heading")}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink/80">
            {t("public.reserve.body")}
          </p>
        </section>

        {/* ── CTA: buy this exact lot ─────────────────────────────────────── */}
        <section className="rounded-2xl border border-forest/15 bg-forest/[0.04] p-6 text-center">
          <h2 className="font-display text-xl font-bold text-ink">
            {t("public.cta.heading")}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-fg">
            {t("public.cta.sub")}
          </p>
          <Link
            href="/shop"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-forest px-5 py-3 text-sm font-semibold text-paper shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18),0_8px_20px_-8px_rgba(0,41,29,0.4)] transition-transform hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2"
          >
            {t("public.cta.button")}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </section>

        {/* ── Trace footer: GTIN + thank-you ──────────────────────────────── */}
        <footer className="border-t border-line pt-6 text-center">
          {page.gtin && (
            <p className="text-xs uppercase tracking-wide tabular-nums text-muted-fg">
              {t("public.trace.gtin", { gtin: page.gtin })}
            </p>
          )}
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-fg">
            {t("public.trace.scan")}
          </p>
        </footer>
      </div>
    </main>
  );
}

/* ───────────────────────────── sub-components ───────────────────────────── */

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-card rounded-2xl p-5">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-forest-100/70 text-forest">
          <Icon className="h-4 w-4" />
        </span>
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Pure SVG radial cup-score dial. No JS; reduced-motion-safe by construction. */
function CupDial({ score, t }: { score: number | null; t: ProvenanceT }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const offset = c * (1 - pct);
  return (
    <div className="glass-card flex flex-col items-center justify-center rounded-2xl p-5">
      <div className="relative h-28 w-28">
        <svg viewBox="0 0 100 100" className="h-28 w-28 -rotate-90">
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-line, #e7e1d6)" strokeWidth="8" />
          {score != null && (
            <circle
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke="#00291D"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={offset}
            />
          )}
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className="font-display text-3xl font-bold tabular-nums text-forest">
            {score == null ? "—" : num(Math.round(score))}
          </span>
        </div>
      </div>
      <p className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-fg">
        {t("public.cup.label")}
      </p>
      <p className="text-[0.6875rem] text-muted-fg">{t("public.cup.scale")}</p>
    </div>
  );
}

const EUDR_TONE: Record<string, { wrap: string; icon: string }> = {
  compliant: { wrap: "border-forest/20 bg-forest/[0.06] text-forest", icon: "text-forest" },
  incomplete: { wrap: "border-honey-700/25 bg-honey-100/50 text-honey-700", icon: "text-honey-700" },
  "no-origin": { wrap: "border-line bg-muted/50 text-muted-fg", icon: "text-muted-fg" },
};

function EudrBanner({ status, t }: { status: string; t: ProvenanceT }) {
  const tone = EUDR_TONE[status] ?? EUDR_TONE["no-origin"];
  const tagKey = `public.eudr.tag.${status}`;
  const bodyKey = `public.eudr.${status}`;
  return (
    <section className={`flex items-start gap-3 rounded-2xl border p-5 ${tone.wrap}`}>
      <ShieldCheck className={`mt-0.5 h-6 w-6 shrink-0 ${tone.icon}`} aria-hidden />
      <div>
        <p className="text-sm font-semibold">
          {t.has(tagKey) ? t(tagKey) : t("public.eudr.tag.no-origin")}
        </p>
        <p className="mt-0.5 text-sm opacity-90">
          {t.has(bodyKey) ? t(bodyKey) : t("public.eudr.no-origin")}
        </p>
      </div>
    </section>
  );
}

function PlotCard({ plot, t }: { plot: Provenance["originPlots"][number]; t: ProvenanceT }) {
  const coords = plot.centroid?.coordinates ?? null;
  return (
    <div className="rounded-xl bg-paper/70 p-4">
      <p className="flex items-center gap-1.5 font-medium text-ink">
        <MapPin className="h-4 w-4 text-forest" aria-hidden />
        {plot.plotName ?? "—"}
      </p>
      {plot.establishedYear != null && (
        <p className="mt-0.5 text-xs text-muted-fg">
          {t("public.origin.established", { year: plot.establishedYear })}
        </p>
      )}
      {coords && (
        <p className="mt-1 text-[0.6875rem] tabular-nums text-muted-fg">
          {t("public.origin.coords", {
            lat: coords[1].toFixed(4),
            lng: coords[0].toFixed(4),
          })}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {plot.geolocated && (
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-100/70 px-2 py-0.5 text-[0.6875rem] font-medium text-sky">
            <MapPin className="h-3 w-3" aria-hidden />
            {t("public.origin.geolocated")}
          </span>
        )}
        {plot.deforestationFree && (
          <span className="inline-flex items-center gap-1 rounded-full bg-forest-100/70 px-2 py-0.5 text-[0.6875rem] font-medium text-forest">
            <Leaf className="h-3 w-3" aria-hidden />
            {t("public.origin.deforestationFree")}
          </span>
        )}
      </div>
    </div>
  );
}

function kindLabel(kind: string, t: ProvenanceT): string {
  const key = `public.kind.${kind}`;
  return t.has(key) ? t(key) : t("public.kind.fallback");
}
