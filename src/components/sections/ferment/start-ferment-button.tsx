"use client";

import { useState } from "react";
import { FlaskConical } from "lucide-react";

import type { FermentRecipe } from "@/lib/db/ferment";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { StartFermentForm } from "./start-ferment-form";

/**
 * StartFermentButton — the primary affordance to open a new ferment run (P2-S3). A
 * glass dialog hosting the StartFermentForm; the dialog stays out of the tree until
 * opened (the Dialog primitive renders only when open).
 */
export function StartFermentButton({
  lots,
  recipes,
}: {
  lots: string[];
  recipes: FermentRecipe[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <FlaskConical className="h-4 w-4" aria-hidden />
        Start ferment
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Start a ferment">
        <StartFermentForm
          lots={lots}
          recipes={recipes}
          onDone={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}
