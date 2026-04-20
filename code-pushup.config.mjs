/**
 * code-pushup.config.mjs
 *
 * Target repo is read from the CP_TARGET environment variable (defaults to the
 * current working directory). One config file works against any repo:
 *
 *   CP_TARGET=/path/to/repo npx code-pushup collect
 *
 * Plugins (6 plugins):
 *   Component shape + render signals:
 *     - @code-pushup/eslint-plugin  — runs our opinionated ESLint config against
 *       target source files. Covers what react-complexity and render-signals
 *       custom plugins used to do, plus cognitive complexity.
 *   Coupling & code-level quality:
 *     - coupling     (dependency-cruiser programmatic API — fan-out)
 *     - duplication  (jscpd CLI — duplicated lines)
 *   Historical / process signals (git log):
 *     - churn, bug-fix-density, author-dispersion
 */
/**
 * code-pushup.config.mjs
 *
 * Target repo is read from the CP_TARGET environment variable (defaults to
 * the current working directory). One config works against any repo:
 *
 *   CP_TARGET=/path/to/repo npx code-pushup collect
 *
 * Plugins:
 *   - eslint       — our thin wrapper over ESLint's Node API. Drives all
 *                    component-shape and render-signal audits from flat-
 *                    config rules (react-perf, sonarjs, max-lines-per-function,
 *                    custom gap-fillers).
 *   - typescript   — @code-pushup/typescript-plugin. TS compiler diagnostics.
 *   - js-packages  — @code-pushup/js-packages-plugin. npm audit + outdated.
 *   - jsdocs       — @code-pushup/jsdocs-plugin. Documentation coverage.
 *   - coupling     — dependency-cruiser programmatic API (fan-out)
 *   - duplication  — jscpd CLI (duplicated lines)
 *   - churn, bug-fix-density, author-dispersion — git log
 *
 * Official plugins skip gracefully when their inputs don't exist (e.g. no
 * tsconfig in target, no lockfile) — we detect missing inputs upfront.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import coveragePlugin from "@code-pushup/coverage-plugin";
import jsPackagesPlugin from "@code-pushup/js-packages-plugin";
import jsdocsPlugin from "@code-pushup/jsdocs-plugin";
import typescriptPlugin from "@code-pushup/typescript-plugin";

import authorDispersionPlugin from "./plugins/author-dispersion.plugin.mjs";
import bugFixDensityPlugin from "./plugins/bug-fix-density.plugin.mjs";
import churnPlugin from "./plugins/churn.plugin.mjs";
import couplingPlugin from "./plugins/coupling.plugin.mjs";
import duplicationPlugin from "./plugins/duplication.plugin.mjs";
import eslintPlugin from "./plugins/eslint.plugin.mjs";
import knipPlugin from "./plugins/knip.plugin.mjs";
import teamOwnershipPlugin from "./plugins/team-ownership.plugin.mjs";
import temporalCouplingPlugin from "./plugins/temporal-coupling.plugin.mjs";
import typeCoveragePlugin from "./plugins/type-coverage.plugin.mjs";

const toolRoot = resolve(new URL(".", import.meta.url).pathname);
const targetDir = resolve(process.env.CP_TARGET ?? process.cwd());
const patterns = process.env.CP_PATTERNS ?? "src/**/*.{ts,tsx}";

// Conditional plugin registration — only add plugins whose required inputs exist.
const hasTsconfig = existsSync(resolve(targetDir, "tsconfig.json"));
const hasLockfile =
  existsSync(resolve(targetDir, "yarn.lock")) ||
  existsSync(resolve(targetDir, "package-lock.json")) ||
  existsSync(resolve(targetDir, "pnpm-lock.yaml"));

// Coverage plugin: look at CP_COVERAGE_LCOV env or common default paths.
const coverageLcovPath =
  process.env.CP_COVERAGE_LCOV && resolve(targetDir, process.env.CP_COVERAGE_LCOV);
const defaultLcovCandidates = [
  "coverage/lcov.info",
  "reports/coverage/lcov.info",
  "coverage/unit/lcov.info",
];
const lcovPath =
  coverageLcovPath && existsSync(coverageLcovPath)
    ? coverageLcovPath
    : defaultLcovCandidates.map((p) => resolve(targetDir, p)).find((p) => existsSync(p));

