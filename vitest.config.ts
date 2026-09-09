import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Unit tests for the TypeScript side: lib/, the API handlers, and the agent runner's
 * pure helpers. The Hardhat suite covers the contracts; until this existed nothing
 * exercised the code between the wallet and the chain.
 */
export default defineConfig({
  test: {
    include: ["tests-ts/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
});
