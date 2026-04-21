# Audit review — April 2026

> A one-pass review of every audit code-smells emits, against the
> rubric in `VISION.md`: **research-backed, <10% FP, actionable**.
>
> Status legend:
> - ✅ **Keep** — solid signal, well-researched, low FP, actionable
> - ⚠ **Tune** — signal is valid but thresholds, weight, or scope need work
> - ❌ **Drop** — noisy, redundant, or research-discredited
> - 🔧 **Structural** — audit emits but isn't in a category (doesn't score)

Summary: **58 audits total, 34 scored, 24 unscored.** 31 keep as-is,
10 tune, 4 drop, 2 structural fixes.

---

## Category 1 · Component Health

| Audit | Threshold | Verdict | Why |
|---|---|---|---|
| `max-lines-per-function` | 150 lines | ✅ Keep | LOC/function is the only complexity metric that earns independent signal (El Emam 2001 IEEE TSE — most complexity metrics are ~80% LOC-correlated). Mechanical refactor target. |
| `react/no-multi-comp` | `ignoreStateless: false` | ⚠ Tune | Signal is pragmatic ("god-file") but `ignoreStateless: false` fires on legitimate small helper components co-located by design. Flip to `ignoreStateless: true` default and only flag 2+ top-level exported components. |
| `sonarjs/cognitive-complexity` | 15 | ✅ Keep | Campbell 2018 paper shows cognitive complexity correlates with developer maintainability ratings better than cyclomatic. SonarSource default threshold is 15. |
| `sonarjs/cyclomatic-complexity` | 10 | ❌ Drop | Redundant with cognitive-complexity. McCabe 1976's metric is ~80% explained by LOC and cognitive strictly dominates it (Campbell 2018). Keeping both double-counts complexity in the category score. |
| `code-smells/hook-count` | 10 | ✅ Keep | Pragmatic — hook proliferation is a genuine responsibility-overload signal. Threshold of 10 is forgiving enough to leave well-factored containers alone. |
| `code-smells/use-effect-count` | 3 | ✅ Keep | Dan Abramov's "You Might Not Need an Effect" codifies the research: multiple effects usually encode hidden state machines. Threshold 3 is tight but the React team's own guidance backs it. |

**Category-level change:** drop cyclomatic, re-weight cognitive → 4. Keep the rest.

---

## Category 2 · Render Performance

