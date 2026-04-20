# Vision

> `code-smells` is a thin, opinionated wrapper around existing tools.
> Nothing more.

## Principle

Every audit should be an invocation of a third-party tool — an ESLint rule, a
CLI, or a maintained npm package — wired into code-pushup's audit/category
model with opinionated defaults calibrated for React/TypeScript monorepos.

Our value is **curation + defaults + plumbing**, not analysis logic.

## Target state

- **0** ts-morph traversals we own
- **0** regex patterns parsing source code
- **< 300** lines of custom logic total (vs. ~1,000 today, 991 excluding config)
- **Every plugin** either:
  1. Calls `@code-pushup/eslint-plugin` with pre-existing ESLint rules, or
  2. Wraps an existing maintained CLI/npm tool via its programmatic API

## Current state (2026-04-20)

1,080 total lines across `plugins/*.mjs` + `code-pushup.config.mjs` (89 orch).

| Layer | Plugins | Lines | % | Replaceable? |
|---|---|---|---|---|
| AST traversals (ts-morph) | `react-complexity`, `render-signals` | 408 | 41% | **Yes — ESLint rules exist** |
| CLI wrappers (spawn) | `coupling`, `duplication` | 245 | 25% | **Yes — use programmatic APIs** |
| Git shell parsing | `churn`, `bug-fix-density`, `author-dispersion` | 338 | 34% | **Mostly no** — no good npm alternative |

## Concrete replacement plan

### Layer 1: AST traversals → ESLint + `@code-pushup/eslint-plugin`

We're reimplementing what maintained ESLint rules already do, badly. The
`@code-pushup/eslint-plugin` package already exists, takes an ESLint config,
invokes ESLint's Node API, and maps rule violations to audits. This is exactly
what we want.

**`react-complexity.plugin.mjs` (204 lines) → ESLint config + 1 helper**

| Current audit | Current impl | Replacement |
|---|---|---|
| `component-loc` | ts-morph body LOC count | `max-lines-per-function` (ESLint core) |
| `components-per-file` | ts-morph PascalCase+JSX count | `react/no-multi-comp` (`eslint-plugin-react`) |
| `use-effect-count` | ts-morph regex count | **Gap** — no standard rule; write small custom ESLint rule (~30 lines) OR keep this one ts-morph audit |
| `hook-count` | ts-morph regex count | **Gap** — same situation as above |
| _(new)_ `cognitive-complexity` | — | `sonarjs/cognitive-complexity` (`eslint-plugin-sonarjs`) — bonus, new metric |

**`render-signals.plugin.mjs` (204 lines) → ESLint config, zero custom code**

| Current audit | Current impl | Replacement |
|---|---|---|
| `inline-function-props` | ts-morph JSX attr scan | `react-perf/jsx-no-new-function-as-prop` + `react/jsx-no-bind` |
| `inline-object-array-props` | ts-morph JSX attr scan | `react-perf/jsx-no-new-object-as-prop` + `react-perf/jsx-no-new-array-as-prop` |
| `unstable-selector-returns` | ts-morph `useSelector` pattern match | **Gap** — no standard rule; small custom ESLint rule (~40 lines) |

Net savings after this layer: **~330 lines of custom ts-morph code deleted**,
plus `cognitive-complexity` added as a new metric for free. Two small
domain-specific custom ESLint rules remain for the gaps.

### Layer 2: CLI wrappers → programmatic APIs

Shelling out via `child_process.spawnSync` means:
- We parse CLI stderr to catch failures
- We construct argv strings we have to escape carefully
- We buffer up to 64 MB of JSON output
- We can't stream results

All of these tools expose Node APIs. Use them.

**`duplication.plugin.mjs` (138 lines) → ~50 lines**
```js
import { detectClones } from 'jscpd';
const clones = await detectClones({ path: [targetDir], ... });
// clones.duplicates is the same shape as the JSON report
```
jscpd's programmatic API is stable. Deletes the spawn, the temp dir, the JSON
file read, the relative-path normalization.

