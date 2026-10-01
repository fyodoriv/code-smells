# Agent guide — code-smells

Repo-specific rules for AI agents and human contributors. Read before
making changes to audits, plugins, or category configuration.

## Always-on rules

### Audit decisions live in `docs/audit-review.md`

**Every time you add, remove, or tune an audit, update
`docs/audit-review.md` in the same commit.** The review doc is the
canonical decision log — it records the rationale, research citation,
and weight for every audit. It's not reference documentation that
someone else will write later; it's part of the audit.

Applies to:
- Adding a new audit row (ESLint rule, plugin slug, category ref)
- Removing an audit (move the row to "Previously emitted but dropped"
  with reasoning — don't just delete)
- Changing a threshold, weight, or option that affects behavior
- Adding or renaming a category
- Adding a new plugin that emits audits

The doc's header (`## Maintenance rule`) has the full protocol with
examples. When in doubt, add a row first with your decision recorded
up front.

A CI check (`audit-review-lint`, see `TASKS.md` P0) is the enforcement
goal — until it's implemented, treat the rule as a code review
checklist item.

### Conventional commits, ≤72 char header

Enforced globally. See `.github/` config and TASKS.md for the
task-format rules.

### Branch protection on `main`

`main` is protected via a GitHub Ruleset (`protect-main`) with:
- no direct push (PR required)
- no force push
- no deletion
- required `test` CI check
- linear history (squash/rebase only)

Repo admin has `pull_request`-scope bypass only — no emergency push
mechanism. If CI breaks you, fix CI.

### Tasks live in `TASKS.md`

Follow the tasks.md spec: P0/P1/P2/P3 sections, `- [ ] Task
description` checkbox format, **ID**, **Tags**, **Details**,
**Files**, **Acceptance** metadata in bold labels indented under each
task. Completed tasks get removed (not `[x]`-marked) — history lives
in git log.

## Tool-specific conventions

### Plugin authoring

Every plugin under `src/plugins/` (or `plugins/` pre-TS-migration) is
a thin adapter over an existing tool per VISION.md:
- Must emit one or more audits via the `audits` array
- Must implement a `runner` that returns audit results
- Must gracefully skip when inputs are missing (see
  `coupling.plugin.ts` for the pattern — empty entries ⇒ zero-violation
  audit with `displayValue: "skipped — …"`)
- Custom analysis logic capped at ~30 lines per VISION.md boundaries

### ESLint custom rules

Live under `src/eslint-rules/`. Each rule must fill a gap no community
rule fills (VISION.md rule). Rules use `Rule.RuleModule` typing and
are exported from `src/eslint-rules/index.ts` as a `code-smells`
plugin. Current rules: `hook-count`, `use-effect-count`,
`unstable-selector-returns`, `domain-boundaries`.

### Category weights

Weights are integers in `code-pushup.config.ts`. Changing a weight is
an audit decision — update `docs/audit-review.md` with the before/after
and rationale.

### Tests

- Unit tests use mocked `dependency-cruiser`, `simple-git`,
  `codeowners-utils` to stay fast and offline
- Integration tests (`test/integration/plugins.spec.ts`) build real
  temp directories and run plugins end-to-end — use them when a bug
  could slip past mocks (the `coupling` graceful-skip fix is the
  canonical case)

## Links

- `VISION.md` — tool principles (curation + defaults + plumbing, not
  analysis logic; no forking, no vendoring, ≤30 lines custom per
  plugin)
- `docs/audit-review.md` — audit decision log
- `docs/ci-integration.md` — CI baseline+ratchet setup for target
  repos
- `docs/decisions/0001-axe-vs-jsx-a11y.md` — ADR on accessibility
  plugin choice
- `TASKS.md` — open work
