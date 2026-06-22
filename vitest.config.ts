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
          // Underscore-prefixed files are throwaway scratch / red-team repros.
          // Vitest scans the filesystem (not git), and the db suite is the sole
          // quality gate (CLAUDE.md: gate = build green + test green) — so a
          // forgotten local `_*.db.test.ts` must NEVER silently join the gate
          // (going red and blocking, or worse, going green while pinning a
          // known-broken behaviour as the expected value).
          exclude: ["src/**/_*.db.test.ts"],
          // Each db file's beforeAll spins a fresh in-process PGlite and replays
          // EVERY migration (WASM Postgres — CPU-heavy). As the migration lane and
          // the db-test set grow, that cold replay can exceed the default 10s hook
          // timeout when many files run concurrently (pure CPU contention, not a
          // logic failure — the same files pass comfortably run alone or serially).
          // Give the PGlite cold-start headroom so the suite stays green as it grows.
          hookTimeout: 60000,
          testTimeout: 30000,
        },
      },
    ],
  },
});
