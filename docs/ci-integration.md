# CI integration: baseline + delta enforcement

> **TL;DR** — Drop [examples/workflows/code-smells.yml](../examples/workflows/code-smells.yml) into your repo's `.github/workflows/`. Edit the `CP_PATTERNS` env var to match your source layout. Push to main once to seed the baseline; all subsequent PRs get a single delta summary comment and fail on category regressions.

This guide covers the three CI tasks that would otherwise live separately:
`ci-ratchet-workflow`, `pr-summary-comment`, and `pr-diff-only-reporting`
— bundled because they're fundamentally the same workflow with different
knobs.

## Design, briefly

Three principles borrowed from [Google Tricorder](https://research.google/pubs/lessons-from-building-static-analysis-tools-at-google/):

1. **Delta-based enforcement, not absolute thresholds.** Most existing codebases score terribly against opinionated thresholds on day one. Failing CI on absolute scores is a recipe for the workflow being disabled. Failing only on *regressions against the main-branch baseline* forces teams to not-get-worse, which is the actionable ratchet.
2. **One summary comment per PR.** Inline-per-line annotations across 50+ files train developers to ignore the bot. A single updating summary with the category-level delta keeps the signal-to-noise ratio right.
3. **PR-diff-only where helpful, full-repo where not.** The summary comment covers the whole repo (context matters). Issue-level annotations on PRs, when we add them, only apply to files the PR actually changed.

## What the workflow does

1. **On push to main/master** — collects a fresh report and uploads `report.json` as a workflow artifact keyed by the commit SHA. This becomes the baseline for future PRs.
2. **On pull_request** — collects a new report for the PR HEAD, downloads the baseline artifact from the PR's merge-base commit, and runs `code-pushup compare` to produce a diff.
3. **Posts a single sticky summary comment** on the PR with the category-level delta table.
4. **Fails the PR check on regression** (`--fail-on=regression`). Remove or soften this flag while teams ramp up — advisory-only is a legitimate first step.

## Setup

1. **Vendor or install the tool.** Until the `publish-cli` task ships, the template vendors `code-smells` by cloning it to `/tmp/` in CI. Once `npx code-smells` is available on the registry, the install step becomes a single `npx` invocation.
2. **Edit the env vars.** At minimum, update `CP_PATTERNS` to match your source layout. If your monorepo uses a non-standard layout (not `plugins/<ws>/src` or `libs/<ws>/src`), also set `CP_ENTRY` explicitly.
3. **Seed the baseline.** Push to main once; the workflow will upload `code-smells-baseline-<sha>` as a 90-day-retention artifact.
4. **Open a PR.** The compare-step will pull the baseline from the merge-base and post the summary comment.

## Env vars (re-documented for CI context)

| Var | Default | When to set explicitly in CI |
|-----|---------|------------------------------|
| `CP_TARGET` | `${{ github.workspace }}` | Always — pinning avoids subtle cwd bugs. |
| `CP_PATTERNS` | `src/**/*.{ts,tsx}` | Always, for monorepos. Example: `{plugins,libs}/*/src/**/*.{ts,tsx}` |
| `CP_ENTRY` | auto-detected | Only if your monorepo doesn't use `plugins/<ws>/src` / `libs/<ws>/src` / `packages/<ws>/src`. |
| `CP_TSCONFIG` | root tsconfig, references auto-expanded | Rarely — only for repos with hand-built tsconfig layouts. |
| `CP_COVERAGE_LCOV` | `coverage/lcov.info` | If your coverage report lives elsewhere. |
| `CP_ENABLE_FORMATJS` | `false` | Set to `true` for react-intl repos. |

## Cost & runtime

For a medium monorepo (~50k LOC across 30 workspaces):

- Collect: ~2 minutes (dominated by ESLint + knip)
- Compare: < 10 seconds
- PR comment: < 5 seconds

Well within a reasonable PR-CI budget.

## Tradeoffs

- **Artifact retention costs.** Baselines are kept for 90 days; tune `retention-days` in the workflow if you want longer history for trend analysis.
- **Artifact download failures.** The example uses `dawidd6/action-download-artifact` to look up the baseline from main. If you prefer first-party actions only, replace that step with `actions/download-artifact@v4` plus a custom lookup.
- **Regression threshold.** `--fail-on=regression` blocks PRs on any category regressing by ≥1 point. This is intentionally strict. Teams ramping up may want to softness: remove the flag initially, add it back after a few weeks of reading the comments.

## What this doesn't cover

- **Per-line annotations.** Deliberately omitted per Google Tricorder principles. If you want them, code-pushup supports a `--annotation-mode` flag; add a step that pipes `report.json` through a filter keeping only issues in `files-changed-by-this-pr.txt` (from `gh pr diff --name-only`).
- **Baseline update policy.** Baselines refresh on every main push; an alternative is a weekly cron. Pick based on how much drift you want to tolerate between PRs.
- **Scheduled weekly digest.** Tracked separately as `weekly-slack-digest` in TASKS.md.

## Related

- [VISION.md](../VISION.md) — tool principles
- [ADR-0001](decisions/0001-axe-vs-jsx-a11y.md) — accessibility decision
