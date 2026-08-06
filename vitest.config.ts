import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Next setzt tsconfig "jsx": "preserve" — für Component-Tests muss
  // vitest (rolldown-vite/oxc) JSX selbst transformieren.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    globals: false,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["src/lib/**/*.test.ts"],
          exclude: ["**/*.test.tsx"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          include: ["src/**/*.test.tsx", "src/app/**/*.test.ts", "src/components/**/*.test.ts"],
          environment: "jsdom",
        },
      },
    ],
  },
});
