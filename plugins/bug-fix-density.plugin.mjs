/**
 * bug-fix-density plugin
 *
 * Counts fix/hotfix/revert commits per file in a rolling window. Lagging
 * defect indicator complementing churn. Uses simple-git for the log query.
 */
import simpleGit from "simple-git";

const FIX_COMMIT_PATTERN = "^(fix|hotfix|revert)(\\([^)]*\\))?:";

/**
 * @param {{ targetDir: string, days?: number, threshold?: number, patterns?: string[] }} options
 * @returns {import('@code-pushup/models').PluginConfig}
 */
export default function bugFixDensityPlugin(options) {
  const {
    targetDir,
    days = 180,
    threshold = 3,
    patterns = ["*.ts", "*.tsx", "*.js", "*.jsx"],
  } = options;

  return {
    slug: "bug-fix-density",
    title: "Bug-fix density",
    icon: "log",
    description: `Count of fix/hotfix/revert commits per file over the last ${days} days. High density = historically defect-prone.`,
    audits: [
      {
        slug: "bug-fix-density",
        title: `Files with more than ${threshold} fix commits in ${days}d`,
      },
    ],
    runner: async () => {
      const git = simpleGit(targetDir);
      const output = await git
        .raw([
          "log",
          `--since=${days}.days.ago`,
          "--extended-regexp",
          `--grep=${FIX_COMMIT_PATTERN}`,
          "--name-only",
          "--format=",
          "--",
          ...patterns,
        ])
        .catch(() => "");

      /** @type {Map<string, number>} */
      const counts = new Map();
      for (const line of output.split("\n")) {
        const file = line.trim();
        if (!file) continue;
        counts.set(file, (counts.get(file) ?? 0) + 1);
      }

      const entries = [...counts.entries()].map(([file, fixCount]) => ({ file, fixCount }));
      const violations = entries.filter((e) => e.fixCount > threshold);
      const totalFiles = entries.length || 1;
      const score = 1 - violations.length / totalFiles;
      const maxFixes = Math.max(0, ...entries.map((e) => e.fixCount));
      const sorted = violations.sort((a, b) => b.fixCount - a.fixCount);

      return [
        {
          slug: "bug-fix-density",
          title: `Files with more than ${threshold} fix commits in ${days}d`,
          score,
          value: violations.length,
          displayValue: `${violations.length} high-defect ${violations.length === 1 ? "file" : "files"} (max ${maxFixes} fixes)`,
          details: {
            issues: sorted.slice(0, 50).map((v) => ({
              source: { file: v.file },
              severity: v.fixCount > threshold * 2 ? "error" : "warning",
              message: `${v.fixCount} fix/hotfix/revert commits in last ${days}d (threshold ${threshold})`,
            })),
          },
        },
      ];
    },
  };
}
