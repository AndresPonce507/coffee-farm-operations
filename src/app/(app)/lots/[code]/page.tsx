import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { DossierShell } from "@/components/dossier/dossier-shell";
import { DossierSection } from "@/components/dossier/dossier-section";
import { GenealogyGraph } from "@/components/sections/lots/genealogy-graph";
import { LotCostEntriesSection } from "@/components/sections/lots/lot-cost-entries-section";
import { EudrDossier } from "@/components/sections/eudr/eudr-dossier";
import { getLotGenealogy } from "@/lib/db/lots";
import { getLotEudrDossier } from "@/lib/db/eudr";
import { getCostBreakdown } from "@/lib/db/cogs";

/**
 * /lots/[code] — open a lot, SEE its farm-to-bag lineage (S6) AND its EUDR
 * due-diligence dossier (S8).
 *
 * Server Component. It awaits the S3 derived-read port `getLotGenealogy(code)`
 * (scoped to the lot's lineage) and renders the <GenealogyGraph> — the cherry
 * intake split into Washed/Natural, processed with visible yield-loss, blended
 * into the green bag being sold — then the <EudrDossier> (the lot's plots of
 * origin + their geolocation/deforestation-free status). "Provenance IS the
 * product", made visible AND auditable: the buyer/auditor artifact.
 *
 * The terminal node (this `code`) gets the one glass-sheen. The graph prints as
 * SVG with zero client JS required; a thin island layers pan/zoom on top, and a
 * role="tree" outline carries the same lineage with edge mass as text (JS-off /
 * reduced-motion).
 *
 * NOTE (S9): nav/command-palette wiring TO this URL is a later slice — this page
 * only renders; it does not touch the shell nav.
 */
export default async function LotGenealogyPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const t = await getTranslations("lots");
  const graph = await getLotGenealogy(code);

  // The ⌘K palette (and any hand-typed URL) can route to /lots/JC-999 even when
  // no such lot exists; an invalid/injection code resolves to an empty graph too
  // (getLotGenealogy rejects it). Either way there's no lineage to show — 404
  // rather than render a fabricated/empty traceability page (review finding #18).
  if (graph.nodes.length === 0) {
    notFound();
  }

  // The EUDR dossier is defined over GREEN export lots only — a non-green lot is
  // not yet under due diligence, and showing its dossier would mislabel a lot
  // with real direct harvests as "origin unverified" (review finding). Gate the
  // section on this lot actually being green; only then fetch the dossier.
  const isGreen = graph.nodes.some(
    (n) => n.code === code && n.stage === "green",
  );

  // Fan section reads in parallel — EUDR dossier (green lots only) + the
  // directly-tagged cost_entry rows for the #cost-entries anchor. The cost
  // entries are the raw journal rows whose target_kind="lot" and
  // target_code=code; overhead/agronomy that REACH this lot via the graph walk
  // land on "farm"/"plot" targets and are NOT in this ledger (the LotCostEntriesSection
  // is honest about this, pointing back at the build-up above it).
  const [dossier, costEntries] = await Promise.all([
    isGreen ? getLotEudrDossier(code) : Promise.resolve(null),
    getCostBreakdown({ targetKind: "lot", targetCode: code }),
  ]);

  return (
    <DossierShell
      kind="lot"
      title={t("page.title", { code })}
      eyebrow={t("page.eyebrow")}
      subtitle={t("page.subtitle")}
      backHref="/lots"
      backLabel={t("page.backLabel")}
    >
      <DossierSection id="lineage" title={t("page.lineageSection")}>
        <GenealogyGraph graph={graph} terminalCode={code} />
      </DossierSection>

      {dossier && (
        <DossierSection id="eudr" title={t("page.eudrSection")}>
          <EudrDossier dossier={dossier} />
        </DossierSection>
      )}

      {/* #cost-entries anchor — the provenance drill destination used by
          CostLotCard (kind="lot" anchor="cost-entries"). Always rendered
          (even when empty) so the fragment always scrolls to a real node. */}
      <LotCostEntriesSection entries={costEntries} />
    </DossierShell>
  );
}
