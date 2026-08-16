import { defineConfig } from "@visulima/packem/config";
import transformer from "@visulima/packem/transformer/esbuild";

export default defineConfig({
  clean: true,
  failOnWarn: false,
  runtime: "node",
  transformer,
  validation: false,
});
