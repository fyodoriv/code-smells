import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the 4 subprocess/library-wrapper plugins — knip, duplication,
 * type-coverage, eslint. We mock the underlying tool (spawnSync for CLI
 * wrappers, the Node API for type-coverage-core and ESLint) and assert
 * on the audits returned.
 */

const mockSpawnSync = vi.fn();
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockRmSync = vi.fn();
const mockLint = vi.fn();
// The plugin does `new ESLint(...)` then `.lintFiles()` on the instance.
// Must mock as a real class — arrow/function mocks aren't constructable.
const mockLintFiles = vi.fn();

vi.mock("node:child_process", () => ({ spawnSync: mockSpawnSync }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: (p) => mockExistsSync(p),
    readFileSync: (p, enc) => mockReadFileSync(p, enc),
    mkdirSync: (p, opts) => mockMkdirSync(p, opts),
    rmSync: (p, opts) => mockRmSync(p, opts),
  };
});
vi.mock("type-coverage-core", () => ({ lint: mockLint }));
vi.mock("eslint", () => ({
  ESLint: class {
    constructor(options) {
      this.options = options;
      this.lintFiles = mockLintFiles;
    }
  },
}));

afterEach(() => {
  mockSpawnSync.mockReset();
  mockExistsSync.mockReset();
  mockReadFileSync.mockReset();
  mockMkdirSync.mockReset();
  mockRmSync.mockReset();
  mockLint.mockReset();
  mockLintFiles.mockReset();
});

const { default: knipPlugin } = await import("../plugins/knip.plugin.mjs");
const { default: duplicationPlugin } = await import("../plugins/duplication.plugin.mjs");
const { default: typeCoveragePlugin } = await import("../plugins/type-coverage.plugin.mjs");
const { default: eslintPlugin } = await import("../plugins/eslint.plugin.mjs");

describe("knipPlugin", () => {
  const setupKnipPackageJsonLookup = () => {
    // resolveKnipBinJs walks up from require.resolve("knip") looking for
    // a package.json whose name is "knip". We fake that lookup so the
    // plugin can pick a binJs without needing the real package.
    mockExistsSync.mockImplementation((p) => p.toString().endsWith("package.json"));
    mockReadFileSync.mockImplementation((p) => {
      if (p.toString().endsWith("package.json")) {
        return JSON.stringify({ name: "knip", bin: { knip: "./bin/knip.js" } });
      }
      return "{}";
    });
  };

  it("builds a plugin config with 4 audits", () => {
    setupKnipPackageJsonLookup();
    const plugin = knipPlugin({ targetDir: "/t" });
    expect(plugin.slug).toBe("knip");
    expect(plugin.audits).toHaveLength(4);
    const slugs = plugin.audits.map((a) => a.slug).sort();
    expect(slugs).toEqual([
      "unlisted-dependencies",
      "unresolved-imports",
      "unused-exports",
      "unused-files",
    ]);
  });

  it("runner returns empty audits when knip produces no output", async () => {
    setupKnipPackageJsonLookup();
    mockSpawnSync.mockReturnValueOnce({ stdout: "" });
    const plugin = knipPlugin({ targetDir: "/t" });
    const results = await plugin.runner();
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.value === 0 && r.score === 1)).toBe(true);
  });

  it("runner returns empty audits when stdout is whitespace", async () => {
    setupKnipPackageJsonLookup();
    mockSpawnSync.mockReturnValueOnce({ stdout: "   \n" });
    const plugin = knipPlugin({ targetDir: "/t" });
    const results = await plugin.runner();
    expect(results.every((r) => r.value === 0)).toBe(true);
  });

  it("runner parses knip JSON output and emits issues", async () => {
    setupKnipPackageJsonLookup();
    mockSpawnSync.mockReturnValueOnce({
      stdout: JSON.stringify({
        files: ["src/dead.ts"],
        issues: {
          "src/a.ts": {
            exports: [
              { name: "unusedExport", line: 10 },
              { name: "anotherOne", line: 20 },
            ],
            unresolved: { key1: { name: "bad-import", line: 1 } },
            unlisted: [{ name: "leftpad", line: 3 }],
          },
        },
      }),
    });

    const plugin = knipPlugin({ targetDir: "/t" });
    const results = await plugin.runner();
    const [unusedFiles, unusedExports, unresolvedImports, unlistedDeps] = results;

    expect(unusedFiles.value).toBe(1);
    expect(unusedFiles.details.issues[0].source.file).toBe("src/dead.ts");
    expect(unusedExports.value).toBe(2);
    expect(unresolvedImports.value).toBe(1);
    expect(unlistedDeps.value).toBe(1);
    expect(unlistedDeps.details.issues[0].message).toBe("leftpad");
  });

  it("tolerates missing line/pos on issue entries", async () => {
    setupKnipPackageJsonLookup();
    mockSpawnSync.mockReturnValueOnce({
      stdout: JSON.stringify({
        files: [],
        issues: { "src/a.ts": { exports: [{ name: "x" }] } },
      }),
    });
    const plugin = knipPlugin({ targetDir: "/t" });
    const [, unusedExports] = await plugin.runner();
    expect(unusedExports.details.issues[0].source.position.startLine).toBe(1);
  });

  it("singularizes units in displayValue", async () => {
    setupKnipPackageJsonLookup();
    mockSpawnSync.mockReturnValueOnce({
      stdout: JSON.stringify({ files: ["src/a.ts"], issues: {} }),
    });
    const plugin = knipPlugin({ targetDir: "/t" });
    const [unusedFiles] = await plugin.runner();
    expect(unusedFiles.displayValue).toBe("1 file");
  });

  it("throws when knip package.json can't be located", async () => {
    // existsSync returns false everywhere — walk-up never finds knip
    mockExistsSync.mockReturnValue(false);
    const plugin = knipPlugin({ targetDir: "/t" });
    // Building the plugin config is pure — the failure happens inside
    // the runner when resolveKnipBinJs walks up and can't find knip.
    await expect(plugin.runner()).rejects.toThrow("Could not locate knip package root");
  });

  it("walk-up skips non-knip package.json entries", async () => {
    // Fake a parent directory with a package.json that's for a different
    // package first, then one for knip higher up. Tests the
    // `pkg.name === 'knip'` branch explicitly.
    let callCount = 0;
    mockExistsSync.mockImplementation((p) => p.toString().endsWith("package.json"));
    mockReadFileSync.mockImplementation((p) => {
      if (!p.toString().endsWith("package.json")) return "{}";
      callCount++;
      if (callCount === 1) return JSON.stringify({ name: "other-package" });
      return JSON.stringify({ name: "knip", bin: { knip: "./bin/knip.js" } });
    });
    mockSpawnSync.mockReturnValueOnce({ stdout: "" });
    const plugin = knipPlugin({ targetDir: "/t" });
    const results = await plugin.runner();
    expect(results).toHaveLength(4);
  });
});

