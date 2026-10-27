import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    // The contract digest test occasionally exceeds Vitest's 5s default under
    // full parallel load. It grows with the operation catalog, so keep one
    // bound for local, CI and release runs.
    testTimeout: 30_000,
  },
});
