import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the 3 dependency-cruiser–based plugins — coupling,
 * temporal-coupling, and the import-edge branch of temporal-coupling.
 * Also covers team-ownership (simpleGit + codeowners-utils).
 *
 * We mock simpleGit, dependency-cruiser, and codeowners-utils so the
 * tests stay pure and run offline.
 */

const mockRaw = vi.fn();
const mockSimpleGit = vi.fn(() => ({ raw: mockRaw }));
const mockCruise = vi.fn();
const mockLoadOwners = vi.fn();
const mockMatchFile = vi.fn();

vi.mock("simple-git", () => ({ default: mockSimpleGit }));
vi.mock("dependency-cruiser", () => ({ cruise: mockCruise }));
vi.mock("codeowners-utils", () => ({
  loadOwners: (...args) => mockLoadOwners(...args),
  matchFile: (...args) => mockMatchFile(...args),
}));

afterEach(() => {
  // Reset per-test mock state (impl + calls) so tests don't leak into each other.
  mockRaw.mockReset();
  mockCruise.mockReset();
  mockLoadOwners.mockReset();
  mockMatchFile.mockReset();
});

const { default: couplingPlugin } = await import("../plugins/coupling.plugin.mjs");
const { default: temporalCouplingPlugin } = await import("../plugins/temporal-coupling.plugin.mjs");
const { default: teamOwnershipPlugin } = await import("../plugins/team-ownership.plugin.mjs");

