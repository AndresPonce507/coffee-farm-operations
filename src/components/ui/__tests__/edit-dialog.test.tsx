import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EditDialog } from "@/components/ui/edit-dialog";

afterEach(cleanup);

/**
 * EditDialog is the EDIT/CREATE host — a render-prop trigger over the finalized
 * portal-fixed glass `Dialog`. It owns only open/close state, so it inherits the
 * Dialog's focus trap / ESC / reduced-motion / AA for free. The slice supplies the
 * trigger markup (an existing card/row) and the bound form via the render-prop child.
 */
describe("EditDialog", () => {
  it("renders the trigger and keeps the dialog closed until the trigger fires", () => {
    render(
      <EditDialog
        title="Editar lote"
        trigger={(open) => (
          <button type="button" onClick={open}>
            Editar
          </button>
        )}
      >
        {() => <p>form body</p>}
      </EditDialog>,
    );
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the dialog (with title + form body) when the trigger calls open()", () => {
    render(
      <EditDialog
        title="Editar lote"
        trigger={(open) => (
          <button type="button" onClick={open}>
            Editar
          </button>
        )}
      >
        {() => <p>form body</p>}
      </EditDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-label", "Editar lote");
    expect(screen.getByText("form body")).toBeInTheDocument();
  });

  it("closes on ESC (inherited from the shared Dialog)", () => {
    render(
      <EditDialog
        title="Editar lote"
        trigger={(open) => (
          <button type="button" onClick={open}>
            Editar
          </button>
        )}
      >
        {() => <p>form body</p>}
      </EditDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes via the render-prop onDone when closeOnSuccess (default) is true", () => {
    render(
      <EditDialog
        title="Editar lote"
        trigger={(open) => (
          <button type="button" onClick={open}>
            Editar
          </button>
        )}
      >
        {({ onDone }) => (
          <button type="button" onClick={onDone}>
            Done
          </button>
        )}
      </EditDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does NOT auto-close on onDone when closeOnSuccess is false (form shows its own success pane)", () => {
    render(
      <EditDialog
        title="Editar lote"
        closeOnSuccess={false}
        trigger={(open) => (
          <button type="button" onClick={open}>
            Editar
          </button>
        )}
      >
        {({ onDone }) => (
          <button type="button" onClick={onDone}>
            Done
          </button>
        )}
      </EditDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    // Still open — the form owns the follow-through (e.g. a "Ver →" link).
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
