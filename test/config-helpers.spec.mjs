import { afterEach, describe, expect, it, vi } from "vitest";
import { dirname, resolve } from "node:path";
import {
  buildSecurityRefs,
  detectPackageManager,
  filterCategories,
  pmSlugPrefix,
  resolveDefaultPatterns,
  resolveLcovPath,
  resolveTsconfigInputs,
  stripJsonComments,
} from "../lib/config-helpers.mjs";

describe("resolveDefaultPatterns", () => {
  it("returns src glob when targetDir has src/", () => {
    const fsExists = (p) => p.endsWith("/src");
    expect(resolveDefaultPatterns("/t", fsExists)).toBe("src/**/*.{ts,tsx}");
  });

  it("returns single-workspace glob when only plugins/ exists", () => {
    const fsExists = (p) => p.endsWith("/plugins");
    expect(resolveDefaultPatterns("/t", fsExists)).toBe("plugins/*/src/**/*.{ts,tsx}");
  });

  it("returns brace-expanded glob for multi-workspace monorepo", () => {
    const fsExists = (p) => p.endsWith("/plugins") || p.endsWith("/libs");
    expect(resolveDefaultPatterns("/t", fsExists)).toBe("{plugins,libs}/*/src/**/*.{ts,tsx}");
  });

  it("covers all three workspace dirs when present", () => {
    const fsExists = () => true; // every path exists including src/
    expect(resolveDefaultPatterns("/t", fsExists)).toBe("src/**/*.{ts,tsx}");
    const noSrc = (p) => !p.endsWith("/src");
    expect(resolveDefaultPatterns("/t", noSrc)).toBe(
      "{plugins,libs,packages}/*/src/**/*.{ts,tsx}",
    );
  });

  it("falls back to single-package default when nothing exists", () => {
    const fsExists = () => false;
    expect(resolveDefaultPatterns("/t", fsExists)).toBe("src/**/*.{ts,tsx}");
  });
});

describe("detectPackageManager", () => {
  it.each([
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn-classic"],
    ["package-lock.json", "npm"],
  ])("detects %s → %s", (lockfile, expected) => {
    const fsExists = (p) => p.endsWith("/" + lockfile);
    expect(detectPackageManager("/t", fsExists)).toBe(expected);
  });

  it("returns null when no lockfile present", () => {
    expect(detectPackageManager("/t", () => false)).toBeNull();
  });

  it("pnpm wins over yarn/npm lockfiles (checked first)", () => {
    const fsExists = () => true;
    expect(detectPackageManager("/t", fsExists)).toBe("pnpm");
  });
});

describe("stripJsonComments", () => {
  it("strips line comments", () => {
    expect(stripJsonComments('{ "a": 1 // line comment\n}')).toBe('{ "a": 1 \n}');
  });

  it("strips block comments", () => {
    expect(stripJsonComments('{ /* block */ "a": 1 }')).toBe('{  "a": 1 }');
  });

  it("preserves URLs in strings (doesn't over-match //)", () => {
    // The regex is intentionally conservative — it requires a non-colon
    // character before // so "http://" inside strings isn't stripped.
    const input = '{ "url": "http://example.com" }';
    expect(stripJsonComments(input)).toBe(input);
  });

  it("strips multiline block comments", () => {
    expect(stripJsonComments('{\n/* a\nmultiline\ncomment */\n"a": 1\n}')).toContain('"a": 1');
    expect(stripJsonComments('{\n/* a\nmultiline\ncomment */\n"a": 1\n}')).not.toContain("multiline");
  });
});

describe("pmSlugPrefix", () => {
  it.each([
    ["yarn-classic", "yarn-classic"],
    ["yarn-modern", "yarn-modern"],
    ["pnpm", "pnpm"],
    ["npm", "npm"],
    [null, "npm"],
    [undefined, "npm"],
    ["anything-else", "npm"],
  ])("pmSlugPrefix(%j) === %j", (pm, expected) => {
    expect(pmSlugPrefix(pm)).toBe(expected);
  });
});

describe("buildSecurityRefs", () => {
  it("builds 4 refs for npm", () => {
    const refs = buildSecurityRefs("npm");
    expect(refs).toHaveLength(4);
    expect(refs.map((r) => r.slug)).toEqual([
      "npm-audit-prod",
      "npm-audit-dev",
      "npm-outdated-prod",
      "npm-outdated-dev",
    ]);
  });

  it("applies pnpm prefix", () => {
    const refs = buildSecurityRefs("pnpm");
    expect(refs[0].slug).toBe("pnpm-audit-prod");
  });

  it("applies yarn-classic prefix", () => {
    const refs = buildSecurityRefs("yarn-classic");
    expect(refs[0].slug).toBe("yarn-classic-audit-prod");
  });

  it("weights match the canonical order", () => {
    expect(buildSecurityRefs("npm").map((r) => r.weight)).toEqual([3, 2, 1, 0]);
  });
});

describe("filterCategories", () => {
  const DECLARED = [
    {
      slug: "a",
      refs: [
        { plugin: "p1", slug: "x" },
        { plugin: "missing-plugin", slug: "y" },
      ],
    },
    {
      slug: "b",
      refs: [{ plugin: "missing-plugin", slug: "z" }],
    },
    {
      slug: "security",
      refs: [{ plugin: "declared-but-replaced", slug: "old" }],
    },
  ];
  const REGISTERED = new Set(["p1::x", "js-packages::npm-audit-prod"]);
  const SEC_REFS = [{ plugin: "js-packages", slug: "npm-audit-prod", weight: 3 }];

  it("drops refs pointing at unregistered audits", () => {
    const out = filterCategories(DECLARED, REGISTERED, SEC_REFS);
    const a = out.find((c) => c.slug === "a");
    expect(a.refs).toHaveLength(1);
    expect(a.refs[0].slug).toBe("x");
  });

  it("drops categories whose refs all disappear", () => {
    const out = filterCategories(DECLARED, REGISTERED, SEC_REFS);
    expect(out.find((c) => c.slug === "b")).toBeUndefined();
  });

  it("swaps securityRefs in for the security category", () => {
    const out = filterCategories(DECLARED, REGISTERED, SEC_REFS);
    const sec = out.find((c) => c.slug === "security");
    expect(sec.refs).toEqual(SEC_REFS);
  });
});