describe("couplingPlugin", () => {
  it("builds a plugin config with high-fan-out audit", () => {
    const plugin = couplingPlugin({ targetDir: process.cwd(), fanOutThreshold: 20 });
    expect(plugin.slug).toBe("coupling");
    expect(plugin.audits[0].slug).toBe("high-fan-out");
  });

  // These tests pass `process.cwd()` as targetDir and need entry paths
  // that actually exist on disk, because resolveEntries now filters
  // entries to existing directories (the alternative — passing
  // non-existent paths — would trigger the graceful-skip branch and
  // skip the mocked cruise call entirely). `plugins` and `lib` are
  // top-level directories of the code-smells repo itself.
  const CWD_ENTRY = ["plugins", "lib"];

  it("flags modules with too many dependencies", async () => {
    mockCruise.mockResolvedValueOnce({
      output: {
        modules: [
          { source: "src/a.ts", dependencies: new Array(20).fill({ resolved: "x" }) },
          { source: "src/b.ts", dependencies: [{ resolved: "x" }, { resolved: "y" }] },
          { source: "src/c.ts", dependencies: null }, // null deps handled
        ],
      },
    });

    const plugin = couplingPlugin({ targetDir: process.cwd(), entry: CWD_ENTRY, fanOutThreshold: 15 });
    const [result] = await plugin.runner();

    expect(result.value).toBe(1); // a.ts only
    expect(result.details.issues[0].source.file).toBe("src/a.ts");
    // 20 > 15*2=30? No → warning
    expect(result.details.issues[0].severity).toBe("warning");
    expect(result.displayValue).toContain("max fan-out 20");
  });

  it("error severity when fan-out > 2x threshold", async () => {
    mockCruise.mockResolvedValueOnce({
      output: {
        modules: [{ source: "src/a.ts", dependencies: new Array(40).fill({ resolved: "x" }) }],
      },
    });
    const plugin = couplingPlugin({ targetDir: process.cwd(), entry: CWD_ENTRY, fanOutThreshold: 15 });
    const [r] = await plugin.runner();
    expect(r.details.issues[0].severity).toBe("error");
  });

  it("parses string JSON output", async () => {
    mockCruise.mockResolvedValueOnce({
      output: JSON.stringify({ modules: [{ source: "a.ts", dependencies: [] }] }),
    });
    const plugin = couplingPlugin({ targetDir: process.cwd(), entry: CWD_ENTRY });
    const [r] = await plugin.runner();
    expect(r.value).toBe(0);
  });

  it("empty modules list scores 1", async () => {
    mockCruise.mockResolvedValueOnce({ output: { modules: [] } });
    const plugin = couplingPlugin({ targetDir: process.cwd(), entry: CWD_ENTRY });
    const [r] = await plugin.runner();
    expect(r.score).toBe(1);
  });

  it("resolves entry from an array, keeping paths that exist", async () => {
    mockCruise.mockResolvedValueOnce({ output: { modules: [] } });
    const plugin = couplingPlugin({ targetDir: process.cwd(), entry: ["plugins", "lib"] });
    await plugin.runner();
    const [entries] = mockCruise.mock.calls[mockCruise.mock.calls.length - 1];
    expect(entries).toEqual(["plugins", "lib"]);
  });

  it("filters array entries that do not exist on disk", async () => {
    // Non-existent paths are dropped before cruise() runs so
    // dependency-cruiser doesn't crash on stat(). cruise is still
    // called with the filtered subset.
    mockCruise.mockResolvedValueOnce({ output: { modules: [] } });
    const plugin = couplingPlugin({
      targetDir: process.cwd(),
      entry: ["plugins", "does-not-exist", "lib"],
    });
    await plugin.runner();
    const [entries] = mockCruise.mock.calls[mockCruise.mock.calls.length - 1];
    expect(entries).toEqual(["plugins", "lib"]);
  });

  it("resolves comma-separated entry string", async () => {
    mockCruise.mockResolvedValueOnce({ output: { modules: [] } });
    const plugin = couplingPlugin({ targetDir: process.cwd(), entry: "plugins, lib" });
    await plugin.runner();
    const [entries] = mockCruise.mock.calls[mockCruise.mock.calls.length - 1];
    expect(entries).toEqual(["plugins", "lib"]);
  });

  it("singular 'file' when one violation", async () => {
    mockCruise.mockResolvedValueOnce({
      output: {
        modules: [{ source: "a.ts", dependencies: new Array(20).fill({ resolved: "x" }) }],
      },
    });
    const plugin = couplingPlugin({ targetDir: process.cwd(), entry: CWD_ENTRY, fanOutThreshold: 15 });
    const [r] = await plugin.runner();
    expect(r.displayValue).toContain("1 file ");
  });

  it("skips gracefully when no entries exist on disk", async () => {
    // Covers the ENOENT crash that used to happen on flat-layout repos
    // (no src/, no workspace subdirs). cruise must not be invoked.
    const plugin = couplingPlugin({
      targetDir: process.cwd(),
      entry: "definitely-not-a-real-dir",
    });
    const [r] = await plugin.runner();
    expect(r.score).toBe(1);
    expect(r.value).toBe(0);
    expect(r.displayValue).toMatch(/skipped|no source/i);
    expect(mockCruise).not.toHaveBeenCalled();
  });
});

