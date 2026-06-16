import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Co-located *.test.ts next to the code under test (consistency rule #5).
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
});
