# Tasks

## P0

- [ ] Document every warning/check with its reasoning
  - **ID**: document-audit-reasoning
  - **Tags**: documentation, ux, trust
  - **Details**: Every audit emitted by code-smells needs a human-readable
    explanation of WHY it's flagged, what the research/rationale is, and
    what an engineer should do about it. Today most audits have a one-line
    description that barely says what rule fired. Users seeing a 500-row
    report can't triage because they don't know which findings actually
    matter.
    **Partial progress (Apr 2026):** `docs/audit-review.md` contains the
    research-backed review (What/Why/When-to-fix/FP risk) for all scored
    audits. What's still missing is (a) per-audit `docs/audits/<slug>.md`
    explainers the report can link to, and (b) the CI check that fails
    when new audits ship without docs.
    Deliverables:
    1. Enumerate every audit across all plugins:
       - ESLint rules in `eslint.target-rules.mjs` (~40+ rules including
         our custom hook-count, use-effect-count, unstable-selector-returns,
         domain-boundaries)
       - TypeScript strict checks (via @code-pushup/typescript-plugin)
       - Knip (dead code, unused exports, unused deps)
       - JSCPD (duplication)
       - Temporal coupling (Tornhill X-Rays)
       - Team ownership (Nagappan 2007)
       - Churn / bug-fix density (own plugins)
       - Author dispersion
       - Coupling (dependency-cruiser)
       - js-packages (audit + outdated)
       - type-coverage
    2. For each audit, document:
       - **What it flags** — one sentence describing the condition
       - **Why it matters** — research citation or pragmatic reasoning
         (e.g., "Tornhill 2015: files touched together are likely
         coupled; high temporal coupling predicts defect density")
       - **When to fix vs ignore** — false positive patterns, legitimate
         exceptions
       - **How to fix** — concrete remediation (refactor pattern, rule
         disable comment if intentional, etc.)
    3. Surface the docs in two places:
       - **In the report itself** — each audit's `description` field in
         code-pushup should link to `docs/audits/<audit-slug>.md` so
         clicking the audit in report.md jumps to the explainer
       - **README catalog** — a table listing all audits grouped by
         category with the one-sentence "what it flags"
    4. Establish a pattern so new audits must ship with a doc entry
       (add a check to CI that every audit slug has a
       `docs/audits/<slug>.md` file).
  - **Files**: `docs/audits/*.md` (new, one per audit), `README.md`
    (audit catalog table), `code-pushup.config.mjs` (wire description
    links), each `plugins/*.plugin.mjs` (ensure description fields
    reference the docs), possibly `scripts/check-audit-docs.mjs` (new)
  - **Acceptance**:
    - Every audit emitted has a corresponding `docs/audits/<slug>.md`
      explainer with What/Why/When to ignore/How to fix
    - `README.md` has an audit catalog with every audit grouped by
      category
    - Running `code-smells` on a target repo, clicking any audit in
      report.md jumps to its explainer
    - CI check fails if a new audit is added without a doc
    - Every "why" cites either a research paper, a named pattern, or
      explicit pragmatic reasoning — no bare "this is bad" assertions

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

(nothing open — `publish-cli` shipped 2026-04-20: the tool is now
runnable via `npx code-smells` and releases are automated via
release-please + a GitHub Actions publish workflow with npm provenance.)
