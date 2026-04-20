# Tasks

## P1

(none — the P1 research/calibration work has shipped. See git log for
what was delivered: temporal-coupling, team-ownership, domain-boundaries,
monorepo support, full README/ADR.)

## P2

## P3

### Integration UX (Google Tricorder principles)

### CI integration

Baseline + delta enforcement, PR summary comment, and PR-diff-only
reporting are all bundled as of 2026-04-20:

- Workflow template: `examples/workflows/code-smells.yml`
- Setup guide: `docs/ci-integration.md`

See also ADR-like reasoning in that doc for the Tricorder-inspired
tradeoffs (delta > absolute thresholds, summary > per-line, baseline
refresh cadence).

### Additional ESLint rules via @code-pushup/eslint-plugin

- [ ] Add eslint-plugin-boundaries for architectural rules
  - **ID**: add-boundaries-rules
  - **Tags**: adoption, eslint, architecture
  - **Details**: `eslint-plugin-boundaries` — "arch-unit for JS" at the ESLint level. Complements dependency-cruiser's constraint rules but at finer granularity. Define element types (components, hooks, domain, utils) and allowed imports between them. Most useful when paired with a target repo's existing folder structure (needs per-repo config).
  - **Files**: `eslint.target-rules.mjs`, `README.md` (usage docs explaining element-type config)
  - **Acceptance**: Works for a target repo's folder convention. Documented as opt-in.

### Pre-existing P2 work

- [ ] Add god-file metric (fileTotalHooks, componentCount)
  - **ID**: god-file-metric
  - **Tags**: enhancement, signal-quality
  - **Details**: Largely obsoleted — `react/no-multi-comp` ESLint rule now flags files with multiple components. The file-level total-hook metric (sum across all components) is still a gap but low priority.
  - **Files**: possibly a small additional custom ESLint rule
  - **Acceptance**: Re-evaluate whether still needed.

- [ ] Tune audit weights in categories against curated hotspots
  - **ID**: tune-weights
  - **Tags**: calibration, signal-quality
  - **Files**: `code-pushup.config.mjs`, `scripts/tune-weights.mjs` (new)
  - **Acceptance**: Weights tuned. Spearman rho between category score and curated ranking > 0.8.

### Additional tooling to evaluate

- [ ] Per-plugin bundle size tracking via size-limit
  - **ID**: bundle-size-plugin
  - **Tags**: new-plugin, performance
  - **Details**: `size-limit` has a stable programmatic API and `--json` output. For target repos that build independently-deployable artifacts, per-artifact bundle size is a real trending metric. Skip for repos without an independent build artifact.
  - **Files**: `plugins/bundle-size.plugin.mjs` (new)
  - **Acceptance**: Plugin under 60 lines. Fails gracefully when target has no size-limit config.

- [ ] Stylelint plugin for CSS-in-JS quality
  - **ID**: stylelint-plugin
  - **Tags**: new-plugin, css
  - **Details**: `stylelint` has a full Node API. For target repos using styled-components + `postcss-styled-syntax`, wrap `stylelint.lint()` as a plugin. Reports rule violations as audits. ~40 lines. Low priority — CSS-in-JS violations are already caught by style-level review.
  - **Files**: `plugins/stylelint.plugin.mjs` (new)
  - **Acceptance**: Plugin under 50 lines. Runs against styled-components template literals.

- [ ] Nightly mutation testing job (Stryker, separate from code-pushup)
  - **ID**: mutation-testing-nightly
  - **Tags**: testing, nightly
  - **Details**: Per VISION.md — Stryker is too slow (45–180 min) for per-PR code-pushup runs. But mutation score IS a genuinely better test-quality signal than line coverage. If we want it, implement as a **separate nightly GitHub Action** that posts a weekly digest. Not a code-pushup plugin.
  - **Files**: `.github/workflows/stryker-nightly.yml` template
  - **Acceptance**: Documentation + template workflow. Mutation score reported weekly. Explicitly NOT wired into code-pushup.

- [ ] Evaluate SonarCloud free tier as a dashboard layer
  - **ID**: evaluate-sonarcloud
  - **Tags**: evaluation, dashboard
  - **Details**: SonarCloud has a free tier for open-source projects. It provides the A–E quality rating trend concept. Per vision, the SQALE "person-days of debt" is fiction — ignore that — but the trend-rating UI is genuinely useful. Investigate whether it adds value beyond code-pushup's own portal (code-pushup.dev).
  - **Files**: decision doc
  - **Acceptance**: Write-up comparing SonarCloud vs code-pushup portal. Adopt or skip.

### Migration considerations

- [ ] @eslint-react migration evaluation
  - **ID**: eslint-react-migration
  - **Tags**: evaluation, risk
  - **Details**: `@eslint-react/eslint-plugin` (Rel1cx) has stricter rules than eslint-plugin-react (`no-nested-components`, `hooks-extra/prefer-use-state-lazy-initialization`, etc.). CANNOT coexist with eslint-plugin-react without scoped config — rule overlap causes false positives. Would be a **migration**, not an addition. High risk of churn in target repos. Evaluate whether the marginal signal justifies the migration cost.
  - **Files**: decision doc
  - **Acceptance**: Write-up with recommendation. If adopting, plan the migration path (likely gated per target repo).

### Distribution & docs

- [ ] Publish as a standalone CLI (npx-runnable)
  - **ID**: publish-cli
  - **Tags**: distribution
  - **Files**: `package.json`, `.github/workflows/publish.yml`, `LICENSE`
  - **Acceptance**: `npx code-smells --target /path` works from a fresh shell.
