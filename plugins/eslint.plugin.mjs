/**
 * eslint plugin wrapper
 *
 * Thin adapter over ESLint's Node API. We use this instead of
 * `@code-pushup/eslint-plugin` because that plugin spawns `npx eslint` with
 * its own cwd resolution, which finds the target repo's bundled ESLint (often
 * v8 legacy) before our v9. Running ESLint programmatically with explicit
 * `cwd: targetDir` sidesteps the problem entirely.
 *
 * What this plugin does:
 *   - Loads our opinionated `eslint.target-rules.mjs` up-front to enumerate
 *     the rules we care about.
 *   - At runner time, creates an `ESLint` instance rooted at the target
 *     directory, lints the target source files, counts violations per rule,
 *     emits one audit per rule.
 *
 * Audit slug convention mirrors @code-pushup/eslint-plugin: `slugify(ruleId)`
 * plus an 8-char hash suffix when the rule has non-default options, so that
 * reference slugs stay stable across runs.
 */
import { createHash } from "node:crypto";

import { ESLint } from "eslint";

/** slugify a rule id like `sonarjs/cognitive-complexity` → `sonarjs-cognitive-complexity`. */
const slugify = (s) =>
  s
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const jsonHash = (data, bytes = 8) =>
  createHash("shake256", { outputLength: bytes })
    .update(JSON.stringify(data) ?? "null")
    .digest("hex");

/** Stable audit slug for a rule with its configured options. */
const ruleIdToSlug = (ruleId, options) => {
  const base = slugify(ruleId);
  return options?.length ? `${base}-${jsonHash(options)}` : base;
};

/** Extract { ruleId: [severity, ...options] } from a flat-config array. */
const collectRulesFromFlatConfig = (flatConfig) => {
  const out = new Map();
  for (const block of flatConfig) {
    for (const [ruleId, entry] of Object.entries(block.rules ?? {})) {
      const arr = Array.isArray(entry) ? entry : [entry];
      // Drop the severity (first element) — options are the rest.
      out.set(ruleId, arr.slice(1));
    }
  }
  return out;
};

/**
 * @param {{ targetDir: string, eslintrc: string, patterns: string[] }} options
 * @returns {Promise<import('@code-pushup/models').PluginConfig>}
 */
export default async function eslintPlugin({ targetDir, eslintrc, patterns }) {
  // Load the config once to enumerate rules we'll emit audits for.
  const mod = await import(eslintrc);
  const flatConfig = mod.default;
  const rulesMap = collectRulesFromFlatConfig(flatConfig);

  const audits = [...rulesMap.entries()].map(([ruleId, options]) => ({
    slug: ruleIdToSlug(ruleId, options),
    title: ruleId,
    description: `ESLint: ${ruleId}`,
  }));

  return {
    slug: "eslint",
    title: "ESLint",
    icon: "eslint",
    description:
      "Opinionated ESLint rules applied to target repo source — react-perf, sonarjs complexity, max-lines-per-function, react/no-multi-comp, and custom gap-filler rules.",
    audits,
    runner: async () => {
      const eslint = new ESLint({
        overrideConfigFile: eslintrc,
        cwd: targetDir,
        errorOnUnmatchedPattern: false,
      });
      const results = await eslint.lintFiles(patterns);

      // Count violations per rule + collect per-file issues.
      /** @type {Map<string, { count: number, issues: Array<{ source: {file:string, position?:{startLine:number}}, severity:string, message:string }> }>} */
      const byRule = new Map();
      for (const [ruleId] of rulesMap) byRule.set(ruleId, { count: 0, issues: [] });

      for (const fileResult of results) {
        for (const msg of fileResult.messages) {
          if (!msg.ruleId) continue;
          const bucket = byRule.get(msg.ruleId);
          if (!bucket) continue;
          bucket.count++;
          if (bucket.issues.length < 50) {
            bucket.issues.push({
              source: { file: fileResult.filePath, position: { startLine: msg.line ?? 1 } },
              severity: msg.severity === 2 ? "error" : "warning",
              message: msg.message.slice(0, 300),
            });
          }
        }
      }

      return [...rulesMap.entries()].map(([ruleId, options]) => {
        const slug = ruleIdToSlug(ruleId, options);
        const { count, issues } = byRule.get(ruleId);
        return {
          slug,
          title: ruleId,
          score: count === 0 ? 1 : 0,
          value: count,
          displayValue: count === 0 ? "no violations" : `${count} ${count === 1 ? "violation" : "violations"}`,
          details: { issues },
        };
      });
    },
  };
}
