import { describe, expect, it, vi } from "vitest";

/**
 * Tests for the 3 git-based plugins — churn, bug-fix-density,
 * author-dispersion. All three call `simple-git` internally. We mock
 * the single `raw()` call each one makes and assert on the shape of
 * the audits returned.
 *
 * We mock at the module level so the plugins' import of `simple-git`
 * returns our fake factory. The plugins share this mock so the test
 * file has one vi.mock at the top.
 */

const mockRaw = vi.fn();
const mockSimpleGit = vi.fn(() => ({ raw: mockRaw }));

vi.mock("simple-git", () => ({
  default: mockSimpleGit,
}));

// Important: import the plugins AFTER vi.mock is registered.
const { default: churnPlugin } = await import("../plugins/churn.plugin.mjs");
const { default: bugFixDensityPlugin } = await import("../plugins/bug-fix-density.plugin.mjs");
const { default: authorDispersionPlugin } = await import("../plugins/author-dispersion.plugin.mjs");

describe("churnPlugin", () => {
  it("builds a plugin config with the right slug/title/audits", () => {
    const plugin = churnPlugin({ targetDir: "/t", days: 30, threshold: 4 });
    expect(plugin.slug).toBe("churn");
    expect(plugin.title).toBe("Churn");
    expect(plugin.audits).toHaveLength(1);
    expect(plugin.audits[0].slug).toBe("file-churn");
    expect(plugin.description).toContain("30 days");
  });

  it("runner counts commits per file and flags high-churn ones", async () => {
    mockRaw.mockResolvedValueOnce(
      [
        "libs/a.ts",
        "libs/b.ts",
        "",
        "libs/a.ts",
        "",
        "libs/a.ts",
        "libs/c.ts",
        "",
        "libs/a.ts",
        "",
        "libs/a.ts",
      ].join("\n"),
    );

    const plugin = churnPlugin({ targetDir: "/t", threshold: 2 });
    const [result] = await plugin.runner();

    // a.ts appears 5 times (> threshold 2), b.ts = 1, c.ts = 1
    expect(result.slug).toBe("file-churn");
    expect(result.value).toBe(1); // only a.ts violates
    expect(result.score).toBeCloseTo(1 - 1 / 3, 5); // 1 violation of 3 tracked files
    expect(result.details.issues).toHaveLength(1);
    expect(result.details.issues[0].source.file).toBe("libs/a.ts");
    expect(result.displayValue).toContain("max 5");
    // Above 2x threshold → warning severity
    expect(result.details.issues[0].severity).toBe("warning");
  });

  it("runner handles empty git output gracefully", async () => {
    mockRaw.mockResolvedValueOnce("");

    const plugin = churnPlugin({ targetDir: "/t" });
    const [result] = await plugin.runner();

    expect(result.value).toBe(0);
    expect(result.score).toBe(1);
    expect(result.details.issues).toHaveLength(0);
  });

  it("runner swallows git errors and returns empty (catch branch)", async () => {
    mockRaw.mockRejectedValueOnce(new Error("not a git repo"));

    const plugin = churnPlugin({ targetDir: "/not-a-repo" });
    const [result] = await plugin.runner();

    expect(result.value).toBe(0);
    expect(result.score).toBe(1);
  });

  it("singularizes 'file' vs 'files' correctly", async () => {
    mockRaw.mockResolvedValueOnce(Array(6).fill("libs/a.ts").join("\n"));
    const plugin = churnPlugin({ targetDir: "/t", threshold: 2 });
    const [result] = await plugin.runner();
    expect(result.displayValue).toContain("1 high-churn file ");

    mockRaw.mockResolvedValueOnce(
      [
        ...Array(6).fill("libs/a.ts"),
        "",
        ...Array(6).fill("libs/b.ts"),
      ].join("\n"),
    );
    const [r2] = await plugin.runner();
    expect(r2.displayValue).toContain("2 high-churn files");
  });

  it("passes the expected git args", async () => {
    mockRaw.mockResolvedValueOnce("");
    const plugin = churnPlugin({
      targetDir: "/t",
      days: 42,
      threshold: 3,
      pathFilter: ["*.py"],
    });
    await plugin.runner();
    expect(mockRaw).toHaveBeenLastCalledWith([
      "log",
      "--since=42.days.ago",
      "--name-only",
      "--format=",
      "--",
      "*.py",
    ]);
  });
});

