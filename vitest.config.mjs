// Vitest config — node environment, ESM native, c8/v8 coverage targeting
// the files we actually author (plugins/, eslint-rules/, lib/) that are
// pure logic. Excluded:
//   - bin/code-smells.mjs — integration test covers exit paths; the
//     remaining wiring (spawn + event callbacks) is not meaningfully
//     unit-testable without re-stubbing Node internals.
//   - code-pushup.config.mjs — config file that wires plugin factories;
//     all its pure logic lives in lib/config-helpers.mjs and lib/cli-core.mjs.
//   - eslint.target-rules.mjs — flat-config rule list; pure data.
//   - eslint-rules/index.mjs — re-export barrel; test imports it
//     transitively but v8 doesn't count static-only modules as covered.
//
// Thresholds target 95% across statements/functions/lines with 90% for
// branches (branches are slightly noisier due to defensive null coalescing).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["test/**/*.spec.mjs", "lib/**/*.spec.mjs"],
    coverage: {
      provider: "v8",
      // lcov is read by the `coverage` code-pushup plugin for the Test
      // Quality category; the others are for humans.
      reporter: ["text", "text-summary", "html", "json-summary", "lcov"],
      include: ["lib/**/*.mjs", "plugins/**/*.mjs", "eslint-rules/**/*.mjs"],
      exclude: [
        "**/*.spec.mjs",
        "**/node_modules/**",
        "test/**",
        // Static re-export barrel — v8 doesn't count as covered even when imported.
        "eslint-rules/index.mjs",
      ],
      thresholds: {
        lines: 95,
        statements: 95,
        functions: 95,
        branches: 90,
      },
    },
  },
});
