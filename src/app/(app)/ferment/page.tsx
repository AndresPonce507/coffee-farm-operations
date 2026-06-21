import { PageHeader } from "@/components/ui/page-header";
import { FermentBoard } from "@/components/sections/ferment/ferment-board";
import { getActiveRecipes, getFermentBatches } from "@/lib/db/ferment";
import { getLots } from "@/lib/db/lots";

/**
 * Ferment — the "/ferment" route for Coffee Farm Operations (P2-S3, the make-quality
 * trunk). The wet-mill tracker: every ferment batch as a glass card linking to its live
 * cockpit (pH/temp/Brix curves + a cut-point alert before the window closes), plus the
 * eco-mill water log. Opens the make-quality loop the family's cup-defining ferments run
 * on — they hit the cut-point instead of guessing.
 *
 * Server Component: awaits the ferment batches, the lot codes (for the start form), and
 * the versioned recipe library in parallel, then composes the header above the board.
 * The only client JS is the start-ferment dialog. The app shell (sidebar, topbar, padded
 * main) comes from (app)/layout.tsx; this page renders only its inner content.
 */
export default async function FermentPage() {
  const [batches, lots, recipes] = await Promise.all([
    getFermentBatches(),
    getLots(),
    getActiveRecipes(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ferment"
        subtitle="Wet-mill fermentation — live curves, cut-point alerts, eco-mill water"
      />

      <FermentBoard batches={batches} lots={lots} recipes={recipes} />
    </div>
  );
}