describe("duplicationPlugin", () => {
  const setupJscpdLookup = () => {
    mockExistsSync.mockImplementation((p) => {
      // package.json lookup → true; also the jscpd-report.json
      const s = p.toString();
      if (s.endsWith("package.json")) return true;
      if (s.endsWith("jscpd-report.json")) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p) => {
      const s = p.toString();
      if (s.endsWith("package.json")) {
        return JSON.stringify({ name: "jscpd", bin: "./bin/jscpd.js" });
      }
      return "{}";
    });
  };

  it("builds a plugin config with duplicated-lines audit", () => {
    setupJscpdLookup();
    const plugin = duplicationPlugin({ targetDir: "/t" });
    expect(plugin.slug).toBe("duplication");
    expect(plugin.audits[0].slug).toBe("duplicated-lines");
  });

  it("parses a jscpd report and aggregates dup lines per file", async () => {
    setupJscpdLookup();
    mockSpawnSync.mockReturnValueOnce({ stdout: "" });
    mockReadFileSync.mockImplementation((p) => {
      const s = p.toString();
      if (s.endsWith("package.json")) {
        return JSON.stringify({ name: "jscpd", bin: "./bin/jscpd.js" });
      }
      if (s.endsWith("jscpd-report.json")) {
        return JSON.stringify({
          duplicates: [
            {
              firstFile: { name: "/t/src/a.ts", start: 1, end: 30 },
              secondFile: { name: "/t/src/b.ts", start: 1, end: 30 },
            },
            {
              firstFile: { name: "/t/src/c.ts", start: 1, end: 10 },
              secondFile: { name: "/t/src/d.ts", start: 1, end: 10 },
            },
          ],
        });
      }
      return "{}";
    });

    const plugin = duplicationPlugin({ targetDir: "/t", thresholdLines: 500 });
    const [result] = await plugin.runner();

    // totals: 29 + 9 = 38 duplicated lines
    expect(result.value).toBe(38);
    // Each file gets its own issue; the biggest first (29-line dups).
    expect(result.details.issues.length).toBeGreaterThan(0);
    expect(result.details.issues[0].message).toContain("29 duplicated lines");
  });

  it("score decays linearly to 0 when dup-lines reach threshold", async () => {
    setupJscpdLookup();
    mockSpawnSync.mockReturnValueOnce({ stdout: "" });
    mockReadFileSync.mockImplementation((p) => {
      const s = p.toString();
      if (s.endsWith("package.json")) {
        return JSON.stringify({ name: "jscpd", bin: "./bin/jscpd.js" });
      }
      return JSON.stringify({
        duplicates: [
          {
            firstFile: { name: "/t/a.ts", start: 1, end: 251 },
            secondFile: { name: "/t/b.ts", start: 1, end: 251 },
          },
        ],
      });
    });

    const plugin = duplicationPlugin({ targetDir: "/t", thresholdLines: 250 });
    const [result] = await plugin.runner();
    expect(result.score).toBe(0);
  });

  it("handles missing report file gracefully", async () => {
    mockExistsSync.mockImplementation((p) => p.toString().endsWith("package.json"));
    mockReadFileSync.mockReturnValueOnce(
      JSON.stringify({ name: "jscpd", bin: "./bin/jscpd.js" }),
    );
    mockSpawnSync.mockReturnValueOnce({ stdout: "" });
    const plugin = duplicationPlugin({ targetDir: "/t" });
    const [result] = await plugin.runner();
    expect(result.value).toBe(0);
    expect(result.score).toBe(1);
  });

  it("assigns severity based on duplicated line count per file", async () => {
    setupJscpdLookup();
    mockSpawnSync.mockReturnValueOnce({ stdout: "" });
    mockReadFileSync.mockImplementation((p) => {
      const s = p.toString();
      if (s.endsWith("package.json")) {
        return JSON.stringify({ name: "jscpd", bin: "./bin/jscpd.js" });
      }
      return JSON.stringify({
        duplicates: [
          // 60 lines → error
          {
            firstFile: { name: "/t/hot.ts", start: 1, end: 61 },
            secondFile: { name: "/t/hot2.ts", start: 1, end: 61 },
          },
          // 25 lines → warning
          {
            firstFile: { name: "/t/warm.ts", start: 1, end: 26 },
            secondFile: { name: "/t/warm2.ts", start: 1, end: 26 },
          },
          // 5 lines → info
          {
            firstFile: { name: "/t/cool.ts", start: 1, end: 6 },
            secondFile: { name: "/t/cool2.ts", start: 1, end: 6 },
          },
        ],
      });
    });
    const plugin = duplicationPlugin({ targetDir: "/t" });
    const [result] = await plugin.runner();
    const sevs = result.details.issues.map((i) => i.severity);
    expect(sevs).toContain("error");
    expect(sevs).toContain("warning");
    expect(sevs).toContain("info");
  });

  it("handles a duplicate with missing file fields", async () => {
    setupJscpdLookup();
    mockSpawnSync.mockReturnValueOnce({ stdout: "" });
    mockReadFileSync.mockImplementation((p) => {
      const s = p.toString();
      if (s.endsWith("package.json")) {
        return JSON.stringify({ name: "jscpd", bin: "./bin/jscpd.js" });
      }
      return JSON.stringify({
        duplicates: [
          // Missing secondFile entirely
          { firstFile: { name: "/t/a.ts", start: 1, end: 10 } },
        ],
      });
    });
    const plugin = duplicationPlugin({ targetDir: "/t" });
    const [result] = await plugin.runner();
    expect(result.value).toBe(9);
  });

  it("respects the ignore option", async () => {
    setupJscpdLookup();
    mockSpawnSync.mockReturnValueOnce({ stdout: "" });
    const plugin = duplicationPlugin({
      targetDir: "/t",
      patterns: "**/*.ts",
      ignore: ["**/generated/**", "**/vendor/**"],
    });
    await plugin.runner();
    const callArgs = mockSpawnSync.mock.calls[0][1];
    expect(callArgs).toContain("--ignore");
    expect(callArgs).toContain("**/generated/**,**/vendor/**");
  });
});