describe("bugFixDensityPlugin", () => {
  it("builds a plugin config with the right shape", () => {
    const plugin = bugFixDensityPlugin({ targetDir: "/t", days: 90, threshold: 2 });
    expect(plugin.slug).toBe("bug-fix-density");
    expect(plugin.audits[0].slug).toBe("bug-fix-density");
    expect(plugin.description).toContain("90 days");
  });

  it("counts fix-commits per file and flags over-threshold ones", async () => {
    mockRaw.mockResolvedValueOnce(
      [
        "libs/a.ts",
        "",
        "libs/a.ts",
        "",
        "libs/a.ts",
        "",
        "libs/a.ts",
        "",
        "libs/a.ts",
        "",
        "libs/b.ts",
        "",
        "libs/b.ts",
      ].join("\n"),
    );

    const plugin = bugFixDensityPlugin({ targetDir: "/t", threshold: 2 });
    const [result] = await plugin.runner();

    expect(result.value).toBe(1); // only a.ts fixed 5 > 2
    expect(result.details.issues[0].source.file).toBe("libs/a.ts");
    // 5 > threshold*2 = 4 → error severity
    expect(result.details.issues[0].severity).toBe("error");
    expect(result.displayValue).toContain("max 5");
  });

  it("empty output yields perfect score", async () => {
    mockRaw.mockResolvedValueOnce("");
    const plugin = bugFixDensityPlugin({ targetDir: "/t" });
    const [result] = await plugin.runner();
    expect(result.value).toBe(0);
    expect(result.score).toBe(1);
  });

  it("rejected git call is swallowed (catch branch)", async () => {
    mockRaw.mockRejectedValueOnce(new Error("boom"));
    const plugin = bugFixDensityPlugin({ targetDir: "/t" });
    const [result] = await plugin.runner();
    expect(result.value).toBe(0);
  });

  it("singularizes 'file' vs 'files'", async () => {
    mockRaw.mockResolvedValueOnce(Array(4).fill("libs/a.ts").join("\n"));
    const plugin = bugFixDensityPlugin({ targetDir: "/t", threshold: 2 });
    const [r] = await plugin.runner();
    expect(r.displayValue).toContain("1 high-defect file ");

    mockRaw.mockResolvedValueOnce(
      [...Array(4).fill("libs/a.ts"), "", ...Array(4).fill("libs/b.ts")].join("\n"),
    );
    const [r2] = await plugin.runner();
    expect(r2.displayValue).toContain("2 high-defect files");
  });

  it("uses 'warning' severity when over threshold but not 2x", async () => {
    mockRaw.mockResolvedValueOnce(Array(3).fill("libs/a.ts").join("\n"));
    const plugin = bugFixDensityPlugin({ targetDir: "/t", threshold: 2 });
    const [r] = await plugin.runner();
    expect(r.details.issues[0].severity).toBe("warning");
  });
});