**`coupling.plugin.mjs` (107 lines) → ~60 lines**
```js
import { cruise } from 'dependency-cruiser';
const result = await cruise([entry], { includeOnly: `^${entry}`, ... });
// result.output.modules is the same shape
```
Same pattern.

Net savings: **~135 lines**.

### Layer 3: Git parsing (stays custom — honest accounting)

Genuine gap in the Node ecosystem. What we've checked:

| Tool | Fit | Blocker |
|---|---|---|
| `simple-git` | clean git API | Would reduce shell risk but per-file stats still require us to parse |
| `code-maat` | purpose-built for this | Requires JVM, output is CSV that we'd still need to join |
| `git-fame` | contributor stats | Per-author totals, not per-file |
| `gitstats` | HTML reports | Python, not integrable |
| CodeScene | best in class | Commercial SaaS |

**Decision:** keep custom, but adopt `simple-git` for safer shell handling.
~50 lines saved per plugin from avoiding `execSync` with shell string
interpolation. Custom parsing logic stays — there's nothing to replace it with.

## Boundaries

Custom code is permitted only when **all** of the following hold:

1. No maintained npm package or ESLint rule does the job
2. The custom code is scoped to a single plugin file
3. The plugin stays under **30 lines** of analysis logic (everything else is
   config, types, and plumbing)
4. The analysis is domain-specific enough that it wouldn't make sense to
   upstream it (e.g., per-file git churn, bring-your-own domain-boundary
   enforcement)

If those conditions aren't met, we either use an existing tool or cut the
feature.

## Industry-backed principles

Research findings from Tornhill (_Software Design X-Rays_), Google
(_Tricorder_, Sadowski 2018 CACM), Microsoft (Nagappan 2005/2007), and
SonarSource's Cognitive Complexity paper (Campbell 2018) that shape how we
build and integrate.

### Adopt code-pushup's own plugins before building anything

code-pushup ships 6 official plugins we haven't used. Each fills a gap other
industry tools charge money for:

| Plugin | Covers | Custom code required |
|---|---|---|
| `@code-pushup/coverage-plugin` | Test coverage (lcov) | 0 lines |
| `@code-pushup/js-packages-plugin` | `npm audit` + outdated deps | 0 lines |
| `@code-pushup/typescript-plugin` | TypeScript compiler diagnostics (strict flags, no-implicit-any, semantic errors) | 0 lines |
| `@code-pushup/jsdocs-plugin` | Documentation coverage | 0 lines |
| `@code-pushup/axe-plugin` | Accessibility via axe-core | 0 lines |
| `@code-pushup/eslint-plugin` | Any ESLint rule as an audit (big lever — see "Replacement plan" above) | 0 lines |

**Rule:** before writing any new plugin, check if code-pushup already ships
one. A 1-line config entry is always better than a custom plugin.

### The signals worth having that no off-the-shelf tool provides

Our research identified exactly **two** analytical signals that industry
research considers high-value and where no maintained npm tool delivers them:

1. **Temporal coupling** (Tornhill) — files that consistently change in the
   same commits despite having no declared import relationship. Reveals
   hidden state-sharing and copy-paste-then-diverge patterns. Not in any
   maintained npm package (`code-maat` is the closest, JVM-based). Worth
   ~100 lines of custom git-log analysis per our boundaries.

