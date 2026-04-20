# ADR-0001: Use eslint-plugin-jsx-a11y for accessibility; do not adopt @code-pushup/axe-plugin

**Date:** 2026-04-20
**Status:** accepted
**Deciders:** code-smells maintainers
**Related tasks:** `adopt-axe-plugin` (closed by this decision)

## Context

The code-pushup ecosystem ships `@code-pushup/axe-plugin`, a wrapper around [axe-core](https://github.com/dequelabs/axe-core) — the most widely-adopted accessibility testing engine (used by axe-devtools, Deque, and Google's Lighthouse). The plugin catches a11y issues by rendering a page in a headless browser and running axe's rule engine against the live DOM.

We already adopt `eslint-plugin-jsx-a11y` in `eslint.target-rules.mjs`, which catches accessibility violations at lint time by pattern-matching against JSX ASTs. A curated subset of 11 rules is active (alt-text, aria-props, aria-role, anchor-has-content, interactive-supports-focus, etc.).

The question: should we also adopt `@code-pushup/axe-plugin` for runtime-DOM coverage, or stay with jsx-a11y?

## Decision

**Stay with `eslint-plugin-jsx-a11y`. Do not adopt `@code-pushup/axe-plugin`.**

If a target repo wants rendered-DOM accessibility testing, it belongs in that repo's own test suite (Storybook test runner, Playwright with `@axe-core/playwright`, Cypress with `cypress-axe`) — not in code-smells.

## Rationale

### What jsx-a11y covers

Static JSX a11y patterns — the 90% case. Missing `alt` attributes, invalid ARIA roles, non-interactive elements with click handlers, anchors without hrefs, autofocus abuse, form labels. Runs at lint time with no runtime dependency. Zero-config for target repos: if they opt into our ESLint wrapper, they get a11y audits automatically.

### What axe-plugin would add

Runtime-only a11y violations: computed color contrast, focus order in actual rendering, live region behavior, dynamic content announced to screen readers. These require a rendered DOM — jsx-a11y cannot catch them.

### Why the cost is too high

1. **Target repos need a Storybook or served-app harness.** Axe doesn't run against source files — it needs a rendered page. Target repos without Storybook would silently skip axe audits, making the tool less portable. Target repos with Storybook already have a11y testing via `@storybook/test-runner` or a Playwright+axe suite.

2. **Heavy transitive dependency.** The axe-plugin brings Puppeteer or Playwright as a dep, plus axe-core itself. This is a ~100 MB install and a ~30-second cold-start per run. Against code-pushup's goal of running in PR CI, this is a cold-path budget hit we don't need.

3. **Marginal signal on our static analyzer.** code-smells exists to surface structural smells (god components, coupling, churn). Accessibility is table-stakes quality already owned by:
   - **IDE-time** — jsx-a11y flags violations as you type
   - **Lint-time** — same rules run in CI, already covered here
   - **Test-time** — target repos' own Storybook/Playwright suites
   - **Runtime** — browser devtools axe extension

   Layering axe into code-smells duplicates the test-time layer without adding anything new.

4. **VISION boundary: wrap existing tools, stay lean.** Per [VISION.md](../../VISION.md), custom code and heavy infra are last resorts. Axe-plugin requires infra (served target) that doesn't exist in the VISION's "zero-config against any TS/React repo" goal.

### When to revisit

Revisit this decision if:

- A target repo emerges that needs a11y scoring in code-smells specifically because their own test suite doesn't cover it (unlikely — most ship with Playwright+axe or Storybook test runner already).
- code-pushup grows first-class support for target-repo Storybook URLs without requiring Puppeteer in our repo.
- jsx-a11y stops being maintained or loses fidelity against React 20+ patterns.

Until then, a11y via jsx-a11y is sufficient. Tracking this ADR so future maintainers don't re-litigate.

## Follow-ups

- The 11-rule jsx-a11y subset in `eslint.target-rules.mjs` is curated to minimize false positives on the IDS component library. Extend cautiously — the full jsx-a11y ruleset is known to be noisy on styled-components patterns.
- If a target repo's own Storybook test runner outputs axe violations as a structured report (JSON), a future `axe-results.plugin.mjs` could ingest those results without re-running axe. That stays inside VISION boundaries because it wraps existing test output rather than running axe ourselves.
