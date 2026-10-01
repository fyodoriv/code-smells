/**
 * Pure helpers used by code-pushup.config.mjs — extracted here so they
 * can be unit-tested. The config file itself is mostly wiring (plugin
 * factory calls, category definitions) and is exercised end-to-end
 * when code-pushup loads it.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Pick the default source file glob for ESLint / jsdocs / type-coverage.
 *
 * Rules (first match wins):
 *   1. If targetDir has a top-level `src/` — `src/** / *.{ts,tsx}`.
 *   2. Else, for each of `plugins/`, `libs/`, `packages/` that exists,
 *      produce a brace-expanded workspace glob.
 *   3. Else fall back to the single-package default.
 *
 * Matches the CP_ENTRY auto-detection the coupling plugin does so that
 * zero-config runs from a monorepo root "just work" consistently.
 */
export const resolveDefaultPatterns = (targetDir, fsExists = existsSync) => {
  if (fsExists(resolve(targetDir, "src"))) return "src/**/*.{ts,tsx}";
  const wsDirs = ["plugins", "libs", "packages"].filter((d) => fsExists(resolve(targetDir, d)));
  if (wsDirs.length === 0) return "src/**/*.{ts,tsx}";
  const braced = wsDirs.length === 1 ? wsDirs[0] : `{${wsDirs.join(",")}}`;
  return `${braced}/*/src/**/*.{ts,tsx}`;
};

/**
 * Detect which package manager the target repo uses by looking for a
 * lockfile. Returns a value the @code-pushup/js-packages-plugin accepts,
 * or null when no lockfile is present.
 */
export const detectPackageManager = (targetDir, fsExists = existsSync) => {
  if (fsExists(resolve(targetDir, "pnpm-lock.yaml"))) return "pnpm";
  if (fsExists(resolve(targetDir, "yarn.lock"))) return "yarn-classic";
  if (fsExists(resolve(targetDir, "package-lock.json"))) return "npm";
  return null;
};

/**
 * Strip JSON5-style comments from a tsconfig. TypeScript's own parser
 * tolerates `// line` and `/* block *\/` comments; plain `JSON.parse`
 * does not. Used before parsing so references-detection can see the
 * actual config without choking on comments.
 */
export const stripJsonComments = (raw) =>
  raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Resolve the set of tsconfigs that @code-pushup/typescript-plugin should
 * analyze. The root tsconfig may be a project-references file (no
 * `include`/`files` of its own); in that case the typescript-plugin
 * can't use it directly and needs the concrete per-workspace tsconfigs.
 *
 * Resolution order:
 *   1. CP_TSCONFIG env var (comma-separated list) — user override wins.
 *   2. If the root tsconfig has references[] and no files/include,
 *      expand those into concrete tsconfig paths.
 *   3. Otherwise return [rootTsconfigPath].
 */
export const resolveTsconfigInputs = (
  rootTsconfigPath,
  targetDir,
  env = process.env,
  fsReadFileSync = readFileSync,
  fsExists = existsSync,
) => {
  if (env.CP_TSCONFIG) {
    return env.CP_TSCONFIG.split(",")
      .map((p) => resolve(targetDir, p.trim()))
      .filter(Boolean);
  }
  try {
    const raw = stripJsonComments(fsReadFileSync(rootTsconfigPath, "utf-8"));
    const cfg = JSON.parse(raw);
    const hasReferences = Array.isArray(cfg.references) && cfg.references.length > 0;
    const definesFiles =
      (Array.isArray(cfg.files) && cfg.files.length > 0) ||
      (Array.isArray(cfg.include) && cfg.include.length > 0);
    if (hasReferences && !definesFiles) {
      return cfg.references
        .map((ref) => resolve(dirname(rootTsconfigPath), ref.path))
        .map((p) => (p.endsWith(".json") ? p : resolve(p, "tsconfig.json")))
        .filter((p) => fsExists(p));
    }
  } catch {
    // Malformed or missing tsconfig — fall through to single-path default.
  }
  return [rootTsconfigPath];
};

/**
 * Map a package manager name to the slug prefix the js-packages-plugin
 * uses for its audits (e.g. "npm-audit-prod" vs "yarn-classic-audit-prod").
 */
export const pmSlugPrefix = (packageManager) => {
  if (packageManager === "yarn-classic") return "yarn-classic";
  if (packageManager === "yarn-modern") return "yarn-modern";
  if (packageManager === "pnpm") return "pnpm";
  return "npm";
};

/**
 * Build the ordered list of security-category refs for the given
 * package manager. The js-packages audit slugs include the pm prefix
 * so they must be computed after detection.
 *
 * Weight rationale:
 *   - audit-prod (3): runtime-exploitable CVEs — highest priority
 *   - audit-dev  (1): build-pipeline-only risk — real but bounded
 *   - outdated-prod (1): staleness correlates with unpatched supply-
 *     chain surface but ≠ vulnerable, so lower weight than audit-*
 *   - outdated-dev: dropped entirely — patch-version lag on Prettier
 *     isn't a defect signal (was weight 0, now removed to de-noise)
 */
export const buildSecurityRefs = (packageManager) => {
  const prefix = pmSlugPrefix(packageManager);
  return [
    { type: "audit", plugin: "js-packages", slug: `${prefix}-audit-prod`, weight: 3 },
    { type: "audit", plugin: "js-packages", slug: `${prefix}-audit-dev`, weight: 1 },
    { type: "audit", plugin: "js-packages", slug: `${prefix}-outdated-prod`, weight: 1 },
  ];
};

/**
 * Filter category refs so that only those pointing at registered
 * (plugin, audit) pairs survive. Without this filter, code-pushup
 * throws SchemaValidationError at load time when a referenced plugin
 * didn't register — e.g. js-packages is skipped because the target
 * has no lockfile, but the security category still referenced it.
 *
 * Drops categories that end up with zero refs.
 */
export const filterCategories = (declaredCategories, registeredAudits, securityRefs) =>
  declaredCategories
    .map((cat) => {
      const refs = cat.slug === "security" ? securityRefs : cat.refs;
      return { ...cat, refs: refs.filter((r) => registeredAudits.has(`${r.plugin}::${r.slug}`)) };
    })
    .filter((cat) => cat.refs.length > 0);

/**
 * Pick a coverage lcov report from a list of candidates, preferring an
 * explicit CP_COVERAGE_LCOV env var if set.
 */
export const resolveLcovPath = (
  targetDir,
  env = process.env,
  fsExists = existsSync,
) => {
  if (env.CP_COVERAGE_LCOV) {
    const explicit = resolve(targetDir, env.CP_COVERAGE_LCOV);
    if (fsExists(explicit)) return explicit;
  }
  const candidates = [
    "coverage/lcov.info",
    "reports/coverage/lcov.info",
    "coverage/unit/lcov.info",
  ];
  return candidates.map((p) => resolve(targetDir, p)).find((p) => fsExists(p));
};
