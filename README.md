# code-smells

Code smell detector for React/TypeScript repos. Thin wrapper over [code-pushup](https://github.com/code-pushup/cli) — the orchestration layer — with a curated set of audits drawn from both official code-pushup plugins and custom plugins for signals that no maintained tool covers.

**What the tool is opinionated about:** which signals track real defect risk ([Tornhill temporal coupling](https://pragprog.com/titles/atevol/software-design-x-rays/), [Nagappan 2007 team ownership](https://www.microsoft.com/en-us/research/publication/the-influence-of-organizational-structure-on-software-quality-an-empirical-case-study/)), how to weight them against each other, and how to stay lean by wrapping existing tools instead of writing new analysis code. Per [VISION.md](./VISION.md), the target state is < 300 lines of custom logic.

## What it reports

**Six categories** scored on a 0-100 scale, composed from **40+ audits** across **12 plugins**:

| Category | Signal | Plugins feeding it |
|----------|--------|--------------------|
| **Component Health** | React component shape: body size, complexity, hook overload, multi-component files | eslint (max-lines, no-multi-comp, sonarjs, custom hook-count + use-effect-count) |
| **Render Performance** | Static proxy for re-render cost: inline props, unstable selectors | eslint (react-perf trio, jsx-no-bind, custom unstable-selector-returns) |
| **Coupling** | Syntactic fan-out + opt-in domain-boundary violations + hidden coupling | coupling (dep-cruiser), eslint (custom domain-boundaries), temporal-coupling |
| **Type Safety** | TypeScript compiler diagnostics + inferred-any measurement | typescript, type-coverage |
| **Security & Dependencies** | npm audit vulnerabilities + outdated deps | js-packages |
| **Maintainability** | Duplicated code, churn, bug-fix density, ownership dispersion, team dispersion, dead code | duplication (jscpd), churn, bug-fix-density, author-dispersion, team-ownership, knip |

### Custom ESLint rules (4)

Each fills a gap where no community rule does the job. Lives in `eslint-rules/`, wrapped via ESLint's flat-config plugin API.

| Rule | Flags |
|------|-------|
| `code-smells/hook-count` | React components with more than N total hook calls (default 10) |
| `code-smells/use-effect-count` | React components with more than N `useEffect` calls (default 3) |
| `code-smells/unstable-selector-returns` | `useSelector` with inline object-literal return — unstable reference, triggers re-render every render |
| `code-smells/domain-boundaries` | **Opt-in.** Flags files that reference N+ distinct domain categories. Users supply a `categories: { token: bucket }` map matching their domain (e.g. `{ ORDER: "order", CUSTOMER: "customer" }`). Router files and constants barrels legitimately cross every bucket and light up — that's the signal the rule is working; suppress at file level when intentional. |

### Custom plugins (6 new-signal plugins beyond eslint)

| Plugin | What it reports | Reference |
|--------|-----------------|-----------|
| `coupling` | Files with high module fan-out (too many imports) | dependency-cruiser programmatic API |
| `duplication` | Duplicated line blocks across the repo | jscpd CLI |
| `churn` | Files changing frequently in the last N days | git log via simple-git |
| `bug-fix-density` | Count of fix/hotfix/revert commits per file in the last 180d — lagging defect indicator | git log |
| `author-dispersion` | Files with too many contributors + bus-factor (single-author dominance) | git log |
| `temporal-coupling` | File pairs that co-change together in commits but have NO declared import edge between them — Tornhill "Software Design X-Rays" hidden coupling signal | git log + dependency-cruiser |
| `team-ownership` | Files touched by commits crossing multiple CODEOWNERS teams — Nagappan 2007 cross-team defect predictor | git log + codeowners-utils |

Plus several code-pushup first-party plugins (eslint wrapper, typescript, js-packages, type-coverage, jsdocs, knip, coverage) — each wrapped thinly to share the same `CP_TARGET` convention.

## Usage

**Point it at any TS/React repo via the `CP_TARGET` env var:**

```bash
# Single-package target
CP_TARGET=/path/to/my-repo \
  CP_PATTERNS="src/**/*.{ts,tsx}" \
  CP_ENTRY="src" \
  npx code-pushup collect
```

**Monorepo targets** auto-detect workspace layouts:

```bash
# yarn/pnpm/npm workspace monorepo (plugins/<ws>/src + libs/<ws>/src + packages/<ws>/src)
CP_TARGET=/path/to/my-monorepo \
  CP_PATTERNS='{plugins,libs,packages}/*/src/**/*.{ts,tsx}' \
  npx code-pushup collect
# CP_ENTRY auto-detects all workspace src/ dirs; no manual config.
```

For targets where the root `tsconfig.json` uses project references, the typescript plugin automatically expands `references: [...]` into an array of concrete per-workspace tsconfigs.

**Outputs** go to `reports/`:
- `report.json` — machine-readable, full details per audit
- `report.md` — rendered summary

### Env vars

| Var | Default | Purpose |
|-----|---------|---------|
| `CP_TARGET` | current working dir | Target repo to analyze |
| `CP_PATTERNS` | `src/**/*.{ts,tsx}` | Glob pattern for source files (used by ESLint, jsdocs, type-coverage) |
| `CP_ENTRY` | `src` | Entry point(s) for dependency-cruiser (comma-separated list allowed) |
| `CP_TSCONFIG` | auto-detected | Explicit tsconfig path(s), comma-separated — overrides reference auto-expansion |
| `CP_COVERAGE_LCOV` | `coverage/lcov.info` (if present) | Path to lcov file for coverage-plugin |
| `CP_ENABLE_FORMATJS` | `false` | Enable `formatjs/no-literal-string-in-jsx` rule for react-intl repos |

### Targeting a single workspace within a monorepo

```bash
CP_TARGET=/path/to/monorepo/packages/my-package \
  CP_PATTERNS='src/**/*.{ts,tsx}' \
  CP_ENTRY='src' \
  npx code-pushup collect
```

Categories referencing plugins that don't apply (e.g. `js-packages` when there's no lockfile in the sub-workspace) are filtered out automatically — you won't see a `Security & Dependencies` category that doesn't exist.

### Using the domain-boundaries rule

The `domain-boundaries` rule is a no-op unless you supply a `categories` map. Edit `eslint.target-rules.mjs` (or the equivalent in your target) to register tokens from your domain:

```js
"code-smells/domain-boundaries": ["warn", {
  threshold: 3,
  categories: {
    // Map string literals, identifiers, or member-access property names
    // to category buckets. Multiple tokens can map to the same bucket
    // so variants collapse together.
    ORDER_CONTAINER: "order",
    OrderContainer: "order",
    "Order": "order",
    CUSTOMER_CONTAINER: "customer",
    "Customer": "customer",
    // ...
  },
}],
```

A file referencing 3+ distinct buckets gets flagged. Example output:

```
  File references 3 domain categories (customer, order, product).
  Threshold is 3 — this file likely crosses a container boundary.
  Consider splitting per-category logic into dedicated modules.
```

Router files and constants barrels that legitimately bridge every category light up. That's expected — suppress at the file level:

```ts
/* eslint-disable code-smells/domain-boundaries */
// This is the container router — it needs all categories.
```

## CI ratchet

code-pushup supports baseline comparison out of the box:

```bash
# Capture baseline once, commit as artifact
CP_TARGET=/path/to/repo npx code-pushup collect --persist.outputDir=baseline

# In PR CI, compare
CP_TARGET=/path/to/repo npx code-pushup compare \
  --before=baseline/report.json \
  --after=reports/report.json \
  --fail-on=regression
```

Per [Google's Tricorder principles](https://research.google/pubs/lessons-from-building-static-analysis-tools-at-google/), we recommend:
- **Delta-based enforcement over absolute thresholds** — a score-0 component-health category is a starting position for most existing codebases, not a reason to fail CI.
- **PR-diff-only annotations** — show findings in files changed by the PR, not full-repo noise.
- **Single summary comment on PRs** — not inline-per-line annotations.

See [`examples/workflows/code-smells.yml`](examples/workflows/code-smells.yml) for a drop-in GitHub Actions template and [`docs/ci-integration.md`](docs/ci-integration.md) for the full setup guide.

## Architecture

```
code-smells/
├── code-pushup.config.mjs         # Registers 12 plugins + 6 categories
├── eslint.target-rules.mjs        # Opinionated ESLint flat config applied to target source files
├── eslint-rules/                  # Custom ESLint rule implementations
│   ├── domain-boundaries.mjs
│   ├── hook-count.mjs
│   ├── use-effect-count.mjs
│   ├── unstable-selector-returns.mjs
│   ├── utils.mjs
│   └── index.mjs                  # Plugin export
├── plugins/                       # Thin adapters over existing tools
│   ├── eslint.plugin.mjs          # Programmatic ESLint — drives all rule-backed audits
│   ├── coupling.plugin.mjs        # dependency-cruiser (fan-out)
│   ├── duplication.plugin.mjs     # jscpd (duplicated lines)
│   ├── knip.plugin.mjs            # knip (dead code)
│   ├── type-coverage.plugin.mjs   # type-coverage (inferred-any)
│   ├── churn.plugin.mjs           # git log — file-change frequency
│   ├── bug-fix-density.plugin.mjs # git log — fix commit density
│   ├── author-dispersion.plugin.mjs # git log — individual author dispersion
│   ├── temporal-coupling.plugin.mjs # git log + dep-cruiser — hidden coupling (Tornhill)
│   └── team-ownership.plugin.mjs  # git log + CODEOWNERS — team dispersion (Nagappan 2007)
├── examples/
│   └── workflows/
│       └── code-smells.yml        # Drop-in GitHub Actions template
├── docs/
│   ├── ci-integration.md          # CI setup guide
│   └── decisions/                 # ADRs (architecture decision records)
│       └── 0001-axe-vs-jsx-a11y.md
├── reports/                       # Output: report.json + report.md (gitignored)
├── VISION.md                      # Boundaries + research footing
├── TASKS.md                       # Roadmap
├── LICENSE                        # MIT
└── Agentfile.yaml                 # Optional agent/MCP config
```

## Why thin is the design

Per [VISION.md](./VISION.md): our value is **curation + defaults + plumbing**, not analysis logic. Every audit is an invocation of a third-party tool — an ESLint rule, a maintained CLI, or an npm package — wired into code-pushup's audit/category model with opinionated defaults calibrated for React/TypeScript monorepos.

Justified custom code:
- ~180 lines total for the custom ESLint rules (`domain-boundaries`, `hook-count`, `use-effect-count`, `unstable-selector-returns`) — each a gap no community rule fills
- ~190 lines for `temporal-coupling` (no maintained Node tool does this; code-maat is JVM-based)
- ~180 lines for `team-ownership` (wraps codeowners-utils with the Nagappan cross-team-commit aggregation)
- ~100 lines each for `coupling` / `duplication` / `churn` / `bug-fix-density` / `author-dispersion` / `knip` / `type-coverage` wrappers

Every custom file has a JSDoc header explaining WHY that specific wrapper exists (the gap it fills, what alternative we ruled out, what constraints shaped it).

## Decisions (ADRs)

- [ADR-0001](docs/decisions/0001-axe-vs-jsx-a11y.md) — use `eslint-plugin-jsx-a11y` for accessibility; do not adopt `@code-pushup/axe-plugin`.

## Follow-up work

See [`TASKS.md`](TASKS.md). Remaining work is low-priority tooling additions (bundle-size plugin, stylelint plugin, mutation-testing nightly, SonarCloud evaluation) and distribution (publish-cli).

## License

[MIT](./LICENSE)
