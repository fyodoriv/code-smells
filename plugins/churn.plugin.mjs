/**
 * churn plugin
 *
 * Uses `simple-git` (Node API) to query per-file commit counts over a window.
 * High-churn files are correlated with bug density (Microsoft/Tornhill research).
 *
 * Audits:
 *   - file-churn — files changed more than N times in the window
 */
import simpleGit from "simple-git";

/**
 * @param {{ targetDir: string, days?: number, threshold?: number, pathFilter?: string[] }} options
 * @returns {import('@code-pushup/models').PluginConfig}
 */
export default function churnPlugin(options) {
  const {
    targetDir,
    days = 90,
    threshold = 5,
    pathFilter = ["*.ts", "*.tsx", "*.js", "*.jsx"],
  } = options;

  return {
    slug: "churn",
    title: "Churn",
    icon: "git",
    description: `File-change frequency over the last ${days} days. High-churn files are correlated with bug density.`,
    audits: [
      {
        slug: "file-churn",
        title: `Files changed more than ${threshold} times in ${days}d`,
      },
    ],
    runner: async () => {
      const git = simpleGit(targetDir);
      // `git log --since=<days>.days.ago --name-only --format= -- <patterns>`
      // produces a flat list of changed file paths (one per line, empty lines
      // between commits). Count occurrences per file to get churn.
      const output = await git
        .raw(["log", `--since=${days}.days.ago`, "--name-only", "--format=", "--", ...pathFilter])
        .catch(() => "");

      /** @type {Map<string, number>} */
      const counts = new Map();
      for (const line of output.split("\n")) {
        const file = line.trim();
        if (!file) continue;
        counts.set(file, (counts.get(file) ?? 0) + 1);
      }

      const entries = [...counts.entries()].map(([file, churn]) => ({ file, churn }));
      const violations = entries.filter((e) => e.churn > threshold);
      const totalFiles = entries.length || 1;
      const score = 1 - violations.length / totalFiles;
      const maxChurn = Math.max(0, ...entries.map((e) => e.churn));
      const sorted = violations.sort((a, b) => b.churn - a.churn);

      return [
        {
          slug: "file-churn",
          title: `Files changed more than ${threshold} times in ${days}d`,
          score,
          value: violations.length,
          displayValue: `${violations.length} high-churn ${violations.length === 1 ? "file" : "files"} (max ${maxChurn} commits)`,
          details: {
            issues: sorted.slice(0, 50).map((v) => ({
              source: { file: v.file },
              severity: v.churn > threshold * 2 ? "warning" : "info",
              message: `${v.churn} commits in last ${days}d (threshold ${threshold})`,
            })),
          },
        },
      ];
    },
  };
}
