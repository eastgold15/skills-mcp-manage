import { defineConfig } from "@visulima/packem/config";

export default defineConfig({
  bundler: "rolldown",
  entries: [
    {
      declaration: true,
      input: "./src/index.ts",
    },
  ],
  failOnWarn: false,
  runtime: "node",
});
