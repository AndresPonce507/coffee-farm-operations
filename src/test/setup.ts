// Vitest global setup — wires @testing-library/jest-dom matchers
// (toBeInTheDocument, toHaveClass, etc.) into every test file.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Globals are off, so RTL's automatic cleanup isn't registered. Unmount the
// rendered tree after every test so multi-render UI tests don't leak DOM
// ("Found multiple elements") into one another.
afterEach(() => {
  cleanup();
});
