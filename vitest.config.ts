import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: ["node_modules", "tests/e2e/**"],
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
