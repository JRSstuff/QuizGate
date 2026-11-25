import { defineConfig, loadEnv } from "vite";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  Object.assign(process.env, env);

  return {
    test: {
      globals: true,
      environment: "node",
      exclude: ["node_modules", "tests/e2e/**"],
      alias: {
        "@": path.resolve(__dirname, "./"),
      },
    },
  };
});