| Audit | Verdict | Why |
|---|---|---|
| `react-perf/jsx-no-new-function-as-prop` | ⚠ Tune | Signal is a **static proxy** for re-render cost (VISION's own framing is honest). In React 18+ with concurrent renderer and unmemoized children, inline functions rarely matter for end-user perf. High FP in practice. Keep as signal but drop weight. |
| `react-perf/jsx-no-new-object-as-prop` | ⚠ Tune | Same. `style={{color: 'red'}}` is universally fine in practice. |
| `react-perf/jsx-no-new-array-as-prop` | ⚠ Tune | Same. |
| `react/jsx-no-bind` | ❌ Drop | **Redundant** with `react-perf/jsx-no-new-function-as-prop`. Same signal, two audits. |
| `code-smells/unstable-selector-returns` | ✅ Keep | Highest-quality rule in this category. `useSelector(s => ({...}))` without `shallowEqual` is a **real** perf bug (guaranteed re-render every dispatch), not a "might be slow" proxy. Rule correctly exempts scalar returns and 2-arg forms. Near-zero FP. |

**Category-level change:** drop jsx-no-bind, keep the three react-perf rules but collectively at lower weight than unstable-selector-returns (which is already weight 3, correct).

---

## Category 3 · Coupling

| Audit | Verdict | Why |
|---|---|---|
| `coupling/high-fan-out` (threshold 15) | ✅ Keep | Import count is the cleanest JS/TS proxy for syntactic coupling (Chidamber & Kemerer 1994 CBO metric adapted). Threshold 15 is permissive enough to leave legit composition roots alone. |
| `code-smells/domain-boundaries` (threshold 3) | ✅ Keep | Opt-in by design — empty categories map makes the rule a no-op. When a repo supplies a map, it catches genuine DDD bounded-context violations. Near-zero FP because the user controls the categories. |
| `temporal-coupling/hidden-coupling` (30% co-change, 3+ pairs, 90d) | ✅ Keep | Tornhill "Software Design X-Rays" 2018 establishes temporal coupling as a defect predictor **independent** of static coupling. 20-file/commit cap and test exclusion already mitigate the main FP sources (bulk renames, formatter runs). No off-the-shelf Node tool — custom code is justified. |

**Category-level change:** none. This is the best-curated category.

---

## Category 4 · Type Safety

| Audit | Verdict | Why |
|---|---|---|
| `typescript/semantic-errors` | ✅ Keep | Literal TSC errors. FP rate is zero by definition. |
| `typescript/syntax-errors` | ✅ Keep | Same. |
| `typescript/no-implicit-any-errors` | ✅ Keep | Same. Calls out specifically the `implicit any` diagnostic class. |
| `typescript/configuration-errors` | ✅ Keep | Same. Weight 1 is right — these are rare but catch tsconfig drift. |
| `type-coverage/type-coverage-percentage` | ✅ Keep | Catches inferred-any that `no-explicit-any` can't see (untyped `JSON.parse`, untyped catch blocks, untyped deps). Real signal beyond TSC. |

**Category-level change:** none. All five keep as-is. Highest-confidence category.

---

## Category 5 · Security & Dependencies

| Audit | Weight | Verdict | Why |
|---|---|---|---|
| `js-packages/npm-audit-prod` | 3 | ✅ Keep | Real signal for prod-runtime vulns at CVSS ≥7. Noisy low-severity dev-only advisories are the critique, but weight-3 at prod-only scope is right. |
| `js-packages/npm-audit-dev` | 2 | ⚠ Tune → 1 | Dev-dep vulns are build-pipeline-only risk. Weight 2 overstates the runtime impact vs. prod. Drop to 1. |
| `js-packages/npm-outdated-prod` | 1 | ✅ Keep | Informational — outdated ≠ vulnerable. Weight 1 is exactly right. |
| `js-packages/npm-outdated-dev` | 0 | ❌ Drop | Already weight 0, meaning it doesn't affect the score. Still pollutes the report. Either drop from the category entirely or delete the audit. |

**Category-level change:** drop npm-outdated-dev; rebalance npm-audit-dev weight.

---

## Category 6 · Maintainability

| Audit | Verdict | Why |
|---|---|---|
| `duplication/duplicated-lines` (jscpd, 500-line threshold) | ✅ Keep | Classic DRY violation. Test fixtures and generated code are the main FP sources but the 500-line total-budget threshold is forgiving. |
| `churn/file-churn` (>5 in 90d) | ✅ Keep (info) | Tornhill: high-churn files are 3-5× defect-prone. Weight 1 is right — not actionable alone, useful in combination. |
| `bug-fix-density/bug-fix-density` (>3 fix commits in 180d) | ✅ Keep | Direct lagging defect indicator. Weight 3 reflects its predictive value. Requires conventional-commits discipline. |
| `author-dispersion/author-count` (>6 in 180d) | ✅ Keep | Nagappan 2007: >6 authors correlates with 2-3× defect rate. On solo repos this trivially scores 100, which is fine — the signal activates when the repo scales. |
| `author-dispersion/bus-factor` (top author ≥80%, min 5 commits) | ❌ **Drop for personal projects** | **Inverts on solo repos.** Every file in a personal project has 100% one-author dominance; the audit reports "everything is bus-factor-risky" which is true but unactionable. For team repos the signal is OK but weak (bus-factor ≠ defect-density; Nagappan measured the opposite). |
| `team-ownership/cross-team-churn` (>3 in 180d) | ✅ Keep | Nagappan 2007 direct measure: **strongest defect predictor in any static-analysis metric.** No-ops gracefully when no CODEOWNERS. Weight 3 is right. |
| `team-ownership/team-count-per-file` (>2 other teams/commit) | ✅ Keep | Complementary signal to cross-team-churn; captures "cross-team blast radius" per commit. |
| `knip/unused-files` | ✅ Keep | Dead code. Low-FP when knip is configured; plugin returns empty audits gracefully when no config. |
| `knip/unused-exports` | ✅ Keep | Same. |
| `knip/unresolved-imports` | ✅ Keep | These are literal build-breaking bugs. High signal. |
| `knip/unlisted-dependencies` | ✅ Keep | Supply-chain risk — implicit deps. Weight 2 is correct. |

**Category-level change:** drop or gate bus-factor. Everything else keeps.

---

## 🔧 Structural issues

### Issue 1 — 24 audits emit but don't score

The following plugins run and emit audits, but **none of their audits are referenced in any category**, so they don't contribute to the 0–100 category scores shown in the summary table:

| Plugin | Audits emitted | Currently scored? |
|---|---|---|
| `jsdocs` | 8 (classes, enums, functions, interfaces, methods, properties, types, variables) | ❌ None |
| `jsx-a11y` via eslint | 11 (alt-text, anchor-has-content, anchor-is-valid, aria-props, aria-role, aria-unsupported-elements, interactive-supports-focus, no-autofocus, no-noninteractive-element-interactions, role-has-required-aria-props, role-supports-aria-props) | ❌ None |
| `testing-library` via eslint | 8 (no-await-sync-queries, no-render-in-lifecycle, prefer-screen-queries, prefer-user-event, prefer-presence-queries, no-container, no-dom-import, no-unnecessary-act) | ❌ None |
| `coverage` (lcov) | 1+ | ❌ None |

**Three ways to resolve:**

1. **Add two new categories** — "Accessibility" (jsx-a11y) + "Test Quality" (testing-library, coverage). Drop JSDocs entirely (research says comment density doesn't correlate with defects — Steidl 2013 ICSM).
2. **Fold into existing categories** — accessibility into Component Health, testing-library into Maintainability, coverage into Type Safety.
3. **Suppress** — remove the plugins that don't score. Cleanest but loses the signal.

**Recommendation:** Option 1 with JSDocs dropped. Two new categories ("Accessibility", "Test Quality") matches how the README frames the tool's scope.

### Issue 2 — JSDocs coverage is research-discredited

Steidl 2013 (ICSM) showed **no statistical correlation between comment density and bug density or maintainability.** The `@code-pushup/jsdocs-plugin` emits 8 sub-audits that together imply "document everything" is a goal. It isn't. Drop the plugin entirely; if per-public-API documentation coverage becomes important later, add it with scope (public exports only, not every variable).

### Issue 3 — Redundant audits

| Redundancy | Keep | Drop |
|---|---|---|
| Cyclomatic vs. cognitive complexity | `sonarjs/cognitive-complexity` | `sonarjs/cyclomatic-complexity` |
| Inline function props | `react-perf/jsx-no-new-function-as-prop` | `react/jsx-no-bind` |
| Outdated dev deps (weight 0) | — | `npm-outdated-dev` |

---

## Summary of verdicts

| Category | Keep | Tune | Drop |
|---|---|---|---|
| Component Health | 5 | 1 (no-multi-comp) | 1 (cyclomatic) |
| Render Performance | 1 | 3 (react-perf rules) | 1 (jsx-no-bind) |
| Coupling | 3 | 0 | 0 |
| Type Safety | 5 | 0 | 0 |
| Security & Dependencies | 2 | 1 (npm-audit-dev weight) | 1 (npm-outdated-dev) |
| Maintainability | 10 | 0 | 1 (bus-factor for solo repos) |
| **Total (scored)** | **26** | **5** | **4** |
| Unscored (structural) | — | — | 24 (fold into categories or drop) |

---

## Open questions for Fyodor

1. **Bus-factor audit** — drop entirely, or keep behind a flag that requires >1 distinct author in the history? (Solo repos will always hit 100% dominance on every file.)
2. **Accessibility as a scored category** — yes/no? You use jsx-a11y rules already; the question is whether to grade on them.
3. **Test Quality as a scored category** — yes/no? Would fold testing-library + coverage in.
4. **JSDocs plugin** — drop entirely, or keep as "informational, not scored" status quo?
5. **React-perf trio (jsx-no-new-*-as-prop)** — keep at current weight, or reduce? My take: signal is real but FP-heavy; reduce each from weight 1 to weight 0.5 (not supported) or drop to 0.5 average weight equivalent by halving the category's share.
6. **No-multi-comp threshold** — flip to `ignoreStateless: true`?
