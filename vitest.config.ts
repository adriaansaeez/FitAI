import { defineConfig } from "vitest/config";

// Vitest runs pure domain/simulation tests in a node environment.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