describe("resolveLcovPath", () => {
  it("honors CP_COVERAGE_LCOV when the file exists", () => {
    const existsAtExplicit = (p) => p.endsWith("my-coverage/lcov.info");
    const result = resolveLcovPath(
      "/t",
      { CP_COVERAGE_LCOV: "my-coverage/lcov.info" },
      existsAtExplicit,
    );
    expect(result).toBe(resolve("/t/my-coverage/lcov.info"));
  });

  it("falls through to default candidates if explicit path doesn't exist", () => {
    const fsExists = (p) => p.endsWith("coverage/lcov.info");
    const result = resolveLcovPath(
      "/t",
      { CP_COVERAGE_LCOV: "nonexistent/lcov.info" },
      fsExists,
    );
    expect(result).toBe(resolve("/t/coverage/lcov.info"));
  });

  it("returns undefined when no candidate exists", () => {
    expect(resolveLcovPath("/t", {}, () => false)).toBeUndefined();
  });

  it("prefers coverage/ over reports/coverage/ (first-match)", () => {
    const fsExists = (p) =>
      p.endsWith("coverage/lcov.info") || p.endsWith("reports/coverage/lcov.info");
    const result = resolveLcovPath("/t", {}, fsExists);
    expect(result).toBe(resolve("/t/coverage/lcov.info"));
  });
});

describe("resolveTsconfigInputs", () => {
  const ROOT = "/t/tsconfig.json";

  it("honors CP_TSCONFIG (single path)", () => {
    const result = resolveTsconfigInputs(
      ROOT,
      "/t",
      { CP_TSCONFIG: "tsconfig.custom.json" },
      () => "{}",
      () => true,
    );
    expect(result).toEqual([resolve("/t/tsconfig.custom.json")]);
  });

  it("honors CP_TSCONFIG (comma-separated list)", () => {
    const result = resolveTsconfigInputs(
      ROOT,
      "/t",
      { CP_TSCONFIG: "tsconfig.a.json, tsconfig.b.json" },
      () => "{}",
      () => true,
    );
    expect(result).toEqual([resolve("/t/tsconfig.a.json"), resolve("/t/tsconfig.b.json")]);
  });

  it("expands references when root has no files/include", () => {
    const tsconfig = JSON.stringify({
      references: [{ path: "./libs/a" }, { path: "./libs/b/tsconfig.json" }],
    });
    const result = resolveTsconfigInputs(
      ROOT,
      "/t",
      {},
      () => tsconfig,
      () => true,
    );
    // First entry has no .json extension → resolve to /libs/a/tsconfig.json
    expect(result[0]).toBe(resolve("/t/libs/a/tsconfig.json"));
    expect(result[1]).toBe(resolve("/t/libs/b/tsconfig.json"));
  });

  it("falls back to the root when references are present with files", () => {
    const tsconfig = JSON.stringify({
      references: [{ path: "./libs/a" }],
      files: ["src/index.ts"],
    });
    const result = resolveTsconfigInputs(
      ROOT,
      "/t",
      {},
      () => tsconfig,
      () => true,
    );
    expect(result).toEqual([ROOT]);
  });

  it("falls back to the root when references are present with include", () => {
    const tsconfig = JSON.stringify({
      references: [{ path: "./libs/a" }],
      include: ["src/**/*"],
    });
    const result = resolveTsconfigInputs(
      ROOT,
      "/t",
      {},
      () => tsconfig,
      () => true,
    );
    expect(result).toEqual([ROOT]);
  });

  it("falls back to the root when tsconfig is unparseable", () => {
    const result = resolveTsconfigInputs(
      ROOT,
      "/t",
      {},
      () => "not JSON",
      () => true,
    );
    expect(result).toEqual([ROOT]);
  });

  it("filters out references whose resolved tsconfig doesn't exist", () => {
    const tsconfig = JSON.stringify({
      references: [{ path: "./libs/a" }, { path: "./libs/vanished" }],
    });
    const fsExists = (p) => !p.includes("vanished");
    const result = resolveTsconfigInputs(
      ROOT,
      "/t",
      {},
      () => tsconfig,
      fsExists,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("libs/a");
  });

  it("treats root with no references as single-path input", () => {
    const tsconfig = JSON.stringify({ files: ["src/index.ts"] });
    const result = resolveTsconfigInputs(
      ROOT,
      "/t",
      {},
      () => tsconfig,
      () => true,
    );
    expect(result).toEqual([ROOT]);
  });

  it("treats root with empty references as single-path input", () => {
    const tsconfig = JSON.stringify({ references: [] });
    const result = resolveTsconfigInputs(
      ROOT,
      "/t",
      {},
      () => tsconfig,
      () => true,
    );
    expect(result).toEqual([ROOT]);
  });

  it("tolerates tsconfig read errors gracefully", () => {
    const result = resolveTsconfigInputs(
      ROOT,
      "/t",
      {},
      () => {
        throw new Error("ENOENT");
      },
      () => true,
    );
    expect(result).toEqual([ROOT]);
  });
});
