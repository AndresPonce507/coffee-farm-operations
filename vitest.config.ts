import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      // ── ui ── jsdom component/logic tests (unchanged from the original config).
      {
        // Next's tsconfig sets jsx:"preserve"; the React plugin compiles JSX/TSX.
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "ui",
          environment: "jsdom",
          setupFiles: ["./src/test/setup.ts"],
          // exclude *.db.test.ts so the db suite never loads under jsdom.
          include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
          exclude: ["src/**/*.db.test.ts"],
        },
      },
      // ── db ── node-env SQL/RLS substrate: replays real migrations in PGlite.
      {
        resolve: { alias },
        test: {
          name: "db",
          environment: "node",
          include: ["src/**/*.db.test.ts"],
        },
      },
    ],
  },
});
