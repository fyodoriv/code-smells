/**
 * duplication plugin
 *
 * Runs jscpd on the target and emits a duplication audit. jscpd already
 * reports clones with line-level positions; we pass those through as issues.
 *
 * Audits:
 *   - duplicated-lines — total lines of duplicated code in the repo
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pluginRoot = dirname(fileURLToPath(import.meta.url));
const toolRoot = dirname(pluginRoot);

/**
 * Resolve jscpd's executable JS file. jscpd's package.json uses an
 * "exports" field that doesn't expose ./package.json as a subpath, so
 * we can't `require.resolve("jscpd/package.json")`. Walk up from the
 * resolved main entry instead to find the package root.
 */
const resolveJscpdBinJs = () => {
  let dir = dirname(require.resolve("jscpd"));
  while (dir !== dirname(dir)) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (pkg.name === "jscpd") {
        const binEntry = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.jscpd;
        return resolve(dir, binEntry);
      }
    }
    dir = dirname(dir);
  }
  throw new Error("Could not locate jscpd package root");
};

const runJscpd = ({ targetDir, patterns, ignore, outputDir }) => {
  const binJs = resolveJscpdBinJs();
  const args = [
    binJs,
    "--silent",
    "--reporters",
    "json",
    "--output",
    outputDir,
    "--pattern",
    patterns,
  ];
  if (ignore.length > 0) {
    args.push("--ignore", ignore.join(","));
  }
  args.push(".");
  spawnSync(process.execPath, args, {
    cwd: targetDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
};

/**
 * @param {{
 *   targetDir: string,
 *   patterns?: string,
 *   ignore?: string[],
 *   thresholdLines?: number
 * }} options
 * @returns {import('@code-pushup/models').PluginConfig}
 */
export default function duplicationPlugin(options) {
  const {
    targetDir,
    patterns = "**/src/**/*.{ts,tsx,js,jsx}",
    ignore = ["**/node_modules/**", "**/dist/**", "**/__generated__/**", "**/generated/**"],
    thresholdLines = 500,
  } = options;

  return {
    slug: "duplication",
    title: "Duplication",
    icon: "search",
    description: "Total duplicated lines of code detected by jscpd.",
    audits: [
      {
        slug: "duplicated-lines",
        title: "Duplicated lines of code",
      },
    ],
    runner: async () => {
      const outputDir = join(toolRoot, "reports", ".jscpd");
      rmSync(outputDir, { recursive: true, force: true });
      mkdirSync(outputDir, { recursive: true });

      runJscpd({ targetDir, patterns, ignore, outputDir });

      const reportPath = join(outputDir, "jscpd-report.json");
      let totalDupLines = 0;
      const perFile = new Map();
      const duplicates = [];

      if (existsSync(reportPath)) {
        const rep = JSON.parse(readFileSync(reportPath, "utf8"));
        for (const dup of rep.duplicates ?? []) {
          const firstFile = dup.firstFile?.name
            ? relative(targetDir, resolve(targetDir, dup.firstFile.name))
            : null;
          const secondFile = dup.secondFile?.name
            ? relative(targetDir, resolve(targetDir, dup.secondFile.name))
            : null;
          const lines = Math.max(
            0,
            (dup.firstFile?.end ?? 0) - (dup.firstFile?.start ?? 0),
          );
          totalDupLines += lines;
          duplicates.push({ firstFile, secondFile, lines });
          for (const f of [firstFile, secondFile]) {
            if (!f) continue;
            perFile.set(f, (perFile.get(f) ?? 0) + lines);
          }
        }
      }

      // Score: linear decay from 0 violations → 1.0 down to threshold → 0.0
      const score = Math.max(0, 1 - totalDupLines / thresholdLines);

      const issues = [...perFile.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50)
        .map(([file, lines]) => {
          const pair = duplicates.find(
            (d) => (d.firstFile === file && d.secondFile) || (d.secondFile === file && d.firstFile),
          );
          const counterpart = pair
            ? pair.firstFile === file
              ? pair.secondFile
              : pair.firstFile
            : null;
          return {
            source: { file },
            severity: lines > 50 ? "error" : lines > 20 ? "warning" : "info",
            message: counterpart
              ? `${lines} duplicated lines (paired with ${counterpart})`
              : `${lines} duplicated lines`,
          };
        });

      return [
        {
          slug: "duplicated-lines",
          title: "Duplicated lines of code",
          score,
          value: totalDupLines,
          displayValue: `${totalDupLines} duplicated lines across ${perFile.size} files`,
          details: { issues },
        },
      ];
    },
  };
}
