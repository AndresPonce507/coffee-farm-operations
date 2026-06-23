import { PageHeader } from "@/components/ui/page-header";
import { WeighCapture } from "@/components/sections/weigh/weigh-capture";
import { getCrewRoster } from "@/lib/db/people";
import {
  getWeighPlots,
  getWeighTodayByPicker,
} from "@/lib/db/weigh";

/**
 * Weigh — the "/weigh" route for Coffee Farm Operations (P2-S2).
 *
 * THE GENESIS FIELD EVENT, made into the farm's most-used screen: a <3-second,
 * glove-friendly, OFFLINE-FIRST capture surface. The Server Component loads the
 * offline-preloadable context — active pickers (so the field grid badges instantly),
 * the plots + their centroids (so GPS auto-confirms the plot), and today's running
 * per-picker tally — and hands them to the WeighCapture island, which writes through
 * S0's outbox so a tap at 1,700 masl with no signal is durable and replayed
 * exactly-once. One captured weigh-in is simultaneously the picker's pay, their
 * attendance proof, and a node in lot JC-NNN's genealogy.
 *
 * Data flows from the read ports (security_invoker views governed by the
 * authenticated-read RLS the S2 migration set). Writes never go through the page.
 */
export default async function WeighPage() {
  const [roster, plots, byPicker] = await Promise.all([
    getCrewRoster(),
    getWeighPlots(),
    getWeighTodayByPicker(),
  ]);

  // Only pickers on an active crew can be badged (the RPC enforces it; we pre-filter
  // so the field grid never shows a name the capture would refuse).
  const kgByWorker = new Map(byPicker.map((p) => [p.workerId, p]));
  const pickers = roster
    .filter((m) => m.crewId !== null)
    .map((m) => ({
      workerId: m.workerId,
      name: m.preferredName ?? m.name,
      crewName: m.crewName,
      kgToday: kgByWorker.get(m.workerId)?.kgToday ?? 0,
    }));

  const farmKgToday = byPicker.reduce((sum, p) => sum + p.kgToday, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pesaje"
        subtitle="El evento de campo de origen — registrar, pesar, madurez · funciona sin conexión"
      />
      <WeighCapture pickers={pickers} plots={plots} farmKgToday={farmKgToday} />
    </div>
  );
}
