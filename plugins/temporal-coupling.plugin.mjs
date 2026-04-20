/**
 * temporal-coupling plugin
 *
 * From Adam Tornhill's "Software Design X-Rays" — files that consistently
 * change in the same commits but have no declared import edge between them
 * reveal hidden state-sharing, copy-paste drift, or implicit coordination.
 *
 * Algorithm:
 *   1. Walk `git log --name-only` for the last N days, collect the set of
 *      files changed in each commit.
 *   2. Build a co-change count map: for every unordered pair (A, B) changed
 *      together in a commit, increment count[A,B]. Track per-file commit
 *      count too.
 *   3. For each pair, co-change rate = count[A,B] / min(count[A], count[B]).
 *   4. Run dependency-cruiser to build the set of declared import edges
 *      between source files.
 *   5. Report pairs with co-change rate above `coChangeThreshold` that have
 *      NO declared import edge.
 *
 * Skips commits that touch too many files (default 20) — these are bulk
 * renames, codemods, and formatter runs that add noise without signal.
 *
 * No maintained npm package implements this; code-maat is the JVM reference.
 * ~130 lines, justified under VISION.md boundaries as a genuinely-new signal.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { cruise } from "dependency-cruiser";
import simpleGit from "simple-git";

/** Canonical key for an unordered pair of strings. */
const pairKey = (a, b) => (a < b ? `${a}::${b}` : `${b}::${a}`);

/** Parse `git log --name-only --format='>>>'` output into an array of commit file-sets. */
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

/** Build the set of declared import edges via dependency-cruiser. Returns a Set of "source::target" keys. */
const buildImportEdges = async (targetDir, entries) => {
  const originalCwd = process.cwd();
  process.chdir(targetDir);
  try {
    const { output } = await cruise(entries, {
      tsPreCompilationDeps: true,
      outputType: "json",
    });
    const result = typeof output === "string" ? JSON.parse(output) : output;
    const edges = new Set();
    for (const mod of result.modules ?? []) {
      for (const dep of mod.dependencies ?? []) {
        edges.add(pairKey(mod.source, dep.resolved));
      }
    }
    return edges;
  } finally {
    process.chdir(originalCwd);
  }
};

/** Auto-detect workspace src directories for monorepos, same pattern as coupling plugin. */
const resolveEntries = (targetDir) => {
  if (existsSync(join(targetDir, "src"))) return ["src"];
  const workspaces = [];
  for (const dir of ["plugins", "libs", "packages"]) {
    const root = join(targetDir, dir);
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const rel = join(dir, name, "src");
      if (existsSync(join(targetDir, rel)) && statSync(join(targetDir, rel)).isDirectory()) {
        workspaces.push(rel);
      }
    }
  }
  return workspaces.length > 0 ? workspaces : ["src"];
};

/**
 * @param {{ targetDir: string, days?: number, coChangeThreshold?: number, minPairCount?: number, maxFilesPerCommit?: number, patterns?: string[] }} options
 * @returns {import('@code-pushup/models').PluginConfig}
 */
export default function temporalCouplingPlugin(options) {
  const {
    targetDir,
    days = 90,
    coChangeThreshold = 0.3,
    minPairCount = 3,
    maxFilesPerCommit = 20,
    patterns = ["*.ts", "*.tsx", "*.js", "*.jsx"],
    // Drop test/spec/story files — they track their source file by design,
    // and that always-pairs noise would drown out real hidden-coupling signal.
    excludePatterns = /\.(spec|test|stories)\.[tj]sx?$|(^|\/)test\/|(^|\/)__tests__\//,
  } = options;

  const thresholdPct = Math.round(coChangeThreshold * 100);

  return {
    slug: "temporal-coupling",
    title: "Temporal coupling",
    icon: "routing",
    description: `File pairs that co-change together but have no declared import edge (Tornhill). Co-change threshold ${thresholdPct}%; window ${days}d.`,
    audits: [
      {
        slug: "hidden-coupling",
        title: `File pairs co-changing > ${thresholdPct}% with no import edge`,
      },
    ],
    runner: async () => {
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

      const commits = parseCommits(raw)
        .map((files) => files.filter((f) => !excludePatterns.test(f)))
        .filter((files) => files.length > 1 && files.length <= maxFilesPerCommit);

      /** @type {Map<string, number>} */
      const fileCount = new Map();
      /** @type {Map<string, number>} */
      const pairCount = new Map();

      for (const files of commits) {
        const unique = [...new Set(files)];
        for (const f of unique) fileCount.set(f, (fileCount.get(f) ?? 0) + 1);
        for (let i = 0; i < unique.length; i++) {
          for (let j = i + 1; j < unique.length; j++) {
            const key = pairKey(unique[i], unique[j]);
            pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
          }
        }
      }

      // Build import-edge set. If cruise fails (missing files, misconfigured
      // tsconfig), treat import edges as empty — we'll overreport rather than
      // silently drop the audit.
      let importEdges = new Set();
      try {
        importEdges = await buildImportEdges(targetDir, resolveEntries(targetDir));
      } catch {
        importEdges = new Set();
      }

      const violations = [];
      for (const [key, together] of pairCount) {
        if (together < minPairCount) continue;
        const [a, b] = key.split("::");
        const minCount = Math.min(fileCount.get(a) ?? 1, fileCount.get(b) ?? 1);
        const rate = together / minCount;
        if (rate < coChangeThreshold) continue;
        if (importEdges.has(key)) continue; // explained by a real import
        violations.push({ a, b, together, rate });
      }
      violations.sort((v1, v2) => v2.rate - v1.rate || v2.together - v1.together);

      const totalPairs = pairCount.size || 1;
      const score = 1 - violations.length / totalPairs;
      const maxRate = violations[0]?.rate ?? 0;

      return [
        {
          slug: "hidden-coupling",
          title: `File pairs co-changing > ${thresholdPct}% with no import edge`,
          score,
          value: violations.length,
          displayValue: `${violations.length} ${violations.length === 1 ? "pair" : "pairs"} (max ${Math.round(maxRate * 100)}% co-change)`,
          details: {
            issues: violations.slice(0, 50).map((v) => ({
              source: { file: v.a },
              severity: v.rate > coChangeThreshold * 2 ? "error" : "warning",
              message: `co-changes ${Math.round(v.rate * 100)}% with ${v.b} (${v.together} times in ${days}d); no declared import`,
            })),
          },
        },
      ];
    },
  };
}