describe("typeCoveragePlugin", () => {
  // Use a real existing directory so the plugin's process.chdir() works.
  // The plugin only reads the filesystem for the tsconfig existence check,
  // which we stub via mockExistsSync.
  const REAL_DIR = process.cwd();

  it("builds a plugin config", () => {
    const plugin = typeCoveragePlugin({ targetDir: REAL_DIR });
    expect(plugin.slug).toBe("type-coverage");
    expect(plugin.audits[0].slug).toBe("type-coverage-percentage");
  });

  it("skips gracefully when no tsconfig.json is present", async () => {
    mockExistsSync.mockReturnValueOnce(false);
    const plugin = typeCoveragePlugin({ targetDir: REAL_DIR });
    const [result] = await plugin.runner();
    expect(result.displayValue).toContain("skipped");
    expect(result.score).toBe(1);
    expect(result.value).toBe(100);
  });

  it("reports type coverage percentage when tsconfig exists", async () => {
    mockExistsSync.mockReturnValueOnce(true);
    mockLint.mockResolvedValueOnce({
      correctCount: 900,
      totalCount: 1000,
      anys: [
        { file: "/t/a.ts", line: 5, text: "any" },
        { file: "/t/a.ts", line: 7, text: "any" },
        { file: "/t/b.ts", line: 3, text: "as any" },
      ],
    });

    const plugin = typeCoveragePlugin({ targetDir: REAL_DIR });
    const [result] = await plugin.runner();
    expect(result.value).toBe(90);
    expect(result.score).toBe(0.9);
    expect(result.displayValue).toContain("90%");
    // a.ts appears first (2 anys > 1 any)
    expect(result.details.issues[0].source.file).toBe("/t/a.ts");
  });

  it("handles empty totalCount (no files)", async () => {
    mockExistsSync.mockReturnValueOnce(true);
    mockLint.mockResolvedValueOnce({ correctCount: 0, totalCount: 0, anys: [] });
    const plugin = typeCoveragePlugin({ targetDir: REAL_DIR });
    const [result] = await plugin.runner();
    expect(result.score).toBe(1);
    expect(result.value).toBe(100);
  });

  it("assigns 'error' severity when a file has more than 10 anys", async () => {
    mockExistsSync.mockReturnValueOnce(true);
    mockLint.mockResolvedValueOnce({
      correctCount: 50,
      totalCount: 100,
      anys: Array.from({ length: 15 }, (_, i) => ({
        file: "/t/hot.ts",
        line: i,
        text: "any",
      })),
    });
    const plugin = typeCoveragePlugin({ targetDir: REAL_DIR });
    const [result] = await plugin.runner();
    expect(result.details.issues[0].severity).toBe("error");
  });

  it("falls back line=1 when any has no line", async () => {
    mockExistsSync.mockReturnValueOnce(true);
    mockLint.mockResolvedValueOnce({
      correctCount: 10,
      totalCount: 100,
      anys: [{ file: "/t/a.ts" }],
    });
    const plugin = typeCoveragePlugin({ targetDir: REAL_DIR });
    const [result] = await plugin.runner();
    expect(result.details.issues[0].source.position.startLine).toBe(1);
  });

  it("restores cwd even if lint throws", async () => {
    mockExistsSync.mockReturnValueOnce(true);
    mockLint.mockRejectedValueOnce(new Error("tsconfig broken"));
    const originalCwd = process.cwd();
    const plugin = typeCoveragePlugin({ targetDir: REAL_DIR });
    await expect(plugin.runner()).rejects.toThrow("tsconfig broken");
    expect(process.cwd()).toBe(originalCwd);
  });
});