/**
 * Resolve the tsconfig(s) the typescript plugin should analyze.
 *
 * Monorepo support: if the root tsconfig is a project-references file (has
 * `references: [...]` and no `include`/`files`), the typescript-plugin can't
 * use it directly — it would error "No files matched by the TypeScript
 * configuration." Expand the references into an explicit array of concrete
 * per-workspace tsconfigs, which the typescript-plugin handles natively via
 * its `tsconfig: string[]` option.
 *
 * If CP_TSCONFIG is set, it wins (comma-separated list supported). Otherwise
 * auto-detect reference-based roots.
 */
const resolveTsconfigInputs = (rootTsconfigPath) => {
  if (process.env.CP_TSCONFIG) {
    return process.env.CP_TSCONFIG.split(",").map((p) => resolve(targetDir, p.trim())).filter(Boolean);
  }
  try {
    // Strip comments from tsconfig before parsing — TS allows // and /* */.
    const raw = readFileSync(rootTsconfigPath, "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    const cfg = JSON.parse(raw);
    const hasReferences = Array.isArray(cfg.references) && cfg.references.length > 0;
    const definesFiles =
      (Array.isArray(cfg.files) && cfg.files.length > 0) ||
      (Array.isArray(cfg.include) && cfg.include.length > 0);
    if (hasReferences && !definesFiles) {
      return cfg.references
        .map((ref) => resolve(dirname(rootTsconfigPath), ref.path))
        .map((p) => (p.endsWith(".json") ? p : resolve(p, "tsconfig.json")))
        .filter((p) => existsSync(p));
    }
  } catch (err) {
    // Malformed or missing tsconfig — fall through to single-path default.
  }
  return [rootTsconfigPath];
};

const officialPlugins = [];
if (hasTsconfig) {
  const tsconfigs = resolveTsconfigInputs(resolve(targetDir, "tsconfig.json"));
  officialPlugins.push(typescriptPlugin({ tsconfig: tsconfigs }));
}
if (hasLockfile) {
  officialPlugins.push(jsPackagesPlugin());
}
officialPlugins.push(jsdocsPlugin({ patterns: [resolve(targetDir, patterns)] }));
if (lcovPath) {
  officialPlugins.push(coveragePlugin({ reports: [lcovPath] }));
}

/** @type {import('@code-pushup/models').CoreConfig} */
const resolvedPlugins = [
  await eslintPlugin({
    targetDir,
    eslintrc: resolve(toolRoot, "eslint.target-rules.mjs"),
    patterns: [patterns],
  }),
  ...(await Promise.all(officialPlugins)),
  couplingPlugin({ targetDir, entry: process.env.CP_ENTRY ?? "src", fanOutThreshold: 15 }),
  duplicationPlugin({ targetDir }),
  knipPlugin({ targetDir }),
  ...(hasTsconfig ? [typeCoveragePlugin({ targetDir })] : []),
  churnPlugin({ targetDir, days: 90, threshold: 5 }),
  bugFixDensityPlugin({ targetDir, days: 180, threshold: 3 }),
  authorDispersionPlugin({ targetDir, days: 180, authorThreshold: 6 }),
  temporalCouplingPlugin({ targetDir, days: 90, coChangeThreshold: 0.3, minPairCount: 3 }),
  await teamOwnershipPlugin({ targetDir, days: 180, crossTeamThreshold: 3, teamsPerCommitThreshold: 2 }),
];

/**
 * Declarative category definitions — list every audit we care about.
 * At the bottom we filter these to drop refs pointing at plugins that
 * didn't actually register (e.g. typescript plugin skipped because the
 * target has no tsconfig, js-packages plugin skipped because no lockfile).
 * Without this filter, code-pushup throws SchemaValidationError at config
 * load time when any referenced plugin is missing.
 */
const declaredCategories = [
  {
    slug: "component-health",
    title: "Component Health",
    description:
      "React component shape: body size, multi-component files, cognitive and cyclomatic complexity, hook overload.",
    refs: [
      { type: "audit", plugin: "eslint", slug: "max-lines-per-function-c6b359edbd4c4da7", weight: 2 },
      { type: "audit", plugin: "eslint", slug: "react-no-multi-comp-1125dd5c4c2da7c8", weight: 1 },
      { type: "audit", plugin: "eslint", slug: "sonarjs-cognitive-complexity-b091472019f97d9b", weight: 3 },
      { type: "audit", plugin: "eslint", slug: "sonarjs-cyclomatic-complexity-7c799240e8c0bc4a", weight: 1 },
      { type: "audit", plugin: "eslint", slug: "code-smells-hook-count-7c799240e8c0bc4a", weight: 2 },
      { type: "audit", plugin: "eslint", slug: "code-smells-use-effect-count-a16d575fb0debb40", weight: 3 },
    ],
  },
  {
    slug: "render-performance",
    title: "Render Performance",
    description:
      "Static proxy for re-render cost: inline props and unstable selectors. Community ESLint rules (react-perf, jsx-no-bind) + one custom rule for useSelector stability.",
    refs: [
      { type: "audit", plugin: "eslint", slug: "react-perf-jsx-no-new-function-as-prop", weight: 1 },
      { type: "audit", plugin: "eslint", slug: "react-perf-jsx-no-new-object-as-prop", weight: 1 },
      { type: "audit", plugin: "eslint", slug: "react-perf-jsx-no-new-array-as-prop", weight: 1 },
      { type: "audit", plugin: "eslint", slug: "react-jsx-no-bind-5e6d9af7de4ef766", weight: 1 },
      { type: "audit", plugin: "eslint", slug: "code-smells-unstable-selector-returns", weight: 3 },
    ],
  },
  {
    slug: "coupling",
    title: "Coupling",
    description: "Files with too many imports (syntactic fan-out), files referencing too many domain categories (semantic fan-out across modules/features — opt-in via domain-boundaries), and file pairs that co-change without a declared import edge (Tornhill hidden coupling).",
    refs: [
      { type: "audit", plugin: "coupling", slug: "high-fan-out", weight: 1 },
      { type: "audit", plugin: "eslint", slug: "code-smells-domain-boundaries-a16d575fb0debb40", weight: 2 },
      { type: "audit", plugin: "temporal-coupling", slug: "hidden-coupling", weight: 3 },
    ],
  },
  {
    slug: "type-safety",
    title: "Type Safety",
    description: "TypeScript compiler diagnostics + type-coverage (inferred-any measurement). Catches type issues beyond what `no-explicit-any` covers.",
    refs: [
      { type: "audit", plugin: "typescript", slug: "semantic-errors", weight: 3 },
      { type: "audit", plugin: "typescript", slug: "syntax-errors", weight: 2 },
      { type: "audit", plugin: "typescript", slug: "no-implicit-any-errors", weight: 2 },
      { type: "audit", plugin: "typescript", slug: "configuration-errors", weight: 1 },
      { type: "audit", plugin: "type-coverage", slug: "type-coverage-percentage", weight: 3 },
    ],
  },
  {
    slug: "security",
    title: "Security & Dependencies",
    description: "npm audit vulnerabilities and outdated dependencies. Critical vulns weighted heavily; outdated is informational.",
    refs: [
      { type: "audit", plugin: "js-packages", slug: "npm-audit-prod", weight: 3 },
      { type: "audit", plugin: "js-packages", slug: "npm-audit-dev", weight: 2 },
      { type: "audit", plugin: "js-packages", slug: "npm-outdated-prod", weight: 1 },
      { type: "audit", plugin: "js-packages", slug: "npm-outdated-dev", weight: 0 },
    ],
  },
  {
    slug: "maintainability",
    title: "Maintainability",
    description:
      "Lagging signals correlated with bug density: duplicated code, churn, bug-fix density, ownership dispersion, dead code.",
    refs: [
      { type: "audit", plugin: "duplication", slug: "duplicated-lines", weight: 1 },
      { type: "audit", plugin: "churn", slug: "file-churn", weight: 1 },
      { type: "audit", plugin: "bug-fix-density", slug: "bug-fix-density", weight: 3 },
      { type: "audit", plugin: "author-dispersion", slug: "author-count", weight: 2 },
      { type: "audit", plugin: "author-dispersion", slug: "bus-factor", weight: 1 },
      { type: "audit", plugin: "team-ownership", slug: "cross-team-churn", weight: 3 },
      { type: "audit", plugin: "team-ownership", slug: "team-count-per-file", weight: 2 },
      { type: "audit", plugin: "knip", slug: "unused-files", weight: 1 },
      { type: "audit", plugin: "knip", slug: "unused-exports", weight: 1 },
      { type: "audit", plugin: "knip", slug: "unresolved-imports", weight: 2 },
      { type: "audit", plugin: "knip", slug: "unlisted-dependencies", weight: 2 },
    ],
  },
];

const registeredSlugs = new Set(resolvedPlugins.map((p) => p.slug));
const filteredCategories = declaredCategories
  .map((cat) => ({ ...cat, refs: cat.refs.filter((r) => registeredSlugs.has(r.plugin)) }))
  .filter((cat) => cat.refs.length > 0);

export default {
  persist: { outputDir: resolve(toolRoot, "reports") },
  plugins: resolvedPlugins,
  categories: filteredCategories,
};
