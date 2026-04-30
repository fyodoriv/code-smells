# Tasks

## P0

- [ ] Enforce `docs/audit-review.md` stays in sync with emitted audits
  - **ID**: audit-review-lint
  - **Tags**: documentation, ci, drift-prevention
  - **Details**: `docs/audit-review.md` is the canonical decision log
    for every audit. Today the doc ↔ code link is manual — someone
    can add/remove an audit without touching the review. We need a CI
    check that fails when they drift.
    Implementation outline:
    1. Script (`scripts/check-audit-review.mjs`) that imports the
       compiled `code-pushup.config` from the target, walks `plugins`
       and `categories` to collect the set of emitted audit slugs
       (including pm-aware slugs like `{npm,yarn-classic,pnpm}-audit-
       prod`), parses `docs/audit-review.md` for rows (stripping the
       `{pm}` placeholder), and diffs.
    2. Fail with a clear message listing (a) audits emitted but not
       documented, (b) audits documented but not emitted (moved to
       "Previously emitted but dropped" section required).
    3. Wire into `.github/workflows/ci.yml` as a step after tests.
    4. Include a pre-commit hook option (husky or simple
       `npm run check:audit-review`) so contributors catch drift
       locally.
  - **Files**: `scripts/check-audit-review.mjs` (new), `.github/
    workflows/ci.yml` (add step), `package.json` (add script),
    `docs/audit-review.md` (possible minor formatting to make it
    machine-parseable)
  - **Acceptance**:
    - CI fails when an audit is added to `code-pushup.config.ts` but
      no row exists in `docs/audit-review.md`
    - CI fails when an audit row in `docs/audit-review.md` references
      a slug no plugin emits
    - The check runs in <5s
    - Local developer can run `npm run check:audit-review` to validate
      before pushing

- [ ] Document every warning/check with its reasoning
  - **ID**: document-audit-reasoning
  - **Tags**: documentation, ux, trust
  - **Details**: Every audit emitted by code-smells needs a human-readable
    explanation of WHY it's flagged, what the research/rationale is, and
    what an engineer should do about it. Today most audits have a one-line
    description that barely says what rule fired. Users seeing a 500-row
    report can't triage because they don't know which findings actually
    matter.
    **Progress (Apr 2026):** `docs/audit-review.md` is the living
    decision log — covers What/Why/Decision/Weight for every scored
    audit and every previously-emitted-but-dropped audit. See
    `audit-review-lint` above for the drift-prevention check.
    What's still missing is (a) per-audit `docs/audits/<slug>.md`
    explainers the report's audit description field can link to, so
    clicking through in `report.md` jumps to a full "what this flags /
    how to fix it" page.
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

- [ ] Migrate source tree from `.mjs` to strict TypeScript
  - **ID**: migrate-to-typescript
  - **Tags**: dogfooding, type-safety, refactor
  - **Details**: code-smells scores "Type Safety" as 1 of 8 categories
    but is itself written in `.mjs` with JSDoc-only typing. Migration
    started on branch `refactor/migrate-to-typescript` (in-progress WIP
    is preserved in a git stash on that branch — `git stash list` to
    see it). The branch has:
    - Files moved from repo root to `src/**/*.ts`
    - All `.mjs` import specifiers rewritten to `.js` (correct for
      TS+NodeNext module resolution)
    - `tsconfig.json` created at repo root with strict mode, NodeNext,
      `rootDir: ./src`, `outDir: ./dist`, full strict flags
    - `.gitignore` updated to include `dist/` and `*.tsbuildinfo`
    - `bin/code-smells.mjs` replaced with a 2-line shebang shim that
      imports `run()` from `dist/bin/main.js`
    - `@types/node` added
    Still TODO:
    1. Add strict types to every `src/**/*.ts` file — plugins use
       `import('@code-pushup/models').PluginConfig`, ESLint custom
       rules use `Rule.RuleModule`, config uses `CoreConfig`
    2. Deal with untyped deps (eslint-plugin-jsx-a11y,
       eslint-plugin-react-perf, eslint-plugin-formatjs,
       eslint-plugin-testing-library, eslint-plugin-sonarjs) — either
       install `@types/<name>` or add ambient declarations
    3. Convert test files `.spec.mjs` → `.spec.ts` and update imports
       to point at `../src/...` paths
    4. Update `package.json` — add `main`, `types`, `prepublishOnly:
       npm run build`, new `build` and `typecheck` scripts
    5. Update `vitest.config.mjs` coverage `include: ["src/**/*.ts"]`
    6. Update `.github/workflows/ci.yml` to add `tsc --build` step
    7. Update publish workflow to build before publishing (shipped
       tarball contains `dist/` not `src/`)
    8. Update `examples/workflows/code-smells.yml` references
    9. Verify `npx code-smells` on the tool's own repo still works
       end-to-end
  - **Files**: `src/**/*.ts` (exists, needs types), `tsconfig.json`
    (exists, may need tightening), `package.json`, `vitest.config.mjs`,
    `.github/workflows/ci.yml`, `.github/workflows/release-please.yml`,
    test files `.spec.mjs` → `.spec.ts`
  - **Acceptance**:
    - `npx tsc --build` exits 0 with no errors on strict config
    - `npm test` green (202+ tests)
    - `npm run check` (full `npx code-smells` self-run) completes
    - CI runs typecheck step and it passes
    - Published tarball contains `dist/` and the bin shim works
    - No `any` in source (verify with `grep -r ': any' src/` = empty)

