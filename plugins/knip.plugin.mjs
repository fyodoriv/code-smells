/**
 * knip plugin
 *
 * Wraps `knip` to detect dead code: unused files, unused exports, unresolved
 * imports, unlisted dependencies. No off-the-shelf code-pushup plugin for this
 * — wrapping the CLI is the shortest path to the JSON reporter output.
 *
 * Audits:
 *   - unused-files            — files not reachable from any entry point
 *   - unused-exports          — exports that nothing imports
 *   - unresolved-imports      — imports that can't be resolved
 *   - unlisted-dependencies   — imports not declared in package.json
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);

/**
 * Resolve `knip`'s executable JS file. knip's package.json uses an
 * "exports" field that doesn't expose ./package.json as a subpath, so
 * we can't `require.resolve("knip/package.json")`. Walk up from the
 * resolved main entry instead to find the package root.
 */
const resolveKnipBinJs = () => {
  let dir = dirname(require.resolve("knip"));
  while (dir !== dirname(dir)) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (pkg.name === "knip") {
        const binEntry = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.knip;
        return resolve(dir, binEntry);
      }
    }
    dir = dirname(dir);
  }
  throw new Error("Could not locate knip package root");
};

/**
 * @param {{ targetDir: string }} options
 * @returns {import('@code-pushup/models').PluginConfig}
 */
export default function knipPlugin({ targetDir }) {
  return {
    slug: "knip",
    title: "Dead code (knip)",
    icon: "typescript",
    description:
      "knip detects unused files, unused exports, unresolved imports, and unlisted dependencies.",
    audits: [
      { slug: "unused-files", title: "Unused files" },
      { slug: "unused-exports", title: "Unused exports" },
      { slug: "unresolved-imports", title: "Unresolved imports" },
      { slug: "unlisted-dependencies", title: "Unlisted dependencies" },
    ],
    runner: async () => {
      const binJs = resolveKnipBinJs();
      const result = spawnSync(
        process.execPath,
        [binJs, "--reporter", "json", "--no-exit-code"],
        { cwd: targetDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      );
      // knip exits 0 with --no-exit-code. stdout is JSON.
      if (!result.stdout?.trim()) {
        // Most likely no knip config + auto-detection found nothing useful.
        // Return empty audits rather than failing.
        return [
          auditFor("unused-files", [], "files"),
          auditFor("unused-exports", [], "exports"),
          auditFor("unresolved-imports", [], "imports"),
          auditFor("unlisted-dependencies", [], "dependencies"),
        ];
      }
      const report = JSON.parse(result.stdout);

      // knip JSON shape: { files: string[], issues: { <file>: { exports: [...], ... } } }
      const unusedFiles = report.files ?? [];
      const unusedExports = flattenExports(report.issues, "exports");
      const unresolvedImports = flattenExports(report.issues, "unresolved");
      const unlistedDeps = flattenExports(report.issues, "unlisted");

      return [
        auditFor("unused-files", unusedFiles.map((f) => ({ file: f, message: "unused file" })), "files"),
        auditFor("unused-exports", unusedExports, "exports"),
        auditFor("unresolved-imports", unresolvedImports, "imports"),
        auditFor("unlisted-dependencies", unlistedDeps, "dependencies"),
      ];
    },
  };
}

/** Flatten knip's per-file issues for a given issue type into a flat list. */
const flattenExports = (issues, key) => {
  if (!issues) return [];
  const out = [];
  for (const [file, fileIssues] of Object.entries(issues)) {
    const items = fileIssues?.[key];
    if (!items) continue;
    const list = Array.isArray(items) ? items : Object.values(items);
    for (const item of list) {
      out.push({
        file,
        line: item.line ?? item.pos ?? 1,
        message: item.name ?? item.symbol ?? String(item),
      });
    }
  }
  return out;
};

const auditFor = (slug, items, unit) => ({
  slug,
  title: slug,
  score: items.length === 0 ? 1 : Math.max(0, 1 - items.length / 200),
  value: items.length,
  displayValue: `${items.length} ${items.length === 1 ? unit.slice(0, -1) : unit}`,
  details: {
    issues: items.slice(0, 50).map((i) => ({
      source: { file: i.file, position: { startLine: i.line ?? 1 } },
      severity: "warning",
      message: i.message ?? "",
    })),
  },
});
