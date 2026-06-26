import { getTranslations } from "next-intl/server";
import { Award, BadgeCheck, Sparkles, Trophy } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tile } from "@/components/ui/tile";
import { num } from "@/lib/utils";
import { getReputationWall } from "./data";
import { ReputationCard } from "./reputation-card";

/**
 * /reputation — the estate's wall of fame (P3-S19 reputation ledger).
 *
 * Every lot that carries a live accolade lands here as a glass card, ranked by its
 * best cup score, then by how decorated it is. Each card is a ReputationCard linking
 * to the lot's append-only ledger. The whole board is a Server Component reading the
 * co-located reputation port; the only client JS in this slice lives on the per-lot
 * page's accolade composer. A lot with no accolades simply isn't on the wall (the
 * honest empty state), and a NULL cup score shows "not cupped", never a fabricated 0.
 */
export default async function ReputationPage() {
  const t = await getTranslations("reputation");
  const lots = await getReputationWall();

  const totalAwards = lots.reduce((acc, l) => acc + l.awardCount, 0);
  const totalCerts = lots.reduce((acc, l) => acc + l.certCount, 0);
  const topScore = lots.reduce<number | null>((best, l) => {
    if (l.bestCupScore == null) return best;
    return best == null || l.bestCupScore > best ? l.bestCupScore : best;
  }, null);

  return (
    <div className="space-y-6">
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")} />

      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-4">
        <Tile
          label={t("summary.lots")}
          value={num(lots.length)}
          sub={t("summary.lotsSub", { count: lots.length })}
          accent="forest"
          icon={Sparkles}
        />
        <Tile
          label={t("summary.awards")}
          value={num(totalAwards)}
          sub={t("summary.awardsSub")}
          accent="honey"
          icon={Trophy}
        />
        <Tile
          label={t("summary.certs")}
          value={num(totalCerts)}
          sub={t("summary.certsSub")}
          accent="coffee"
          icon={BadgeCheck}
        />
        <Tile
          label={t("summary.topScore")}
          value={topScore == null ? "—" : num(topScore, 1)}
          sub={t("summary.topScoreSub")}
          accent="sky"
          icon={Award}
        />
      </div>

      {lots.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {lots.map((lot) => (
            <ReputationCard
              key={lot.lotCode}
              summary={lot}
              t={t}
              href={`/reputation/${encodeURIComponent(lot.lotCode)}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
