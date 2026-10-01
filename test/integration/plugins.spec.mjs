/**
 * Integration tests that exercise plugins against real temp-directory
 * fixtures. Unlike the unit tests in ../dep-cruiser-and-ownership-plugins
 * that mock dependency-cruiser and simple-git, these tests build actual
 * directory structures, run the plugins end-to-end, and assert on the
 * results.
 *
 * Purpose: catch failure modes the mocked tests can't see — notably
 * crashes that happen when the plugin's own input-resolution logic
 * hands bad paths to third-party libraries (the original reason this
 * file exists: running code-smells on a repo with a flat layout and no
 * top-level `src/` directory crashed dependency-cruiser).
 *
 * Layouts exercised:
 *   - src-only     — canonical single-package repo (src/foo.ts)
 *   - flat         — code-smells' own layout (plugins/*.mjs at root,
 *                    lib/*.mjs, no top-level src/, no workspace subdirs)
 *   - workspace    — monorepo (plugins/<ws>/src/*.ts layout)
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import couplingPlugin from "../../plugins/coupling.plugin.mjs";
import temporalCouplingPlugin from "../../plugins/temporal-coupling.plugin.mjs";

/**
 * Build a real temp directory with the given file tree. `files` is a
 * map of relative path → file contents. Creates parent directories as
 * needed. Returns the absolute temp path.
 */
const makeTempRepo = (files) => {
  const dir = mkdtempSync(join(tmpdir(), "code-smells-int-"));
  for (const [relPath, contents] of Object.entries(files)) {
    const abs = join(dir, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
  }
  return dir;
};

/**
 * Initialize a minimal git repo at `dir` with a single commit.
 * Needed for the temporal-coupling plugin which reads `git log`.
 * We bypass commit hooks (`--no-verify`) because the caller's local
 * git config might enforce conventional-commits on the fixture repo.
 */
const initGit = (dir) => {
  execSync("git init -q", { cwd: dir });
  execSync("git add -A", { cwd: dir });
  execSync(
    `git -c user.email=t@t -c user.name=test -c commit.gpgsign=false commit --no-verify -qm "feat: init"`,
    { cwd: dir },
  );
};

/** Directory cleanup after each test. Registered through beforeEach/afterEach. */
const cleanup = [];
beforeEach(() => {
  cleanup.length = 0;
});
afterEach(() => {
  for (const dir of cleanup) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("coupling plugin — integration", () => {
  it("works against a canonical src-only layout", async () => {
    const dir = makeTempRepo({
      "src/a.js": `import b from "./b.js"; export default b;`,
      "src/b.js": `export default 1;`,
    });
    cleanup.push(dir);

    const plugin = couplingPlugin({ targetDir: dir, entry: "src", fanOutThreshold: 10 });
    const [result] = await plugin.runner();

    expect(result.slug).toBe("high-fan-out");
    expect(result.value).toBe(0);
    expect(result.score).toBe(1);
  });

  it("gracefully skips on a flat repo with no src/ and no workspace subdirs", async () => {
    // This is the code-smells layout that regressed: `plugins/*.mjs`,
    // `lib/*.mjs`, no top-level `src/`, and no `plugins/<ws>/src/` so
    // the workspace auto-detection finds nothing. Before the fix, the
    // plugin's `resolveEntries` fallback returned `["src"]` which
    // dependency-cruiser statted and crashed on.
    const dir = makeTempRepo({
      "plugins/foo.mjs": `export default 1;`,
      "plugins/bar.mjs": `export default 2;`,
      "lib/helpers.mjs": `export const h = () => 1;`,
    });
    cleanup.push(dir);

    const plugin = couplingPlugin({ targetDir: dir, entry: "src" });

    // Must not throw.
    const [result] = await plugin.runner();

    expect(result.slug).toBe("high-fan-out");
    expect(result.value).toBe(0);
    expect(result.score).toBe(1);
    // Degraded mode must be visible in the display value so users
    // understand why the audit isn't reporting findings.
    expect(result.displayValue).toMatch(/skipped|no source/i);
  });

  it("auto-detects workspace subdirectories in a monorepo layout", async () => {
    const dir = makeTempRepo({
      "plugins/alpha/src/index.js": `import x from "./helper.js"; export default x;`,
      "plugins/alpha/src/helper.js": `export default 1;`,
      "libs/shared/src/index.js": `export const a = 1;`,
    });
    cleanup.push(dir);

    const plugin = couplingPlugin({ targetDir: dir, entry: "src", fanOutThreshold: 10 });
    const [result] = await plugin.runner();

    expect(result.slug).toBe("high-fan-out");
    expect(result.value).toBe(0);
    expect(result.score).toBe(1);
  });
});

describe("temporal-coupling plugin — integration", () => {
  it("works against a canonical src-only layout", async () => {
    const dir = makeTempRepo({
      "src/a.js": `export default 1;`,
      "src/b.js": `export default 2;`,
    });
    initGit(dir);
    cleanup.push(dir);

    const plugin = temporalCouplingPlugin({ targetDir: dir, days: 30 });
    const [result] = await plugin.runner();

    expect(result.slug).toBe("hidden-coupling");
    // One commit touching both files = 100% co-change but with
    // minPairCount default 3, so it shouldn't reach the threshold
    expect(result.value).toBe(0);
  });

  it("gracefully handles a flat repo with no src/", async () => {
    const dir = makeTempRepo({
      "plugins/foo.mjs": `export default 1;`,
      "lib/helpers.mjs": `export const h = () => 1;`,
    });
    initGit(dir);
    cleanup.push(dir);

    const plugin = temporalCouplingPlugin({ targetDir: dir, days: 30 });

    // Must not throw. Before the fix, resolveEntries here also returned
    // ["src"] and dependency-cruiser crashed on stat.
    const [result] = await plugin.runner();

    expect(result.slug).toBe("hidden-coupling");
    expect(result.score).toBe(1);
  });
});
