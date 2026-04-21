/**
 * coupling plugin
 *
 * Wraps dependency-cruiser's programmatic `cruise()` API. Emits a single
 * `high-fan-out` audit listing files that import more than N modules.
 *
 * ## Entry resolution (monorepo-friendly)
 *
 * Historically took a single `entry` string that defaulted to `"src"`. This
 * broke on monorepo targets (yarn/pnpm/npm workspace layouts with
 * `plugins/<ws>/src`, `libs/<ws>/src`, or `packages/<ws>/src`) —
 * dependency-cruiser would throw ENOENT on the missing top-level `src/`.
 *
 * Now:
 *   1. If `entry` is an array, use it verbatim.
 *   2. If `entry` is a comma-separated string, split on `,`.
 *   3. If `entry` is the default `"src"` and the target has no top-level
 *      `src/`, auto-detect `plugins/<ws>/src`, `libs/<ws>/src`, and
 *      `packages/<ws>/src` subdirectories.
 *   4. Otherwise treat `entry` as a single path.
 *
 * CP_ENTRY can carry the comma-separated form from the CLI.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { cruise } from "dependency-cruiser";

/** Return the list of `dir/WS/src` subdirectories that actually exist under targetDir. */
const workspacesWithSrc = (targetDir, dir) => {
  const root = join(targetDir, dir);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((name) => join(dir, name, "src"))
    .filter((rel) => existsSync(join(targetDir, rel)) && statSync(join(targetDir, rel)).isDirectory());
};

/**
 * Resolve the `entry` option into an array of entry paths that
 * actually exist on disk. Any non-existent path is filtered out — a
 * previous bug where the default `"src"` fallback returned `["src"]`
 * even when no `src/` directory existed caused dependency-cruiser to
 * crash with ENOENT. Downstream callers must handle the empty-array
 * case as a graceful skip.
 */
const resolveEntries = (targetDir, entry) => {
  const existsIn = (e) => existsSync(join(targetDir, e));
  if (Array.isArray(entry)) return entry.filter(existsIn);
  if (typeof entry === "string" && entry.includes(",")) {
    return entry
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter(existsIn);
  }
  if (entry === "src" && !existsSync(join(targetDir, "src"))) {
    const monorepoEntries = [
      ...workspacesWithSrc(targetDir, "plugins"),
      ...workspacesWithSrc(targetDir, "libs"),
      ...workspacesWithSrc(targetDir, "packages"),
    ];
    if (monorepoEntries.length > 0) return monorepoEntries;
  }
  return existsIn(entry) ? [entry] : [];
};

/**
 * @param {{ targetDir: string, entry?: string | string[], fanOutThreshold?: number }} options
 * @returns {import('@code-pushup/models').PluginConfig}
 */
export default function couplingPlugin(options) {
  const { targetDir, entry = "src", fanOutThreshold = 15 } = options;
  const entries = resolveEntries(targetDir, entry).map((e) => e.replace(/\/$/, ""));
  // `includeOnly` accepts a regex string. Anchor each entry and OR them together.
  const includeOnly = `^(${entries.map((e) => e.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("|")})`;

  return {
    slug: "coupling",
    title: "Coupling",
    icon: "routing",
    description:
      "Module-level coupling metrics (fan-out) from dependency-cruiser. Identifies 'god files' that import too much.",
    audits: [
      {
        slug: "high-fan-out",
        title: `Files importing more than ${fanOutThreshold} modules`,
      },
    ],
    runner: async () => {
      // Graceful skip: when the target has no recognizable source entry —
      // no `src/` directory, no `plugins/<ws>/src/` workspaces, and no
      // user-supplied entry that exists on disk — there's nothing to
      // analyze. Emit a zero-violation audit rather than crashing
      // dependency-cruiser with ENOENT. Users can point at real sources
      // via `CP_ENTRY=plugins,lib` or similar.
      if (entries.length === 0) {
        return [
          {
            slug: "high-fan-out",
            title: `Files importing more than ${fanOutThreshold} modules`,
            score: 1,
            value: 0,
            displayValue: "skipped — no source entries found (set CP_ENTRY to override)",
            details: { issues: [] },
          },
        ];
      }

      // cruise() resolves tsconfig relative to process.cwd(). Target repos have
      // their own tsconfig; temporarily chdir so dependency-cruiser picks it up.
      const originalCwd = process.cwd();
      process.chdir(targetDir);
      let result;
      try {
        const { output } = await cruise(entries, {
          includeOnly,
          tsPreCompilationDeps: true,
          metrics: true,
          outputType: "json",
        });
        result = typeof output === "string" ? JSON.parse(output) : output;
      } finally {
        process.chdir(originalCwd);
      }
      const modules = result.modules ?? [];

      const violations = modules
        .map((m) => ({ file: m.source, fanOut: m.dependencies?.length ?? 0 }))
        .filter((m) => m.fanOut > fanOutThreshold)
        .sort((a, b) => b.fanOut - a.fanOut);

      const score = 1 - violations.length / Math.max(1, modules.length);
      const maxFanOut = Math.max(0, ...modules.map((m) => m.dependencies?.length ?? 0));

      return [
        {
          slug: "high-fan-out",
          title: `Files importing more than ${fanOutThreshold} modules`,
          score,
          value: violations.length,
          displayValue: `${violations.length} ${violations.length === 1 ? "file" : "files"} (max fan-out ${maxFanOut})`,
          details: {
            issues: violations.map((v) => ({
              source: { file: v.file },
              severity: v.fanOut > fanOutThreshold * 2 ? "error" : "warning",
              message: `imports ${v.fanOut} modules (threshold ${fanOutThreshold})`,
            })),
          },
        },
      ];
    },
  };
}
