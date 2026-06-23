import { DossierSection } from "@/components/dossier/dossier-section";
import { Card, CardContent } from "@/components/ui/card";
import { EntityLink } from "@/components/ui/entity-link";
import type { Harvest } from "@/lib/types";

/* The /plots/[id] dossier's "harvests from this plot" section. Each row links
 * its picker → /workers/[id] (resolved name→id via `pickerIds`; an unknown
 * picker degrades to plain text, never a broken link) and its lot → /lots/[code]
 * — the cross-entity connectivity (P6). Reverse-chronological log. Pure Server
 * Component: takes domain props, never fetches. */

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("es-PA", {
    day: "2-digit",
    month: "short",
  });

export function PlotHarvestsSection({
  harvests,
  pickerIds,
}: {
  harvests: Harvest[];
  pickerIds: Record<string, string>;
}) {
  return (
    <DossierSection
      id="harvests"
      title="Cosechas de esta parcela"
      count={harvests.length}
      empty={harvests.length === 0}
      emptyLabel="Sin cosechas registradas todavía"
    >
      <Card>
        <CardContent className="px-0 py-1">
          <ul className="divide-y divide-line">
            {harvests.map((h) => {
              const pickerId = pickerIds[h.picker];
              return (
                <li
                  key={h.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3"
                >
                  <span className="w-16 text-sm font-medium text-muted-fg">
                    {fmtDate(h.date)}
                  </span>
                  <span className="font-display text-sm font-semibold text-ink">
                    {h.cherriesKg.toLocaleString("es-PA")} kg
                  </span>
                  <span className="text-sm text-muted-fg">
                    {pickerId ? (
                      <EntityLink
                        kind="worker"
                        id={pickerId}
                        className="rounded-md font-medium text-forest underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
                      >
                        {h.picker}
                      </EntityLink>
                    ) : (
                      h.picker
                    )}
                  </span>
                  <span className="ml-auto text-sm">
                    <EntityLink
                      kind="lot"
                      id={h.lotCode}
                      name={h.lotCode}
                      className="rounded-md font-medium text-coffee underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/40"
                    >
                      {h.lotCode}
                    </EntityLink>
                  </span>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </DossierSection>
  );
}