describe("eslintPlugin", () => {
  it("builds a plugin config with one audit per rule", async () => {
    // Build a fake flat-config the plugin can import.
    const fakeConfigMjs = "data:text/javascript," +
      encodeURIComponent(
        "export default [{ rules: { 'no-console': 'warn', 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } }];",
      );
    const plugin = await eslintPlugin({
      targetDir: "/t",
      eslintrc: fakeConfigMjs,
      patterns: ["src/**/*.ts"],
    });
    expect(plugin.slug).toBe("eslint");
    expect(plugin.audits).toHaveLength(2);
    // Slug = rule id with options hash suffix when options are provided
    const slugs = plugin.audits.map((a) => a.slug);
    expect(slugs.some((s) => s === "no-console")).toBe(true);
    expect(slugs.some((s) => s.startsWith("no-unused-vars-"))).toBe(true);
  });

  it("counts violations per rule", async () => {
    const fakeConfigMjs = "data:text/javascript," +
      encodeURIComponent(
        "export default [{ rules: { 'no-console': 'warn', 'no-unused-vars': 'error' } }];",
      );

    mockLintFiles.mockResolvedValueOnce([
      {
        filePath: "/t/src/a.ts",
        messages: [
          { ruleId: "no-console", message: "Unexpected console", line: 5, severity: 1 },
          { ruleId: "no-console", message: "Unexpected console", line: 6, severity: 1 },
          { ruleId: "no-unused-vars", message: "Unused var", line: 10, severity: 2 },
          { ruleId: null, message: "parse error", line: 1, severity: 2 }, // no ruleId → skip
          { ruleId: "unknown-rule", message: "other", line: 1, severity: 2 }, // not in rulesMap → skip
        ],
      },
    ]);

    const plugin = await eslintPlugin({
      targetDir: "/t",
      eslintrc: fakeConfigMjs,
      patterns: ["src/**/*.ts"],
    });
    const results = await plugin.runner();

    const byRule = new Map(results.map((r) => [r.title, r]));
    expect(byRule.get("no-console").value).toBe(2);
    expect(byRule.get("no-console").details.issues[0].severity).toBe("warning");
    expect(byRule.get("no-unused-vars").value).toBe(1);
    expect(byRule.get("no-unused-vars").details.issues[0].severity).toBe("error");
  });

  it("caps per-rule issues at 50", async () => {
    const fakeConfigMjs = "data:text/javascript," +
      encodeURIComponent("export default [{ rules: { 'no-console': 'warn' } }];");

    const manyMessages = Array.from({ length: 100 }, (_, i) => ({
      ruleId: "no-console",
      message: `console ${i}`,
      line: i,
      severity: 1,
    }));
    mockLintFiles.mockResolvedValueOnce([
      { filePath: "/t/src/a.ts", messages: manyMessages },
    ]);

    const plugin = await eslintPlugin({
      targetDir: "/t",
      eslintrc: fakeConfigMjs,
      patterns: ["src/**/*.ts"],
    });
    const [result] = await plugin.runner();
    expect(result.value).toBe(100);
    expect(result.details.issues).toHaveLength(50);
  });

  it("returns 'no violations' display when clean", async () => {
    const fakeConfigMjs = "data:text/javascript," +
      encodeURIComponent("export default [{ rules: { 'no-console': 'warn' } }];");
    mockLintFiles.mockResolvedValueOnce([{ filePath: "/t/src/a.ts", messages: [] }]);

    const plugin = await eslintPlugin({
      targetDir: "/t",
      eslintrc: fakeConfigMjs,
      patterns: ["src/**/*.ts"],
    });
    const [result] = await plugin.runner();
    expect(result.displayValue).toBe("no violations");
    expect(result.score).toBe(1);
  });

  it("handles missing message fields defensively", async () => {
    const fakeConfigMjs = "data:text/javascript," +
      encodeURIComponent("export default [{ rules: { 'no-console': 'warn' } }];");

    mockLintFiles.mockResolvedValueOnce([
      {
        filePath: "/t/src/a.ts",
        // line missing → falls back to 1; message truncated to 300
        messages: [
          {
            ruleId: "no-console",
            message: "a".repeat(500),
            severity: 1,
          },
        ],
      },
    ]);

    const plugin = await eslintPlugin({
      targetDir: "/t",
      eslintrc: fakeConfigMjs,
      patterns: ["src/**/*.ts"],
    });
    const [result] = await plugin.runner();
    expect(result.details.issues[0].source.position.startLine).toBe(1);
    expect(result.details.issues[0].message.length).toBe(300);
  });

  it("handles multiple config blocks by merging rules", async () => {
    const fakeConfigMjs = "data:text/javascript," +
      encodeURIComponent(
        "export default [{ rules: { 'no-console': 'warn' } }, { rules: { 'no-debugger': 'error' } }];",
      );
    const plugin = await eslintPlugin({
      targetDir: "/t",
      eslintrc: fakeConfigMjs,
      patterns: ["src/**/*.ts"],
    });
    expect(plugin.audits).toHaveLength(2);
  });

  it("uses violation count for displayValue pluralization", async () => {
    const fakeConfigMjs = "data:text/javascript," +
      encodeURIComponent("export default [{ rules: { 'no-console': 'warn' } }];");
    mockLintFiles.mockResolvedValueOnce([
      {
        filePath: "/t/a.ts",
        messages: [{ ruleId: "no-console", message: "m", line: 1, severity: 1 }],
      },
    ]);
    const plugin = await eslintPlugin({
      targetDir: "/t",
      eslintrc: fakeConfigMjs,
      patterns: ["src/**/*.ts"],
    });
    const [r] = await plugin.runner();
    expect(r.displayValue).toBe("1 violation");
  });
});
