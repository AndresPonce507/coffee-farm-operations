import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  ArrowRight,
  Coffee,
  Flame,
  Gauge,
  Lock,
  Sprout,
} from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tile } from "@/components/ui/tile";
import { num } from "@/lib/utils";
import {
  getRoastBatches,
  getRoastProfiles,
  getRoastableGreenLots,
  getRoasters,
  type RoastBatchRow,
  type RoastProfile,
} from "./data";
import { LockProfileButton } from "./lock-profile-button.client";
import { RoastConsole } from "./roast-console.client";

/**
 * /roast — the roasting board (P3-S10 versioned golden profiles + .alog capture + SKU).
 *
 * Server Component. Four reads compose the board: the versioned golden-curve library
 * (`roast_profiles`), the roaster registry (`roasters`), the green lots available to
 * roast (`green_lots_atp`), and every roast batch with its lineage (`roast_traceability`).
 * The keystone is rendered HONESTLY: a draft profile reads "Draft" and NEVER "Golden"
 * (only an approved/golden curve can be roasted against — the DB is the real wall, the
 * board mirrors it). The one interactive surface is the <RoastConsole> launcher (new
 * golden profile + open batch); locking a draft golden is the per-card <LockProfileButton>.
 */

type RoastT = Awaited<ReturnType<typeof getTranslations<"roast">>>;

const PROFILE_STATUS_TONE: Record<RoastProfile["status"], BadgeTone> = {
  draft: "neutral",
  approved: "forest",
  retired: "coffee",
};

const BATCH_STATUS_TONE: Record<string, BadgeTone> = {
  open: "sky",
  finalized: "forest",
};

