/**
 * ESLint flat config applied to target repo source files via our wrapper
 * plugin. Intentionally separate from any eslint.config.mjs the target may
 * have — we measure against our opinionated rules, not their style.
 *
 * What's here:
 *   Source files (.ts/.tsx, excluding tests/stories):
 *     - react-perf    — inline function / object / array props in JSX
 *     - react         — no-multi-comp (god-file signal)
 *     - sonarjs       — cognitive-complexity (cyclomatic was dropped as
 *                       redundant per Campbell 2018: cognitive strictly
 *                       dominates, and McCabe 1976 is ~80% LOC-explained)
 *     - ESLint core   — max-lines-per-function
 *     - jsx-a11y      — accessibility (alt-text, aria, interactive focus)
 *     - formatjs      — hardcoded user-facing strings (opt-in via env)
 *     - code-smells   — custom gap-fillers (hook-count, use-effect-count,
 *                       unstable-selector-returns, domain-boundaries)
 *   Test files (.spec.*, .test.*):
 *     - testing-library — test antipattern rules
 *
 * Each rule's violations become a code-pushup audit.
 */
import tsParser from "@typescript-eslint/parser";
import formatjsPlugin from "eslint-plugin-formatjs";
import jsxA11yPlugin from "eslint-plugin-jsx-a11y";
import reactPlugin from "eslint-plugin-react";
import reactPerfPlugin from "eslint-plugin-react-perf";
import sonarjsPlugin from "eslint-plugin-sonarjs";
import testingLibraryPlugin from "eslint-plugin-testing-library";

import codeSmellsPlugin from "./eslint-rules/index.mjs";

const tsxLanguageOptions = {
  parser: tsParser,
  parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
};

// formatjs rules only activate for targets that opt in (react-intl-using repos).
const formatjsRules = process.env.CP_ENABLE_FORMATJS === "true"
  ? {
      "formatjs/no-literal-string-in-jsx": "warn",
    }
  : {};

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    ignores: [
      "**/*.spec.*",
      "**/*.test.*",
      "**/*.stories.*",
      "**/*.mock.*",
      "**/__generated__/**",
      "**/generated/**",
      "**/node_modules/**",
      "**/dist/**",
    ],
    languageOptions: tsxLanguageOptions,
    plugins: {
      react: reactPlugin,
      "react-perf": reactPerfPlugin,
      sonarjs: sonarjsPlugin,
      "jsx-a11y": jsxA11yPlugin,
      formatjs: formatjsPlugin,
      "code-smells": codeSmellsPlugin,
    },
    settings: { react: { version: "detect" } },
    rules: {
      // Component shape. cyclomatic-complexity intentionally dropped —
      // redundant with cognitive-complexity (Campbell 2018). `ignoreStateless:
      // true` so small co-located functional helpers don't trip the rule;
      // we only want to flag files that actually export multiple components.
      "max-lines-per-function": ["warn", { max: 150, skipBlankLines: true, skipComments: true }],
      "react/no-multi-comp": ["warn", { ignoreStateless: true }],
      "sonarjs/cognitive-complexity": ["warn", 15],

      // Render signals. `react/jsx-no-bind` dropped — redundant with
      // `react-perf/jsx-no-new-function-as-prop`.
      "react-perf/jsx-no-new-function-as-prop": "warn",
      "react-perf/jsx-no-new-object-as-prop": "warn",
      "react-perf/jsx-no-new-array-as-prop": "warn",

      // Accessibility (jsx-a11y). Curated subset — recommended but not the full
      // set since some rules are noisy on non-standard patterns.
      "jsx-a11y/alt-text": "warn",
      "jsx-a11y/anchor-has-content": "warn",
      "jsx-a11y/anchor-is-valid": "warn",
      "jsx-a11y/aria-props": "warn",
      "jsx-a11y/aria-role": "warn",
      "jsx-a11y/aria-unsupported-elements": "warn",
      "jsx-a11y/interactive-supports-focus": "warn",
      "jsx-a11y/no-autofocus": "warn",
      "jsx-a11y/no-noninteractive-element-interactions": "warn",
      "jsx-a11y/role-has-required-aria-props": "warn",
      "jsx-a11y/role-supports-aria-props": "warn",

      // i18n — gated behind CP_ENABLE_FORMATJS env var for react-intl repos.
      ...formatjsRules,

      // Custom gap-fillers (hook-count, use-effect-count, unstable-selector).
      // domain-boundaries is opt-in — no-op without a user-supplied categories
      // map. Target repos that want it should register the rule with their
      // own token→category map (see eslint-rules/domain-boundaries.mjs for
      // examples).
      "code-smells/hook-count": ["warn", { threshold: 10 }],
      "code-smells/use-effect-count": ["warn", { threshold: 3 }],
      "code-smells/unstable-selector-returns": "warn",
      "code-smells/domain-boundaries": ["warn", { threshold: 3 }],
    },
  },
  {
    // Test-file-specific rules. Catches antipatterns that don't apply to source.
    files: ["**/*.{spec,test}.{ts,tsx,js,jsx}"],
    ignores: ["**/node_modules/**", "**/dist/**"],
    languageOptions: tsxLanguageOptions,
    plugins: { "testing-library": testingLibraryPlugin },
    rules: {
      "testing-library/no-await-sync-queries": "warn",
      "testing-library/no-render-in-lifecycle": "warn",
      "testing-library/prefer-screen-queries": "warn",
      "testing-library/prefer-user-event": "warn",
      "testing-library/prefer-presence-queries": "warn",
      "testing-library/no-container": "warn",
      "testing-library/no-dom-import": "warn",
      "testing-library/no-unnecessary-act": "warn",
    },
  },
];
