import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  platform: "node",
  // CLI entry keeps the `.js` extension; library entry also emits `.cjs` for the
  // `require` export. tsup derives extensions from `format` automatically.
});