describe("authorDispersionPlugin", () => {
  it("builds a plugin config with 2 audits", () => {
    const plugin = authorDispersionPlugin({ targetDir: "/t", authorThreshold: 3, busFactorRatio: 0.7 });
    expect(plugin.slug).toBe("author-dispersion");
    expect(plugin.audits).toHaveLength(2);
    expect(plugin.audits.map((a) => a.slug).sort()).toEqual(["author-count", "bus-factor"]);
  });

  it("flags files with too many authors", async () => {
    // 4 distinct authors touching a.ts, threshold 2
    mockRaw.mockResolvedValueOnce(
      [
        "COMMIT|Alice",
        "a.ts",
        "COMMIT|Bob",
        "a.ts",
        "COMMIT|Carol",
        "a.ts",
        "COMMIT|Dave",
        "a.ts",
        "COMMIT|Alice",
        "b.ts",
      ].join("\n"),
    );

    const plugin = authorDispersionPlugin({ targetDir: "/t", authorThreshold: 2 });
    const [authorCount] = await plugin.runner();

    expect(authorCount.slug).toBe("author-count");
    expect(authorCount.value).toBe(1); // only a.ts over threshold
    expect(authorCount.details.issues[0].source.file).toBe("a.ts");
    // 4 > 2 * 1.5 = 3 → error severity
    expect(authorCount.details.issues[0].severity).toBe("error");
  });

  it("flags files with low bus factor", async () => {
    // a.ts: Alice 9, Bob 1 → Alice 90%. Threshold 80%.
    // Also need >= minCommitsForBusFactor (5 by default) commits total.
    mockRaw.mockResolvedValueOnce(
      [
        ...Array(9)
          .fill(null)
          .flatMap(() => ["COMMIT|Alice", "a.ts"]),
        "COMMIT|Bob",
        "a.ts",
      ].join("\n"),
    );

    const plugin = authorDispersionPlugin({ targetDir: "/t" });
    const [, busFactor] = await plugin.runner();

    expect(busFactor.slug).toBe("bus-factor");
    expect(busFactor.value).toBe(1);
    expect(busFactor.details.issues[0].message).toContain("Alice");
    expect(busFactor.details.issues[0].message).toContain("90%");
  });

  it("ignores files with fewer commits than minCommitsForBusFactor", async () => {
    // a.ts: Alice 2 commits total — below min 5
    mockRaw.mockResolvedValueOnce(
      ["COMMIT|Alice", "a.ts", "COMMIT|Alice", "a.ts"].join("\n"),
    );

    const plugin = authorDispersionPlugin({ targetDir: "/t" });
    const [, busFactor] = await plugin.runner();
    expect(busFactor.value).toBe(0);
  });

  it("ignores single-author files regardless of commit count", async () => {
    // a.ts: Alice 10 commits, zero other authors. On a solo/personal repo
    // every file looks like this — flagging them all as bus-factor risk
    // is unactionable noise. Gate on >= 2 distinct authors.
    mockRaw.mockResolvedValueOnce(
      Array(10)
        .fill(null)
        .flatMap(() => ["COMMIT|Alice", "a.ts"])
        .join("\n"),
    );

    const plugin = authorDispersionPlugin({ targetDir: "/t" });
    const [, busFactor] = await plugin.runner();
    expect(busFactor.value).toBe(0);
    expect(busFactor.score).toBe(1);
  });

  it("handles empty output", async () => {
    mockRaw.mockResolvedValueOnce("");
    const plugin = authorDispersionPlugin({ targetDir: "/t" });
    const [authorCount, busFactor] = await plugin.runner();
    expect(authorCount.value).toBe(0);
    expect(authorCount.score).toBe(1);
    expect(busFactor.value).toBe(0);
    expect(busFactor.score).toBe(1);
  });

  it("rejected git call returns empty result set", async () => {
    mockRaw.mockRejectedValueOnce(new Error("fatal"));
    const plugin = authorDispersionPlugin({ targetDir: "/t" });
    const [authorCount] = await plugin.runner();
    expect(authorCount.value).toBe(0);
  });

  it("uses 'warning' severity when over threshold but not 1.5x", async () => {
    mockRaw.mockResolvedValueOnce(
      [
        "COMMIT|Alice",
        "a.ts",
        "COMMIT|Bob",
        "a.ts",
        "COMMIT|Carol",
        "a.ts",
      ].join("\n"),
    );

    const plugin = authorDispersionPlugin({ targetDir: "/t", authorThreshold: 2 });
    const [authorCount] = await plugin.runner();
    // 3 authors, threshold 2, 1.5x = 3 — not over 1.5x → warning
    expect(authorCount.details.issues[0].severity).toBe("warning");
  });

  it("singularizes 'file' vs 'files'", async () => {
    mockRaw.mockResolvedValueOnce(
      ["COMMIT|A", "a.ts", "COMMIT|B", "a.ts", "COMMIT|C", "a.ts"].join("\n"),
    );
    const plugin = authorDispersionPlugin({ targetDir: "/t", authorThreshold: 2 });
    const [ac] = await plugin.runner();
    expect(ac.displayValue).toContain("1 file ");
  });
});
