import { defineConfig } from "vitest/config";
import path from "node:path";

// Vitest runs pure domain/simulation tests in a node environment.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