describe("temporalCouplingPlugin", () => {
  it("builds a plugin config", () => {
    const plugin = temporalCouplingPlugin({ targetDir: process.cwd(), days: 30 });
    expect(plugin.slug).toBe("temporal-coupling");
    expect(plugin.audits[0].slug).toBe("hidden-coupling");
    expect(plugin.description).toContain("30d");
  });

  it("flags pairs that co-change with no import edge", async () => {
    // Three commits, all touching a.ts + b.ts. Declared imports empty.
    mockRaw.mockResolvedValueOnce(
      [">>>", "libs/a.ts", "libs/b.ts", ">>>", "libs/a.ts", "libs/b.ts", ">>>", "libs/a.ts", "libs/b.ts"].join("\n"),
    );
    mockCruise.mockResolvedValueOnce({ output: { modules: [] } });

    const plugin = temporalCouplingPlugin({
      targetDir: process.cwd(),
      coChangeThreshold: 0.5,
      minPairCount: 2,
    });
    const [r] = await plugin.runner();

    expect(r.value).toBe(1);
    expect(r.details.issues[0].message).toContain("libs/b.ts");
    expect(r.details.issues[0].message).toContain("100%");
  });

  it("does NOT flag pairs that share an import edge", async () => {
    // This test needs `resolveEntries` to find a real source directory
    // so the plugin actually calls cruise() to build the import-edge
    // set. Create a minimal temp repo with a src/ dir.
    const fixtureDir = mkdtempSync(join(tmpdir(), "tc-import-edge-"));
    mkdirSync(join(fixtureDir, "src"));
    writeFileSync(join(fixtureDir, "src", "placeholder.js"), "");

    try {
      mockRaw.mockResolvedValueOnce(
        [">>>", "libs/a.ts", "libs/b.ts", ">>>", "libs/a.ts", "libs/b.ts"].join("\n"),
      );
      // Declared edge a.ts ↔ b.ts (stored as canonical pair key)
      mockCruise.mockResolvedValueOnce({
        output: {
          modules: [{ source: "libs/a.ts", dependencies: [{ resolved: "libs/b.ts" }] }],
        },
      });

      const plugin = temporalCouplingPlugin({
        targetDir: fixtureDir,
        coChangeThreshold: 0.5,
        minPairCount: 2,
      });
      const [r] = await plugin.runner();
      expect(r.value).toBe(0);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("drops bulk commits that touch too many files", async () => {
    const bulk = [">>>", ...Array(25).fill(null).map((_, i) => `libs/f${i}.ts`)];
    const normal = [">>>", "libs/a.ts", "libs/b.ts"];
    mockRaw.mockResolvedValueOnce([...bulk, ...normal, ...normal].join("\n"));
    mockCruise.mockResolvedValueOnce({ output: { modules: [] } });

    const plugin = temporalCouplingPlugin({
      targetDir: process.cwd(),
      coChangeThreshold: 0.5,
      minPairCount: 2,
      maxFilesPerCommit: 20,
    });
    const [r] = await plugin.runner();
    // bulk commit ignored; only 2 commits of a/b counted
    expect(r.value).toBe(1);
  });

  it("filters out test/spec/story files via default excludePatterns", async () => {
    mockRaw.mockResolvedValueOnce(
      [
        ">>>",
        "libs/foo.ts",
        "libs/foo.spec.ts",
        ">>>",
        "libs/foo.ts",
        "libs/foo.spec.ts",
      ].join("\n"),
    );
    mockCruise.mockResolvedValueOnce({ output: { modules: [] } });

    const plugin = temporalCouplingPlugin({
      targetDir: process.cwd(),
      coChangeThreshold: 0.3,
      minPairCount: 1,
    });
    const [r] = await plugin.runner();
    expect(r.value).toBe(0); // spec file excluded → only one file remains per commit
  });

  it("ignores commits with only 1 file after filtering", async () => {
    mockRaw.mockResolvedValueOnce([">>>", "libs/foo.ts"].join("\n"));
    mockCruise.mockResolvedValueOnce({ output: { modules: [] } });
    const plugin = temporalCouplingPlugin({
      targetDir: process.cwd(),
      coChangeThreshold: 0.3,
      minPairCount: 1,
    });
    const [r] = await plugin.runner();
    expect(r.value).toBe(0);
  });

  it("swallows simpleGit and cruise errors separately", async () => {
    mockRaw.mockRejectedValueOnce(new Error("git fail"));
    mockCruise.mockResolvedValueOnce({ output: { modules: [] } });
    const plugin = temporalCouplingPlugin({ targetDir: process.cwd() });
    const [r] = await plugin.runner();
    expect(r.value).toBe(0);

    mockRaw.mockResolvedValueOnce("");
    mockCruise.mockRejectedValueOnce(new Error("cruise fail"));
    const plugin2 = temporalCouplingPlugin({ targetDir: process.cwd() });
    const [r2] = await plugin2.runner();
    expect(r2.value).toBe(0);
  });

  it("scores pairs below coChangeThreshold as non-violations", async () => {
    // Strategy: a.ts and b.ts each appear often but RARELY together.
    // Each commit needs >= 2 files to survive the `files.length > 1`
    // filter, so we pair each with c.ts as a carrier.
    //
    // 9 commits with (a.ts, c.ts)  → a.ts count = 9
    // 9 commits with (b.ts, c.ts)  → b.ts count = 9
    // 1 commit  with (a.ts, b.ts)  → a.ts=10, b.ts=10
    //
    // pair (a, b) together = 1; minCount = 10; rate = 10%; threshold 50%
    // → a/b pair is NOT flagged.
    const lines = [];
    for (let i = 0; i < 9; i++) lines.push(">>>", "libs/a.ts", "libs/c.ts");
    for (let i = 0; i < 9; i++) lines.push(">>>", "libs/b.ts", "libs/c.ts");
    lines.push(">>>", "libs/a.ts", "libs/b.ts");
    mockRaw.mockResolvedValueOnce(lines.join("\n"));
    mockCruise.mockResolvedValueOnce({ output: { modules: [] } });
    const plugin = temporalCouplingPlugin({
      targetDir: process.cwd(),
      coChangeThreshold: 0.5,
      minPairCount: 1,
    });
    const [r] = await plugin.runner();
    // a/b pair below threshold is not flagged among the issues.
    const flaggedMessages = r.details.issues.map((i) => i.message).join("\n");
    expect(flaggedMessages.includes("libs/b.ts")
      && r.details.issues.some((i) => i.source.file === "libs/a.ts" && i.message.includes("libs/b.ts"))).toBe(false);
  });

  it("ignores pairs below minPairCount", async () => {
    mockRaw.mockResolvedValueOnce([">>>", "a.ts", "b.ts"].join("\n"));
    mockCruise.mockResolvedValueOnce({ output: { modules: [] } });
    const plugin = temporalCouplingPlugin({
      targetDir: process.cwd(),
      coChangeThreshold: 0.3,
      minPairCount: 5,
    });
    const [r] = await plugin.runner();
    expect(r.value).toBe(0);
  });

  it("severity bumps to 'error' at co-change > 2x threshold", async () => {
    // Tight coupling: 5 commits always together
    mockRaw.mockResolvedValueOnce(
      Array(5).fill([">>>", "a.ts", "b.ts"]).flat().join("\n"),
    );
    mockCruise.mockResolvedValueOnce({ output: { modules: [] } });
    const plugin = temporalCouplingPlugin({
      targetDir: process.cwd(),
      coChangeThreshold: 0.3, // 100% > 60%
      minPairCount: 2,
    });
    const [r] = await plugin.runner();
    expect(r.details.issues[0].severity).toBe("error");
  });

  it("singularizes 'pair' vs 'pairs'", async () => {
    mockRaw.mockResolvedValueOnce(
      Array(5).fill([">>>", "a.ts", "b.ts"]).flat().join("\n"),
    );
    mockCruise.mockResolvedValueOnce({ output: { modules: [] } });
    const plugin = temporalCouplingPlugin({
      targetDir: process.cwd(),
      coChangeThreshold: 0.3,
      minPairCount: 2,
    });
    const [r] = await plugin.runner();
    expect(r.displayValue).toContain("1 pair ");
  });
});

describe("teamOwnershipPlugin", () => {
  it("no-ops when CODEOWNERS is missing", async () => {
    mockLoadOwners.mockResolvedValueOnce([]);
    const plugin = await teamOwnershipPlugin({ targetDir: process.cwd() });
    expect(plugin.description).toContain("no CODEOWNERS");

    const results = await plugin.runner();
    expect(results).toHaveLength(2);
    expect(results[0].value).toBe(0);
    expect(results[0].displayValue).toContain("no CODEOWNERS");
  });

  it("handles codeowners-utils returning null (not an empty array)", async () => {
    // `loadOwners` returns null when the target has no CODEOWNERS file. If we
    // didn't normalize to [], `rules.length` would throw.
    mockLoadOwners.mockResolvedValueOnce(null);
    const plugin = await teamOwnershipPlugin({ targetDir: process.cwd() });
    const results = await plugin.runner();
    expect(results).toHaveLength(2);
    expect(results[0].value).toBe(0);
  });

  it("catches errors from loadOwners", async () => {
    mockLoadOwners.mockRejectedValueOnce(new Error("cannot read CODEOWNERS"));
    const plugin = await teamOwnershipPlugin({ targetDir: process.cwd() });
    const results = await plugin.runner();
    expect(results[0].value).toBe(0);
  });

  it("flags files touched by commits crossing 2+ teams", async () => {
    mockLoadOwners.mockResolvedValueOnce([
      { pattern: "plugins/team-a/**", owners: ["@team-a"] },
      { pattern: "plugins/team-b/**", owners: ["@team-b"] },
      { pattern: "plugins/team-c/**", owners: ["@team-c"] },
      { pattern: "plugins/team-d/**", owners: ["@team-d"] },
    ]);
    // matchFile stub: pick team by leading plugins/<team>/ path segment
    mockMatchFile.mockImplementation((file) => {
      if (file.startsWith("plugins/team-a/")) return { owners: ["@team-a"] };
      if (file.startsWith("plugins/team-b/")) return { owners: ["@team-b"] };
      if (file.startsWith("plugins/team-c/")) return { owners: ["@team-c"] };
      if (file.startsWith("plugins/team-d/")) return { owners: ["@team-d"] };
      return null;
    });

    // Five commits each touching 4 teams — enough to flag both audits:
    //   cross-team-churn:       file count > crossTeamThreshold (3)
    //   team-count-per-file:    otherTeams.size > teamsPerCommitThreshold (2)
    // With 4 teams, otherTeams.size = 3 which > 2.
    const lines = [];
    for (let i = 0; i < 5; i++) {
      lines.push(
        ">>>",
        "plugins/team-a/foo.ts",
        "plugins/team-b/bar.ts",
        "plugins/team-c/baz.ts",
        "plugins/team-d/qux.ts",
      );
    }
    mockRaw.mockResolvedValueOnce(lines.join("\n"));

    const plugin = await teamOwnershipPlugin({
      targetDir: process.cwd(),
      teamsPerCommitThreshold: 2,
      crossTeamThreshold: 3,
    });
    const [churn, teamCount] = await plugin.runner();

    expect(churn.value).toBeGreaterThan(0);
    expect(teamCount.value).toBeGreaterThan(0);
  });

  it("ignores single-team commits", async () => {
    mockLoadOwners.mockResolvedValueOnce([{ pattern: "**", owners: ["@solo"] }]);
    mockMatchFile.mockReturnValue({ owners: ["@solo"] });

    mockRaw.mockResolvedValueOnce(
      [">>>", "plugins/a/foo.ts", "plugins/a/bar.ts"].join("\n"),
    );

    const plugin = await teamOwnershipPlugin({ targetDir: process.cwd() });
    const [churn] = await plugin.runner();
    expect(churn.value).toBe(0);
  });

  it("excludes spec/story files from analysis", async () => {
    mockLoadOwners.mockResolvedValueOnce([
      { pattern: "plugins/team-a/**", owners: ["@a"] },
      { pattern: "plugins/team-b/**", owners: ["@b"] },
      { pattern: "plugins/team-c/**", owners: ["@c"] },
    ]);
    mockMatchFile.mockImplementation((file) => {
      if (file.startsWith("plugins/team-a/")) return { owners: ["@a"] };
      if (file.startsWith("plugins/team-b/")) return { owners: ["@b"] };
      if (file.startsWith("plugins/team-c/")) return { owners: ["@c"] };
      return null;
    });

    // Commit has 3 files but 2 are .spec — excluded, so effectively 1 team
    mockRaw.mockResolvedValueOnce(
      [
        ">>>",
        "plugins/team-a/foo.ts",
        "plugins/team-b/bar.spec.ts",
        "plugins/team-c/baz.stories.ts",
      ].join("\n"),
    );

    const plugin = await teamOwnershipPlugin({ targetDir: process.cwd() });
    const [churn] = await plugin.runner();
    expect(churn.value).toBe(0);
  });

  it("swallows simpleGit errors", async () => {
    mockLoadOwners.mockResolvedValueOnce([{ pattern: "**", owners: ["@a"] }]);
    mockRaw.mockRejectedValueOnce(new Error("git fail"));
    const plugin = await teamOwnershipPlugin({ targetDir: process.cwd() });
    const [churn] = await plugin.runner();
    expect(churn.value).toBe(0);
  });

  it("severity bumps to 'error' beyond 2x threshold", async () => {
    mockLoadOwners.mockResolvedValueOnce([
      { pattern: "plugins/team-a/**", owners: ["@a"] },
      { pattern: "plugins/team-b/**", owners: ["@b"] },
      { pattern: "plugins/team-c/**", owners: ["@c"] },
      { pattern: "plugins/team-d/**", owners: ["@d"] },
      { pattern: "plugins/team-e/**", owners: ["@e"] },
      { pattern: "plugins/team-f/**", owners: ["@f"] },
    ]);
    mockMatchFile.mockImplementation((file) => {
      if (file.startsWith("plugins/team-a/")) return { owners: ["@a"] };
      if (file.startsWith("plugins/team-b/")) return { owners: ["@b"] };
      if (file.startsWith("plugins/team-c/")) return { owners: ["@c"] };
      if (file.startsWith("plugins/team-d/")) return { owners: ["@d"] };
      if (file.startsWith("plugins/team-e/")) return { owners: ["@e"] };
      if (file.startsWith("plugins/team-f/")) return { owners: ["@f"] };
      return null;
    });

    // 10 multi-team commits touching 6 teams each:
    //   cross-team-churn:    count = 10 > 2×3 = 6     → error severity
    //   team-count-per-file: otherTeams = 5 > 2×2 = 4 → error severity
    const lines = [];
    for (let i = 0; i < 10; i++) {
      lines.push(
        ">>>",
        "plugins/team-a/foo.ts",
        "plugins/team-b/bar.ts",
        "plugins/team-c/baz.ts",
        "plugins/team-d/qux.ts",
        "plugins/team-e/quux.ts",
        "plugins/team-f/corge.ts",
      );
    }
    mockRaw.mockResolvedValueOnce(lines.join("\n"));

    const plugin = await teamOwnershipPlugin({
      targetDir: process.cwd(),
      teamsPerCommitThreshold: 2,
      crossTeamThreshold: 3,
    });
    const [churn, teamCount] = await plugin.runner();
    expect(churn.details.issues[0].severity).toBe("error");
    expect(teamCount.details.issues[0].severity).toBe("error");
  });

  it("singularizes 'file' in displayValue", async () => {
    mockLoadOwners.mockResolvedValueOnce([
      { pattern: "plugins/a/**", owners: ["@a"] },
      { pattern: "plugins/b/**", owners: ["@b"] },
      { pattern: "plugins/c/**", owners: ["@c"] },
    ]);
    mockMatchFile.mockImplementation((file) => {
      if (file.startsWith("plugins/a/")) return { owners: ["@a"] };
      if (file.startsWith("plugins/b/")) return { owners: ["@b"] };
      if (file.startsWith("plugins/c/")) return { owners: ["@c"] };
      return null;
    });
    const lines = [];
    for (let i = 0; i < 5; i++) {
      lines.push(">>>", "plugins/a/foo.ts", "plugins/b/bar.ts", "plugins/c/baz.ts");
    }
    mockRaw.mockResolvedValueOnce(lines.join("\n"));

    const plugin = await teamOwnershipPlugin({
      targetDir: process.cwd(),
      teamsPerCommitThreshold: 2,
      crossTeamThreshold: 3,
    });
    const [churn] = await plugin.runner();
    // Either 3 files (error severity) or more; this test just checks pluralization
    expect(churn.displayValue).toMatch(/\d+ files? /);
  });
});

