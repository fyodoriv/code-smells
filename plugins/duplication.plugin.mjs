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
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = dirname(fileURLToPath(import.meta.url));
const toolRoot = dirname(pluginRoot);

const runJscpd = ({ targetDir, patterns, ignore, outputDir }) => {
  const bin = join(toolRoot, "node_modules/.bin/jscpd");
  const args = [
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
  spawnSync(bin, args, {
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