export default async function RoastPage() {
  const t = await getTranslations("roast");
  const [profiles, roasters, greenLots, batches] = await Promise.all([
    getRoastProfiles(),
    getRoasters(),
    getRoastableGreenLots(),
    getRoastBatches(),
  ]);

  const golden = profiles.filter((p) => p.status === "approved");
  const openCount = batches.filter((b) => b.status === "open").length;
  const roastedKg = batches.reduce((sum, b) => sum + (b.roastedKgOut ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")}>
        <RoastConsole
          goldenProfiles={golden}
          roasters={roasters}
          greenLots={greenLots}
        />
      </PageHeader>

      {/* Summary strip — the live golden + roaster funnel. */}
      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        <Tile
          label={t("summary.profiles")}
          value={num(profiles.length)}
          sub={t("summary.profilesSub", { count: num(profiles.length) })}
          accent="coffee"
          icon={Coffee}
        />
        <Tile
          label={t("summary.golden")}
          value={num(golden.length)}
          sub={t("summary.goldenSub")}
          accent="honey"
          icon={Lock}
        />
        <Tile
          label={t("summary.openBatches")}
          value={num(openCount)}
          sub={t("summary.openBatchesSub")}
          accent="sky"
          icon={Flame}
        />
        <Tile
          label={t("summary.roasted")}
          value={num(Math.round(roastedKg))}
          sub={t("summary.roastedSub")}
          accent="forest"
          icon={Sprout}
        />
      </div>

      {/* Golden-curve library. */}
      <section className="glass-card rounded-2xl p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-base font-semibold text-ink">
            {t("library.title")}
          </h2>
          <p className="text-xs text-muted-fg">{t("library.subtitle")}</p>
        </div>

        {profiles.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              icon={Gauge}
              title={t("empty.profilesTitle")}
              description={t("empty.profilesDescription")}
            />
          </div>
        ) : (
          <div className="stagger mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {profiles.map((p) => (
              <ProfileCard key={p.id} profile={p} t={t} />
            ))}
          </div>
        )}
      </section>

      {/* Roast batches. */}
      <section className="space-y-4">
        <h2 className="font-display text-base font-semibold text-ink">
          {t("batches.title")}
        </h2>

        {batches.length === 0 ? (
          <EmptyState
            icon={Flame}
            title={t("empty.batchesTitle")}
            description={t("empty.batchesDescription")}
          />
        ) : (
          <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {batches.map((b) => (
              <BatchCard key={b.roastBatchId} batch={b} t={t} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ProfileCard({ profile, t }: { profile: RoastProfile; t: RoastT }) {
  const isGolden = profile.status === "approved";
  // The keystone, told honestly: a draft reads "Draft" + carries the lock-to-golden
  // affordance; it NEVER reads "Golden" (it can't be roasted against).
  const statusLabel = isGolden
    ? t("status.golden")
    : profile.status === "retired"
      ? t("status.retired")
      : t("status.draft");

  return (
    <div
      data-testid={`roast-profile-${profile.id}`}
      className="glass-card perf-contain flex flex-col rounded-2xl p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-ink">
            {profile.name}
          </p>
          <p className="text-xs tabular-nums text-muted-fg">
            {t("profile.version", { version: num(profile.version) })}
            {" · "}
            {profile.variety ?? t("profile.anyVariety")}
            {" · "}
            {t(`roastLevel.${profile.roastLevel}`)}
          </p>
        </div>
        <Badge tone={PROFILE_STATUS_TONE[profile.status]} dot>
          {statusLabel}
        </Badge>
      </div>

      {/* Numeric golden targets. */}
      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <TargetCell
          label={t("profile.charge")}
          value={t("profile.tempValue", { temp: num(profile.targetChargeTempC) })}
        />
        <TargetCell
          label={t("profile.drop")}
          value={t("profile.tempValue", { temp: num(profile.targetDropTempC) })}
        />
        <TargetCell
          label={t("profile.time")}
          value={`${num(profile.targetTotalTimeS)}s`}
        />
        <TargetCell
          label={t("profile.dtr")}
          value={
            profile.targetDtrPct == null
              ? t("profile.noDtr")
              : t("profile.dtrValue", { pct: num(profile.targetDtrPct) })
          }
        />
      </dl>

      {/* A draft surfaces the one-way lock-to-golden affordance. */}
      {profile.status === "draft" && (
        <div className="mt-4 flex justify-end border-t border-line pt-4">
          <LockProfileButton
            profileId={profile.id}
            name={profile.name}
            version={profile.version}
          />
        </div>
      )}
    </div>
  );
}

function TargetCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-paper/70 px-2.5 py-2">
      <dt className="text-[0.6875rem] uppercase tracking-wide text-muted-fg">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function BatchCard({ batch, t }: { batch: RoastBatchRow; t: RoastT }) {
  const statusLabel =
    batch.status === "finalized"
      ? t("batchStatus.finalized")
      : t("batchStatus.open");

  return (
    <Link
      href={`/roast/${batch.roastBatchId}`}
      data-testid={`roast-batch-${batch.roastBatchId}`}
      className="glass-card group perf-contain flex flex-col rounded-2xl p-5 transition-shadow hover:shadow-[0_12px_32px_-12px_rgba(0,41,29,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-ink">
            {batch.greenLotCode}
          </p>
          {batch.roastedLotCode && (
            <p className="text-xs tabular-nums text-forest">
              {t("batch.roastedLot", { code: batch.roastedLotCode })}
            </p>
          )}
        </div>
        <Badge tone={BATCH_STATUS_TONE[batch.status] ?? "neutral"} dot>
          {statusLabel}
        </Badge>
      </div>

      <p className="mt-3 text-xs tabular-nums text-muted-fg">
        {t("batch.greenIn")}: {t("batch.kgValue", { kg: num(batch.greenInKg) })}
        {batch.roastedKgOut != null && (
          <>
            {" · "}
            {t("batch.roastedOut")}:{" "}
            {t("batch.kgValue", { kg: num(batch.roastedKgOut) })}
          </>
        )}
      </p>

      {batch.shrinkagePct != null && (
        <p className="mt-1 text-xs tabular-nums text-honey-700">
          {t("batch.shrinkageValue", {
            pct: num(Math.round(batch.shrinkagePct * 100)),
          })}
        </p>
      )}

      <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-forest">
        {t("batch.view")}
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}