(prior P1 research/calibration work has shipped — see git log:
temporal-coupling, team-ownership, domain-boundaries, monorepo support,
audit cleanup review PR #11.)

## P2

- [ ] Distribute code-smells as a CI check across personal repos
  - **ID**: distribute-to-personal-repos
  - **Tags**: adoption, distribution
  - **Details**: Goal is to have code-smells running as a PR-gating
    check on every personal project. Path to pick among:
    1. **Reusable workflow** in this repo that target repos reference
       via `uses: fyodoriv/code-smells/.github/workflows/audit.yml@v1`
       — changes to audit config propagate on next run
    2. **Composite action** at repo root (`action.yml`) — `uses:
       fyodoriv/code-smells@v1` inside any job
    3. **Drop-in template** copied per repo (what
       `examples/workflows/code-smells.yml` already tries to be)
    User has a curated list of target repos they'll provide when
    starting this.
  - **Files**: `.github/workflows/audit.yml` (new reusable workflow) OR
    `action.yml` (new composite action), scripts to bulk-open PRs in
    target repos if we automate rollout
  - **Acceptance**:
    - Decision recorded (reusable workflow vs composite action vs
      per-repo template)
    - Working example from at least one target repo that posts a
      sticky summary comment on PRs and fails on category regressions

- [ ] Trim and modernize `examples/workflows/code-smells.yml`
  - **ID**: trim-example-workflow
  - **Tags**: cleanup, ci-template
  - **Details**: Current template is ~139 lines and still references
    the pre-publish `/tmp/code-smells` vendoring approach. Now that
    `npx code-smells` is published (0.2.11+), the workflow can shrink
    to ~40 lines. Also has a trailing-fragment bug on lines 137-139
    (duplicate `recreate: true` + `baseline).` orphan). Gets done as
    part of `distribute-to-personal-repos` or standalone.
  - **Files**: `examples/workflows/code-smells.yml`,
    `docs/ci-integration.md`
  - **Acceptance**:
    - Workflow uses `npx code-smells` (no /tmp clone)
    - No orphaned fragment at the end of the file
    - `docs/ci-integration.md` updated to match

- [ ] Guard against npm 11's cross-platform optional-dep pruning
  - **ID**: npm11-lockfile-platform-drift
  - **Tags**: ci, ops, papercut
  - **Details**: npm 11 on macOS arm64 prunes `@esbuild/*` platform-
    specific optional deps from `package-lock.json` on every
    `npm install`, breaking `npm ci` on Linux CI. Hit this on PR #11
    — had to surgical-edit the lockfile via a Node script to remove
    only the jsdocs+ts-morph chain without dropping platform entries.
    Options:
    1. Pin npm to 10.x in the dev environment via an `.nvmrc` + `npm
       -g install npm@10` note in CONTRIBUTING
    2. Use a Docker Linux container for lockfile-regenerating commands
    3. Add a pre-push / pre-commit check that verifies every
       `@esbuild/*` platform entry is present in the lockfile
  - **Acceptance**:
    - Either a documented workaround in README/CONTRIBUTING, or an
      automated check that catches the drift before push

## P3

### Integration UX (Google Tricorder principles)

### CI integration

Baseline + delta enforcement, PR summary comment, and PR-diff-only
reporting all shipped 2026-04-20. Workflow template at
`examples/workflows/code-smells.yml`; setup guide at
`docs/ci-integration.md` with ADR-like reasoning for the Tricorder-
inspired tradeoffs (delta > absolute thresholds, summary > per-line,
baseline refresh cadence). Follow-up work tracked under
`trim-example-workflow` in P2 and `distribute-to-personal-repos` in
P2.

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

- [ ] Align code-smells agent guide with the shared agent-tool repo baseline
  - **ID**: align-code-smells-agent-guide-baseline
  - **Tags**: agents, agentbrew, docs, governance
  - **Details**: Cross-repo audit on 2026-04-30 found `AGENTS.md` captures
    important audit-specific rules, but it is missing the common agent-tool
    sections that make Bosun, Taskgrind, dotfiles, and agentbrew easy for
    agents to operate consistently: repo purpose, layout, development commands,
    verification gate, task queue policy, Agentfile sync, and ownership
    boundaries for generated agent config.
  - **Files**:
    - `AGENTS.md`
    - `Agentfile.yaml`
    - `TASKS.md`
    - `skill-plugins/code-smells-aware/SKILL.md`
  - **Acceptance**:
    - `AGENTS.md` follows the shared baseline while preserving the audit
      decision-log rule and code-smells-specific plugin guidance
    - The canonical verify command is documented and matches `package.json`
    - Agentfile skill source ownership and `agentbrew sync` expectations are
      explicit
    - `TASKS.md` has file-level policy comments for task format and verification
      comparable to the other agent-tool repos
    - `npx -y @tasks-md/lint TASKS.md` and the documented verify gate pass
