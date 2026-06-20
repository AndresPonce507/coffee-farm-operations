import { PageHeader } from "@/components/ui/page-header";
import { GenealogyGraph } from "@/components/sections/lots/genealogy-graph";
import { getLotGenealogy } from "@/lib/db/lots";

/**
 * /lots/[code] — the S6 dogfood: open a lot, SEE its farm-to-bag lineage.
 *
 * Server Component. It awaits the S3 derived-read port `getLotGenealogy(code)`
 * (scoped to the lot's lineage) and renders the <GenealogyGraph> — the cherry
 * intake split into Washed/Natural, processed with visible yield-loss, blended
 * into the green bag being sold. "Provenance IS the product", made visible: the
 * buyer/auditor artifact.
 *
 * The terminal node (this `code`) gets the one glass-sheen. The graph prints as
 * SVG with zero client JS required; a thin island layers pan/zoom on top, and a
 * role="tree" outline carries the same lineage with edge mass as text (JS-off /
 * reduced-motion).
 *
 * NOTE (S9): nav/command-palette wiring TO this URL is a later slice — this page
 * only renders the lineage; it does not touch the shell nav.
 */
export default async function LotGenealogyPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const graph = await getLotGenealogy(code);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Lot ${code}`}
        subtitle="Farm-to-bag lineage — mass flow from cherry intake to the sold green lot"
      />

      <GenealogyGraph graph={graph} terminalCode={code} />
    </div>
  );
}
