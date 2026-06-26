import { getTranslations } from "next-intl/server";
import { CheckCircle2, EyeOff, QrCode, Sprout } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tile } from "@/components/ui/tile";
import { num } from "@/lib/utils";
import { getProvenanceCatalog } from "./data";
import { CurationCard } from "./curation-card.client";

/**
 * /(app)/provenance — the owner curation board (P3-S13).
 *
 * Every lot-linked SKU lands here as a glass card with its public-page status and a
 * publish/unpublish control. This is the curation gate that feeds the public
 * `/p/[slug]` microsite: nothing is anon-visible until the owner publishes here. The
 * board is a Server Component; the only client JS in the route lives in the per-SKU
 * <CurationCard> island (the publish dialog + take-down confirm).
 */
export default async function ProvenanceAdminPage() {
  const t = await getTranslations("provenance");
  const rows = await getProvenanceCatalog();

  const publishedCount = rows.filter((r) => r.isPublished).length;
  const draftCount = rows.length - publishedCount;

  return (
    <div className="space-y-6">
      <PageHeader title={t("admin.page.title")} subtitle={t("admin.page.subtitle")} />

      <div className="glass-card grid grid-cols-2 gap-px overflow-hidden rounded-2xl lg:grid-cols-3">
        <Tile
          label={t("admin.summary.skus")}
          value={num(rows.length)}
          sub={t("admin.summary.skusSub")}
          accent="forest"
          icon={QrCode}
        />
        <Tile
          label={t("admin.summary.published")}
          value={num(publishedCount)}
          sub={t("admin.summary.publishedSub")}
          accent="honey"
          icon={CheckCircle2}
        />
        <Tile
          label={t("admin.summary.drafts")}
          value={num(draftCount)}
          sub={t("admin.summary.draftsSub")}
          accent="coffee"
          icon={EyeOff}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Sprout}
          title={t("admin.empty.title")}
          description={t("admin.empty.description")}
        />
      ) : (
        <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <CurationCard key={row.skuId} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
