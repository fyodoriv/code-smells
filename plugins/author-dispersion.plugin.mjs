/**
 * author-dispersion plugin
 *
 * Two ownership signals from git log (via simple-git):
 *   - author-count — distinct authors per file in the window (Nagappan 2007:
 *     >6 authors correlates with higher defect rate)
 *   - bus-factor — dominance of the top author (>= 80% of commits owned by
 *     one person → single-point-of-failure risk)
 */
import simpleGit from "simple-git";

/**
 * Parses `git log --name-only --pretty=format:'COMMIT|<author>'` output into
 * a flat list of (author, files) tuples per commit.
 */
const parseGitLog = (rawOutput) => {
  const commits = [];
  let current = null;

  for (const rawLine of rawOutput.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.startsWith("COMMIT|")) {
      if (current) commits.push(current);
      current = { author: line.slice("COMMIT|".length), files: [] };
    } else if (line && current) {
      current.files.push(line);
    }
  }
  if (current) commits.push(current);
  return commits;
};

/** Returns Map<file, Map<author, commitCount>>. */
const collectFileAuthorCounts = (commits) => {
  const perFile = new Map();
  for (const { author, files } of commits) {
    for (const f of files) {
      if (!perFile.has(f)) perFile.set(f, new Map());
      const authors = perFile.get(f);
      authors.set(author, (authors.get(author) ?? 0) + 1);
    }
  }
  return perFile;
};

/**
 * @param {{
 *   targetDir: string,
 *   days?: number,
 *   authorThreshold?: number,
 *   busFactorRatio?: number,
 *   minCommitsForBusFactor?: number,
 *   patterns?: string[]
 * }} options
 * @returns {import('@code-pushup/models').PluginConfig}
 */
export default function authorDispersionPlugin(options) {
  const {
    targetDir,
    days = 180,
    authorThreshold = 6,
    busFactorRatio = 0.8,
    minCommitsForBusFactor = 5,
    patterns = ["*.ts", "*.tsx", "*.js", "*.jsx"],
  } = options;

  return {
    slug: "author-dispersion",
    title: "Author dispersion",
    icon: "git",
    description: `Git-based ownership signals: distinct authors per file and top-author dominance over the last ${days} days.`,
    audits: [
      {
        slug: "author-count",
        title: `Files touched by more than ${authorThreshold} authors in ${days}d`,
      },
      {
        slug: "bus-factor",
        title: `Files where one author owns ≥ ${Math.round(busFactorRatio * 100)}% of commits`,
      },
    ],
    runner: async () => {
      const git = simpleGit(targetDir);
      const output = await git
        .raw([
          "log",
          `--since=${days}.days.ago`,
          "--name-only",
          "--pretty=format:COMMIT|%aN",
          "--",
          ...patterns,
        ])
        .catch(() => "");

      const commits = parseGitLog(output);
      const perFile = collectFileAuthorCounts(commits);
      const totalFiles = perFile.size || 1;

      const highDispersion = [...perFile.entries()]
        .map(([file, authors]) => ({
          file,
          authorCount: authors.size,
          totalCommits: [...authors.values()].reduce((a, b) => a + b, 0),
        }))
        .filter((x) => x.authorCount > authorThreshold)
        .sort((a, b) => b.authorCount - a.authorCount);

      const lowBusFactor = [...perFile.entries()]
        .map(([file, authors]) => {
          const counts = [...authors.values()];
          const total = counts.reduce((a, b) => a + b, 0);
          const topShare = Math.max(0, ...counts) / Math.max(1, total);
          const topAuthor = [...authors.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
          // authorCount gates out files with only one author in their
          // history. On solo/personal repos every file has 100% one-
          // author dominance by definition — reporting that as a bus-
          // factor risk is unactionable noise. Only files where >= 2
          // distinct authors have contributed can meaningfully have
          // "low" vs "high" bus factor.
          return { file, topShare, topAuthor, totalCommits: total, authorCount: authors.size };
        })
        .filter(
          (x) =>
            x.totalCommits >= minCommitsForBusFactor &&
            x.authorCount > 1 &&
            x.topShare >= busFactorRatio,
        )
        .sort((a, b) => b.topShare - a.topShare);

      const maxAuthors = Math.max(0, ...[...perFile.values()].map((a) => a.size));

      return [
        {
          slug: "author-count",
          title: `Files touched by more than ${authorThreshold} authors in ${days}d`,
          score: 1 - highDispersion.length / totalFiles,
          value: highDispersion.length,
          displayValue: `${highDispersion.length} ${highDispersion.length === 1 ? "file" : "files"} (max ${maxAuthors} authors)`,
          details: {
            issues: highDispersion.slice(0, 50).map((v) => ({
              source: { file: v.file },
              severity: v.authorCount > authorThreshold * 1.5 ? "error" : "warning",
              message: `${v.authorCount} distinct authors across ${v.totalCommits} commits (threshold ${authorThreshold})`,
            })),
          },
        },
        {
          slug: "bus-factor",
          title: `Files where one author owns ≥ ${Math.round(busFactorRatio * 100)}% of commits`,
          score: 1 - lowBusFactor.length / totalFiles,
          value: lowBusFactor.length,
          displayValue: `${lowBusFactor.length} ${lowBusFactor.length === 1 ? "file" : "files"} with single-author dominance`,
          details: {
            issues: lowBusFactor.slice(0, 50).map((v) => ({
              source: { file: v.file },
              severity: "warning",
              message: `${v.topAuthor} owns ${Math.round(v.topShare * 100)}% of ${v.totalCommits} commits`,
            })),
          },
        },
      ];
    },
  };
}
