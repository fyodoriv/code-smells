/**
 * team-ownership plugin
 *
 * Nagappan et al. 2007 "Using Software Dependencies and Churn Metrics to
 * Predict Field Failures" showed that files changed by more than 2 teams
 * have 2–3× higher defect rate than single-team files. Counts teams via
 * the target repo's CODEOWNERS — a file's owning team is well-defined,
 * but the set of teams that *touch* a file (via commits that cross team
 * boundaries) is the actual predictive signal.
 *
 * Complements the per-author `author-dispersion` plugin: this one counts
 * team-level dispersion, which filters out intra-team co-authorship noise
 * and surfaces genuine cross-team coupling.
 *
 * Two audits:
 *   - `cross-team-churn` — files appearing in N+ commits that touched
 *     multiple CODEOWNERS teams. Weighted by commit count.
 *   - `team-count-per-file` — max number of distinct teams that appeared
 *     alongside this file in any single commit.
 *
 * Gracefully no-ops when the target has no CODEOWNERS file (both at root
 * and under `.github/`, per the codeowners spec).
 */
import { loadOwners, matchFile } from "codeowners-utils";
import simpleGit from "simple-git";

/** Parse `git log --name-only --format=tformat:>>>` into per-commit file lists. */
const parseCommits = (raw) => {
  const commits = [];
  let current = [];
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (line === ">>>") {
      if (current.length > 0) commits.push(current);
      current = [];
    } else if (line) {
      current.push(line);
    }
  }
  if (current.length > 0) commits.push(current);
  return commits;
};

/** Owning team for a file (first matched owner, or null if no match). */
const teamForFile = (file, rules) => matchFile(file, rules)?.owners?.[0] ?? null;

/**
 * @param {{ targetDir: string, days?: number, crossTeamThreshold?: number, teamsPerCommitThreshold?: number, patterns?: string[] }} options
 * @returns {Promise<import('@code-pushup/models').PluginConfig>}
 */
export default async function teamOwnershipPlugin(options) {
  const {
    targetDir,
    days = 180,
    crossTeamThreshold = 3,
    teamsPerCommitThreshold = 2,
    patterns = ["*.ts", "*.tsx", "*.js", "*.jsx"],
    // Drop stories and spec files — they track their component, so a single
    // Storybook or testing-library bump sweeps every team's stories/specs
    // at once and adds cross-team noise without real cross-team signal.
    excludePatterns = /\.(spec|test|stories)\.[tj]sx?$|(^|\/)test\/|(^|\/)__tests__\/|(^|\/)\.storybook\//,
  } = options;

  // Load CODEOWNERS once up-front. If missing, the plugin still registers but
  // reports zero issues (score 1) so it doesn't break the category.
  let rules = [];
  try {
    rules = await loadOwners(targetDir);
  } catch {
    rules = [];
  }
  const hasCodeowners = rules.length > 0;

  return {
    slug: "team-ownership",
    title: "Team ownership",
    icon: "log",
    description: hasCodeowners
      ? `Files touched by commits crossing ${teamsPerCommitThreshold}+ CODEOWNERS teams (Nagappan 2007 predictor). ${days}d window.`
      : "Team ownership dispersion — no CODEOWNERS file found in target, audit reports zero issues.",
    audits: [
      {
        slug: "cross-team-churn",
        title: `Files appearing in > ${crossTeamThreshold} multi-team commits in ${days}d`,
      },
      {
        slug: "team-count-per-file",
        title: `Files co-touched with > ${teamsPerCommitThreshold} other teams in a single commit`,
      },
    ],
    runner: async () => {
      if (!hasCodeowners) {
        return ["cross-team-churn", "team-count-per-file"].map((slug) => ({
          slug,
          title: slug,
          score: 1,
          value: 0,
          displayValue: "no CODEOWNERS file in target",
          details: { issues: [] },
        }));
      }

      const git = simpleGit(targetDir);
      const raw = await git
        .raw([
          "log",
          `--since=${days}.days.ago`,
          "--name-only",
          "--format=tformat:>>>",
          "--",
          ...patterns,
        ])
        .catch(() => "");

      /** @type {Map<string, number>} */
      const crossTeamCommits = new Map(); // file -> count of multi-team commits it appears in
      /** @type {Map<string, number>} */
      const maxTeamsWith = new Map(); // file -> max distinct other-teams in any single commit

      for (const files of parseCommits(raw)) {
        const filtered = files.filter((f) => !excludePatterns.test(f));
        if (filtered.length < 2) continue;

        const fileTeams = new Map();
        for (const f of new Set(filtered)) {
          const team = teamForFile(f, rules);
          if (team) fileTeams.set(f, team);
        }
        const allTeams = new Set(fileTeams.values());
        if (allTeams.size <= teamsPerCommitThreshold) continue;

        for (const [file, ownTeam] of fileTeams) {
          crossTeamCommits.set(file, (crossTeamCommits.get(file) ?? 0) + 1);
          const otherTeams = new Set([...allTeams].filter((t) => t !== ownTeam));
          const prev = maxTeamsWith.get(file) ?? 0;
          if (otherTeams.size > prev) maxTeamsWith.set(file, otherTeams.size);
        }
      }

      const churnEntries = [...crossTeamCommits.entries()]
        .map(([file, count]) => ({ file, count }))
        .filter((e) => e.count > crossTeamThreshold)
        .sort((a, b) => b.count - a.count);

      const teamCountEntries = [...maxTeamsWith.entries()]
        .map(([file, count]) => ({ file, count }))
        .filter((e) => e.count > teamsPerCommitThreshold)
        .sort((a, b) => b.count - a.count);

      const churnScore = 1 - churnEntries.length / Math.max(1, crossTeamCommits.size);
      const teamCountScore = 1 - teamCountEntries.length / Math.max(1, maxTeamsWith.size);
      const maxChurn = churnEntries[0]?.count ?? 0;
      const maxTeamCount = teamCountEntries[0]?.count ?? 0;

      return [
        {
          slug: "cross-team-churn",
          title: `Files appearing in > ${crossTeamThreshold} multi-team commits in ${days}d`,
          score: churnScore,
          value: churnEntries.length,
          displayValue: `${churnEntries.length} ${churnEntries.length === 1 ? "file" : "files"} (max ${maxChurn} multi-team commits)`,
          details: {
            issues: churnEntries.slice(0, 50).map((v) => ({
              source: { file: v.file },
              severity: v.count > crossTeamThreshold * 2 ? "error" : "warning",
              message: `${v.count} commits crossing ${teamsPerCommitThreshold}+ CODEOWNERS teams in last ${days}d`,
            })),
          },
        },
        {
          slug: "team-count-per-file",
          title: `Files co-touched with > ${teamsPerCommitThreshold} other teams in a single commit`,
          score: teamCountScore,
          value: teamCountEntries.length,
          displayValue: `${teamCountEntries.length} ${teamCountEntries.length === 1 ? "file" : "files"} (max ${maxTeamCount} co-teams)`,
          details: {
            issues: teamCountEntries.slice(0, 50).map((v) => ({
              source: { file: v.file },
              severity: v.count > teamsPerCommitThreshold * 2 ? "error" : "warning",
              message: `appeared alongside ${v.count} other teams' files in a single commit`,
            })),
          },
        },
      ];
    },
  };
}