2. **Team-level ownership attribution** (Nagappan 2007 — "Using Software
   Dependencies and Churn Metrics to Predict Field Failures") — files
   changed by >2 teams have 2–3× higher bug density. We currently measure
   author dispersion, not team dispersion. Requires parsing `CODEOWNERS` +
   joining with git log. No npm tool; ~50 lines custom.

Everything else either already exists as a tool we should wrap, or is
research-discredited (see next section).

### Research-backed skip list

Signals that sound good but don't earn their keep:

| Signal / tool | Why we skip |
|---|---|
| **Halstead complexity** (volume/difficulty/effort) | Explains 80–90% of its variance with plain LOC (El Emam 2001 IEEE TSE). No independent signal. |
| **Maintainability Index** (Microsoft formula) | Calibrated on 1990s Pascal/C. Breaks down on OOP (Oman & Hagemeister 2002). A 500-line React component with 10 small functions can score "poor" while a 50-line function with 8 nested conditions scores "good." |
| **Stryker mutation testing** | 45–180 min per full run on a ~30-plugin monorepo. Breaks the "fast feedback" contract of per-PR checks. If we adopt it, it's a separate nightly job, not a code-pushup plugin. |
| **Jira auto-ticket creation for code smells** | Universally becomes noise. Backlog bloats, teams stop triaging, integration gets disabled within 2 months. Only exception: critical `npm audit` CVEs (CVSS ≥ 9). |
| **LLM-based technical debt quantification** | Research stage. 10× variance between LLM estimates of the same issue (Tornhill & Borg 2022). SonarQube's SQALE constants are also fictional but at least *consistent*. |
| **Production runtime tracing / "effective code"** | Privacy constraints (user data in call stacks) + 2–5% CPU overhead. Infrastructure cost unjustified unless you're FAANG scale. |
| **Comment density** as a metric | No statistical correlation with bug density or maintainability (Steidl 2013 ICSM). |
| **SonarQube's SQALE "technical debt in person-days"** | The per-rule minute estimates are made up. A "143 person-days of debt" number sounds authoritative but is fiction. We can borrow the A–E trend-rating concept without the fake calculations. |
| **DORA metrics** (lead time, MTTR, change failure rate) | Organizational metrics. Require incident data from PagerDuty/Opsgenie, not static analysis. Track separately with LinearB / DX. |
| **`eslint-plugin-react-compiler`** | Beta as of early 2025. Re-evaluate when React Compiler ships stable (likely H2 2025). |

### Integration principles (Google Tricorder)

From Sadowski 2018 (CACM — _Lessons from Building Static Analysis Tools at
Google_), with 15 years of scale-testing behind it:

- **10% false-positive ceiling.** If a tool exceeds 10% FP rate, developers
  stop trusting it — globally. Every new signal must be calibrated against
  this before turning it on.
- **PR annotations only on changed lines.** Reporting full-file findings on
  a PR causes suppression fatigue. Restrict PR output to what the PR author
  actually touched. Full-file reports go into the dashboard, not the PR.
- **"Effective FP" concept.** Even a technically correct finding is an
  effective false positive if the author of this PR can't plausibly fix it.
  Only surface findings the current author could act on.
- **Severity tiers are load-bearing.** Errors (block CI), suggestions (PR
  annotation, non-blocking), auto-fixes (apply mechanically). We conflate
  these at our peril.

### Baseline + ratchet (not absolute thresholds)

From SonarQube's "Quality Gate on New Code" and internal practice at
Microsoft/Google:

- **Don't fail CI on absolute thresholds over existing code.** Every existing
  line becomes tech debt the first day the rule turns on. Teams either
  silently suppress or disable the rule.
- **Fail on deltas.** "This PR increased cognitive complexity by X" or
  "reduced coverage by Y%." Absolute thresholds apply only to brand-new
  files/modules.
- code-pushup supports this natively via `--persist` + `compare
  --fail-on=regression`. Use it.

### PR comment UX

- **One summary comment per PR.** Updated on each push. Shows deltas in a
  table. Replaces noisy per-line annotations.
- **Weekly digest** to team leads with top-10 hotspots + delta from last
  week. This beats per-PR Slack notifications (which get muted within a
  week).
- **No auto-tickets.** Dashboards and digests only. Exception: critical
  vulnerabilities (CVSS ≥ 9) auto-file a P1.

## Non-negotiables

- **No forking.** If an upstream tool is insufficient, file an issue upstream
  or pick a different tool.
- **No vendoring.** ESLint rules come from npm, not inline AST code we own.
- **No hidden config.** Every tool's configuration lives in this repo's
  `code-pushup.config.mjs` or a colocated ESLint config. Nothing implicit.
- **If it needs > 30 lines of custom code, it becomes a discussion.** The
  default is no — propose and defend before building.

## Success metrics

Tracking as of the ESLint replacement work:

| Metric | Target | Current |
|---|---|---|
| Plugins with zero custom AST traversals | 7 / 7 | **9 / 9** ✓ |
| Dependencies on maintained tools | ≥ 10 | **14** ✓ (eslint, eslint-plugin-react, eslint-plugin-react-perf, eslint-plugin-sonarjs, @typescript-eslint/parser, dependency-cruiser, jscpd, ts-morph, @code-pushup/cli, @code-pushup/typescript-plugin, @code-pushup/js-packages-plugin, @code-pushup/jsdocs-plugin, + 2 utilities) |
| Plugin count | 7 | **9** (added typescript, js-packages, jsdocs) |
| Audit count | 15 | **25** (+ cognitive complexity, cyclomatic complexity, TS diagnostics, npm-audit, documentation coverage) |
| Category count | 4 | **6** (+ Type Safety, Security & Dependencies) |
| Custom analysis LOC | < 300 | **~710** — git plugins (338, unchanged, no viable alternative), custom ESLint rules + utils (248), custom ESLint wrapper plugin (122) |
| `npx code-pushup collect` runtime | < 30s on 500-file repo | not yet measured |

Honest note on custom LOC: we're over the 300-line target because:

1. The three git plugins (churn, bug-fix-density, author-dispersion) remain
   at 338 lines. No Node-ecosystem tool does per-file git stats — VISION
   Layer 3 accepts this.
2. The ESLint wrapper plugin (`plugins/eslint.plugin.mjs`, 122 lines) was
   not in the original plan. We needed it because
   `@code-pushup/eslint-plugin` spawns `npx eslint` with cwd=process.cwd(),
   which finds the target repo's bundled ESLint (often v8 legacy) before
   ours (v9). Writing our own thin wrapper using ESLint's Node API with
   explicit `cwd: targetDir` was the cleanest fix. Per the boundaries, this
   IS a thin adapter over an existing tool — within the rule, but the line
   count exceeds the per-plugin limit.
3. The three custom ESLint rules (hook-count, use-effect-count,
   unstable-selector-returns) plus shared utils total 248 lines. Gap-filler
   rules for signals that no maintained plugin delivers. Slightly over the
   "~30 lines each" aspirational target, mostly because of ESLint rule
   boilerplate (meta schema, messages, stack tracking).

The honest accounting: we deleted 408 lines of custom ts-morph AST code
(react-complexity + render-signals plugins). We added 370 lines of
ESLint-based replacements. Net reduction is modest in pure LOC, but the
leverage improved dramatically — adding another ESLint rule (e.g.
testing-library, jsx-a11y) is now a one-line config change, not a new
ts-morph plugin.

## Sequencing

See `TASKS.md` for the concrete work queue. Rough order:

1. `replace-render-signals-with-eslint` — biggest immediate win (203 lines
   deleted, zero custom AST code left in that plugin)
2. `replace-react-complexity-with-eslint` — bigger savings, but needs the
   "gap-filler" custom ESLint rules for hook counting
3. `replace-jscpd-cli-with-api` — smaller refactor, low risk
4. `replace-depcruise-cli-with-api` — same
5. `adopt-simple-git` — modest cleanup across 3 git plugins
6. `custom-eslint-rule-hook-count` — fills the gap for use-effect-count /
   hook-count after the react-complexity replacement
7. `custom-eslint-rule-unstable-selector` — fills the gap for
   unstable-selector-returns after the render-signals replacement
