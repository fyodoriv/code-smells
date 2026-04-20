# code-smells

[![license](https://img.shields.io/github/license/fyodoriv/code-smells.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)](https://nodejs.org)

**A curated, research-backed static-analysis tool for React/TypeScript repos.** Thin wrapper over [code-pushup](https://github.com/code-pushup/cli) with opinionated defaults — hook overload, inline props, fan-out coupling, hidden temporal coupling ([Tornhill](https://pragprog.com/titles/atevol/software-design-x-rays/)), cross-team ownership ([Nagappan 2007](https://www.microsoft.com/en-us/research/publication/the-influence-of-organizational-structure-on-software-quality-an-empirical-case-study/)), and more. Zero setup against any TS/React repo.

```bash
git clone https://github.com/fyodoriv/code-smells && cd code-smells && npm install
CP_TARGET=/path/to/your/repo npm run check
# Reports land in reports/report.{json,md}
```

Requires Node.js 18+ and git.

## What you get

**Six categories** scored 0-100, composed from **40+ audits** across **12 plugins**:

| Category | Signal |
|---|---|
| **Component Health** | Body size, complexity, hook overload, multi-component files |
| **Render Performance** | Inline props in JSX, unstable `useSelector` returns |
| **Coupling** | Import fan-out, domain-boundary violations (opt-in), hidden temporal coupling |
| **Type Safety** | TypeScript compiler diagnostics + type-coverage (inferred-any) |
| **Security & Dependencies** | npm audit vulnerabilities + outdated deps |
| **Maintainability** | Duplicated code, churn, bug-fix density, author + team dispersion, dead code |

Output looks like this:

```
●  max-lines-per-function                    47 violations
●  react-perf/jsx-no-new-function-as-prop    89 violations
●  sonarjs/cognitive-complexity              15 violations
●  code-smells/hook-count                    12 violations
●  temporal-coupling/hidden-coupling         8 pairs (max 100% co-change)
●  team-ownership/cross-team-churn           0 files
●  ... 30 more audits ...

┌───────────────────────────┬─────────┬──────────┐
│  Category                 │  Score  │  Audits  │
├───────────────────────────┼─────────┼──────────┤
│  Component Health         │      0  │       6  │
│  Render Performance       │     43  │       5  │
│  Coupling                 │     97  │       3  │
│  Type Safety              │     73  │       5  │
│  Security & Dependencies  │    100  │       4  │
│  Maintainability          │     89  │      11  │
└───────────────────────────┴─────────┴──────────┘
```

## Why this vs. running ESLint directly

ESLint gives you rule-by-rule violation counts. This gives you:
- **Category scores** rolling 40+ audits into 6 top-level dials you can trend over time
- **Research-backed signals** (temporal coupling, team ownership) that no ESLint rule covers — these predict defects better than any static-analysis metric in the Nagappan 2007 study
- **Monorepo support out of the box** — auto-detects workspaces, expands tsconfig project references, gracefully degrades when plugins don't apply to a sub-workspace
- **CI ratchet** via `code-pushup compare --fail-on=regression` — fail PRs that worsen the score without cargo-culting absolute thresholds
- **Thin by design** — every audit is an existing tool (ESLint rule, maintained CLI, npm package), curated and weighted. No custom analysis engine to outgrow.

## Usage

### Single-package repo

```bash
CP_TARGET=/path/to/repo \
  CP_PATTERNS="src/**/*.{ts,tsx}" \
  CP_ENTRY="src" \
  npm run check
```

### Monorepo (yarn / pnpm / npm workspaces)

Auto-detects `plugins/<ws>/src`, `libs/<ws>/src`, `packages/<ws>/src` layouts:

```bash
CP_TARGET=/path/to/monorepo \
  CP_PATTERNS='{plugins,libs,packages}/*/src/**/*.{ts,tsx}' \
  npm run check
```

If the root `tsconfig.json` uses project references, they're expanded automatically into per-workspace tsconfigs for the TypeScript plugin.

### Env vars

| Var | Default | Purpose |
|---|---|---|
| `CP_TARGET` | current directory | Override the repo under analysis. Useful in CI / wrappers where you can't `cd` first. |
| `CP_PATTERNS` | `src/**/*.{ts,tsx}` | Glob for source files (ESLint, jsdocs, type-coverage) |
| `CP_ENTRY` | `src` (auto-detects workspaces in monorepos) | dependency-cruiser entry point(s); comma-separated list |
| `CP_TSCONFIG` | auto-detected from `references` | Explicit tsconfig path(s), comma-separated |
| `CP_COVERAGE_LCOV` | `coverage/lcov.info` if present | Path to lcov file for the coverage audit |
| `CP_ENABLE_FORMATJS` | off | Set `=true` to enable `formatjs/no-literal-string-in-jsx` (react-intl repos) |

### Custom ESLint rules

Ships 4 rules under the `code-smells/` plugin namespace, each filling a gap where no community rule does the job:

| Rule | Flags |
|---|---|
| `hook-count` | Components with more than N total hook calls (default 10) |
| `use-effect-count` | Components with more than N `useEffect` calls (default 3) |
| `unstable-selector-returns` | `useSelector` with inline object-literal return — unstable reference, re-renders every time |
| `domain-boundaries` | **Opt-in.** Files referencing N+ distinct domain buckets. Bring your own `{ token: bucket }` map — see the [rule source](./eslint-rules/domain-boundaries.mjs) for examples |

### CI

Drop [`examples/workflows/code-smells.yml`](examples/workflows/code-smells.yml) into your repo's `.github/workflows/`. It seeds a baseline on main, compares PRs against it, posts a single sticky summary comment, and fails on category regressions.

Full setup guide in [`docs/ci-integration.md`](docs/ci-integration.md). Three [Google Tricorder](https://research.google/pubs/lessons-from-building-static-analysis-tools-at-google/) principles applied: delta over absolute thresholds, summary over per-line annotations, PR-diff-only reporting.

## Architecture

```
code-smells/
├── code-pushup.config.mjs            # 12 plugins + 6 categories
├── eslint.target-rules.mjs           # Opinionated ESLint config applied to target source
├── eslint-rules/                     # Custom ESLint rules (~180 lines total)
├── plugins/                          # Thin adapters over existing tools
│   ├── eslint.plugin.mjs             # Programmatic ESLint — drives all rule-backed audits
│   ├── coupling.plugin.mjs           # dependency-cruiser (fan-out)
│   ├── duplication.plugin.mjs        # jscpd (duplicated lines)
│   ├── knip.plugin.mjs               # knip (dead code)
│   ├── type-coverage.plugin.mjs      # type-coverage (inferred-any)
│   ├── churn.plugin.mjs              # git log — file-change frequency
│   ├── bug-fix-density.plugin.mjs    # git log — fix commit density
│   ├── author-dispersion.plugin.mjs  # git log — individual author dispersion
│   ├── temporal-coupling.plugin.mjs  # git log + dep-cruiser — Tornhill hidden coupling
│   └── team-ownership.plugin.mjs     # git log + CODEOWNERS — Nagappan cross-team defect predictor
├── examples/workflows/               # Drop-in GitHub Actions template
├── docs/
│   ├── ci-integration.md
│   └── decisions/                    # ADRs
├── VISION.md                         # Boundaries + research footing
└── TASKS.md                          # Roadmap
```

## Why thin is the design

Per [VISION.md](./VISION.md): value is **curation + defaults + plumbing**, not analysis logic. Every audit is an existing tool (ESLint rule, maintained CLI, npm package) wired into code-pushup's audit/category model. Justified custom code:

- ~180 lines total for the 4 custom ESLint rules — each a gap no community rule fills
- ~190 lines for `temporal-coupling` (no maintained Node tool; code-maat is JVM-based)
- ~180 lines for `team-ownership` (wraps codeowners-utils with Nagappan cross-team-commit aggregation)
- ~100 lines each for the thin plugin wrappers (`coupling`, `duplication`, `churn`, `bug-fix-density`, `author-dispersion`, `knip`, `type-coverage`)

Every custom file's JSDoc header explains **why** that specific wrapper exists — the gap it fills, what alternative was ruled out, what constraints shaped it.

## Decisions (ADRs)

- [ADR-0001](docs/decisions/0001-axe-vs-jsx-a11y.md) — use `eslint-plugin-jsx-a11y` for accessibility; do not adopt `@code-pushup/axe-plugin`.

## Development

```bash
git clone https://github.com/fyodoriv/code-smells && cd code-smells
npm install
node ./bin/code-smells.mjs  # run against cwd (the tool's own repo)
npm run format              # prettier
```

Releases are automated via [release-please](https://github.com/googleapis/release-please-action) — conventional commits on `main` accumulate into a release PR; when it merges, a GitHub release fires and `.github/workflows/publish.yml` publishes to npm with [provenance](https://docs.npmjs.com/generating-provenance-statements). To bootstrap: add an `NPM_TOKEN` repo secret with an npm automation/granular token scoped to the `code-smells` package.

Follow-up work lives in [TASKS.md](./TASKS.md). Highlights: `tune-weights` (calibrate category weights against curated hotspots), `bundle-size-plugin`, `stylelint-plugin`, `evaluate-sonarcloud`.

## License

[MIT](./LICENSE)
