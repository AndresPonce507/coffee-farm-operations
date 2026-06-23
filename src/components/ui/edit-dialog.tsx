"use client";

import { type ReactNode, useState } from "react";

import { Dialog } from "@/components/ui/dialog";

/** Helpers the bound form receives via the render-prop child. */
export interface EditDialogRenderProps {
  /** Call on success to close the host (no-op when `closeOnSuccess` is false). */
  onDone: () => void;
}

/**
 * EditDialog — the EDIT / CREATE host (facet-03 §1.1).
 *
 * A thin, reusable wrapper over the finalized portal-fixed glass `Dialog` that owns
 * only the open/close state + the trigger, so every create/edit affordance is one
 * component instead of the hand-rolled `useState(open)` + `<Dialog>` + `<Form onDone>`
 * triplet repeated across the existing record-intake / start-ferment buttons. Inherits
 * the Dialog's focus trap, ESC-to-close, scroll-lock, reduced-motion and WCAG-AA for
 * free. Does NOT replace the existing buttons (flag-don't-fix); it is the standard for
 * all NEW Phase-5 wiring.
 *
 * The render-prop `trigger` lets a slice keep an existing row/card's markup and just
 * attach `onClick={open}`, rather than nesting a `<Button>`. For a pure "＋ New X"
 * affordance, `trigger` returns a `<Button onClick={open}>`.
 */
export function EditDialog({
  title,
  trigger,
  children,
  closeOnSuccess = true,
}: {
  title: string;
  /** The clickable element; receives `open` to raise the dialog. */
  trigger: (open: () => void) => ReactNode;
  /** The bound form — receives `onDone` to close the host on success. */
  children: (p: EditDialogRenderProps) => ReactNode;
  /** false when the form shows its own success state with a follow-through link. */
  closeOnSuccess?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {trigger(() => setOpen(true))}
      <Dialog open={open} onClose={() => setOpen(false)} title={title}>
        {children({
          onDone: () => {
            if (closeOnSuccess) setOpen(false);
          },
        })}
      </Dialog>
    </>
  );
}
