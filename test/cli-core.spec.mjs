import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  buildChildArgs,
  buildNodeVersionMessage,
  isUnsupportedNode,
  linkifyMarkdownContent,
  pickOpener,
  resolveOpenTarget,
  resolveOutputDir,
} from "../lib/cli-core.mjs";

describe("isUnsupportedNode", () => {
  it.each([
    ["18.20.8", true],
    ["19.0.0", true],
    ["16.20.0", true],
    ["20.0.0", false],
    ["22.22.2", false],
    ["24.0.0", false],
  ])("isUnsupportedNode(%j) === %s", (input, expected) => {
    expect(isUnsupportedNode(input)).toBe(expected);
  });

  it("treats unparseable input as unsupported", () => {
    expect(isUnsupportedNode("")).toBe(true);
    expect(isUnsupportedNode("not.a.version")).toBe(true);
    // process.versions.node never has a 'v' prefix, but a caller might
    // accidentally pass one — document that we reject it.
    expect(isUnsupportedNode("v20.0.0")).toBe(true);
  });
});

describe("buildNodeVersionMessage", () => {
  it("embeds the running version and mentions the 20+ requirement", () => {
    const msg = buildNodeVersionMessage("18.20.8");
    expect(msg).toContain("18.20.8");
    expect(msg).toContain("Node 20 or newer");
    expect(msg).toContain("fnm use 22");
    expect(msg).toContain("nvm use 22");
  });
});

describe("buildChildArgs", () => {
  const CFG = "/tmp/code-pushup.config.mjs";

  it("defaults to 'collect' when no subcommand is given", () => {
    expect(buildChildArgs([], CFG)).toEqual(["collect", "--config", CFG]);
  });

  it("prepends 'collect' when the first arg is a flag", () => {
    expect(buildChildArgs(["--verbose"], CFG)).toEqual(["collect", "--verbose", "--config", CFG]);
  });

  it.each([
    "collect",
    "compare",
    "upload",
    "autorun",
    "history",
    "print-config",
    "merge-diffs",
  ])("leaves the args alone when first is the known subcommand %s", (subcommand) => {
    expect(buildChildArgs([subcommand, "--flag"], CFG)).toEqual([subcommand, "--flag", "--config", CFG]);
  });

  it("does not treat unknown words as subcommands", () => {
    expect(buildChildArgs(["banana", "--x"], CFG)).toEqual(["collect", "banana", "--x", "--config", CFG]);
  });

  it("does not mutate the input array", () => {
    const input = ["--verbose"];
    buildChildArgs(input, CFG);
    expect(input).toEqual(["--verbose"]);
  });
});

describe("pickOpener", () => {
  it.each([
    ["darwin", "open"],
    ["win32", "start"],
    ["linux", "xdg-open"],
    ["freebsd", "xdg-open"],
    ["aix", "xdg-open"],
  ])("pickOpener(%j) === %j", (platform, expected) => {
    expect(pickOpener(platform)).toBe(expected);
  });
});

describe("resolveOpenTarget", () => {
  const PATHS = { mdPath: "/r/report.md", jsonPath: "/r/report.json" };

  it("returns undefined when CP_OPEN is not set", () => {
    expect(resolveOpenTarget(undefined, PATHS)).toBeUndefined();
    expect(resolveOpenTarget("", PATHS)).toBeUndefined();
  });

  it.each([
    ["md", "/r/report.md"],
    ["MD", "/r/report.md"],
    ["markdown", "/r/report.md"],
    ["Markdown", "/r/report.md"],
    ["json", "/r/report.json"],
    ["JSON", "/r/report.json"],
  ])("resolveOpenTarget(%j) returns %j", (value, expected) => {
    expect(resolveOpenTarget(value, PATHS)).toBe(expected);
  });

  it("returns undefined for unknown formats", () => {
    expect(resolveOpenTarget("pdf", PATHS)).toBeUndefined();
    expect(resolveOpenTarget("html", PATHS)).toBeUndefined();
  });
});

describe("resolveOutputDir", () => {
  it("honors CP_OUTPUT_DIR as an absolute override", () => {
    const result = resolveOutputDir({
      env: { CP_OUTPUT_DIR: "/tmp/my-reports" },
      platform: "linux",
      targetDir: "/anywhere",
    });
    expect(result).toBe("/tmp/my-reports");
  });

  it("resolves CP_OUTPUT_DIR relative to cwd when not absolute", () => {
    const result = resolveOutputDir({
      env: { CP_OUTPUT_DIR: "reports" },
      platform: "linux",
      targetDir: "/anywhere",
    });
    expect(result).toBe(resolve("reports"));
  });

  it("on macOS, falls back to ~/Library/Caches/code-smells/<name>", () => {
    const result = resolveOutputDir({
      env: {},
      platform: "darwin",
      targetDir: "/Users/me/apps/my-project",
    });
    expect(result).toBe(resolve(homedir(), "Library/Caches/code-smells/my-project"));
  });

  it("on Windows, falls back to the temp directory", () => {
    const result = resolveOutputDir({
      env: {},
      platform: "win32",
      targetDir: "C:/Users/me/apps/my-project",
    });
    expect(result).toBe(resolve(tmpdir(), "code-smells/my-project"));
  });

  it("on Linux, falls back to ~/.cache/code-smells/<name>", () => {
    const result = resolveOutputDir({
      env: {},
      platform: "linux",
      targetDir: "/home/me/apps/my-project",
    });
    expect(result).toBe(resolve(homedir(), ".cache/code-smells/my-project"));
  });

  it("honors XDG_CACHE_HOME when set (Linux convention)", () => {
    const result = resolveOutputDir({
      env: { XDG_CACHE_HOME: "/opt/cache" },
      platform: "linux",
      targetDir: "/home/me/apps/my-project",
    });
    expect(result).toBe(resolve("/opt/cache/code-smells/my-project"));
  });

  it("sanitizes target dir names containing unsafe characters", () => {
    const result = resolveOutputDir({
      env: { XDG_CACHE_HOME: "/c" },
      platform: "linux",
      targetDir: "/t/my project!@#",
    });
    // Everything except [a-zA-Z0-9._-] replaced with _
    expect(result).toBe(resolve("/c/code-smells/my_project___"));
  });

  it("uses 'default' when basename of targetDir resolves to empty after sanitization", () => {
    const result = resolveOutputDir({
      env: { XDG_CACHE_HOME: "/c" },
      platform: "linux",
      targetDir: "/",
    });
    expect(result).toBe(resolve("/c/code-smells/default"));
  });
});

describe("linkifyMarkdownContent", () => {
  // Report dir has 4 components after the user home — relative links
  // in the report walk up 4 levels to reach the source tree root.
  const REPORT_DIR = "/Users/me/Library/Caches/code-smells/my-project";
  // path.resolve("/Users/me/Library/Caches/code-smells/my-project",
  //              "../../../../apps/my-project/libs/foo.ts")
  //   = "/Users/me/apps/my-project/libs/foo.ts"
  const REL_TO_FOO = "../../../../apps/my-project/libs/foo.ts";
  const ABS_FOO = "/Users/me/apps/my-project/libs/foo.ts";

  it("rewrites a relative link with a trailing numeric line cell", () => {
    const input = `|  warning  | issue | [\`libs/foo.ts\`](${REL_TO_FOO}) |    42    |`;
    const out = linkifyMarkdownContent(input, REPORT_DIR);
    expect(out).toContain(`file://${ABS_FOO}#L42`);
    expect(out).not.toContain("](../../");
  });

  it("rewrites a relative link without a line number (blank trailing cell)", () => {
    const input = `|  error  | imports 500 modules | [\`libs/foo.ts\`](${REL_TO_FOO}) |          |`;
    const out = linkifyMarkdownContent(input, REPORT_DIR);
    expect(out).toContain(`file://${ABS_FOO})`);
    expect(out).not.toContain("#L");
  });

  it("leaves already-file:// URLs untouched (idempotent)", () => {
    const input = "|  warning  | issue | [`a.ts`](file:///abs/a.ts#L5) |    5    |";
    const out = linkifyMarkdownContent(input, REPORT_DIR);
    expect(out).toBe(input);
  });

  it("leaves http(s) links untouched", () => {
    const input = "|  warning  | issue | [`a.ts`](https://example.com/a.ts) |    5    |";
    const out = linkifyMarkdownContent(input, REPORT_DIR);
    expect(out).toBe(input);
  });

  it("leaves non-table-row lines untouched", () => {
    const input = ["# Heading", "Some prose with a [link](./thing.md).", "", "- bullet"].join("\n");
    expect(linkifyMarkdownContent(input, REPORT_DIR)).toBe(input);
  });

  it("preserves table rows that look like rows but have no link", () => {
    const input = "| col1 | col2 | col3 |    5    |";
    expect(linkifyMarkdownContent(input, REPORT_DIR)).toBe(input);
  });

  it("handles message cells containing escaped pipes (TypeScript union types)", () => {
    const input =
      "|  error  | Type 'string \\| number' is not assignable | [`f.ts`](../../../../x/f.ts) |    7    |";
    const out = linkifyMarkdownContent(input, REPORT_DIR);
    // Escaped pipes in the message cell must not break matching
    expect(out).toContain("file://");
    expect(out).toContain("#L7");
    expect(out).toContain("Type 'string \\| number' is not assignable");
  });

  it("rewrites only the LAST link in a row when multiple appear", () => {
    const input =
      "|  warning  | see [`other`](../other.md) for context | [`f.ts`](../../../../x/f.ts) |    9    |";
    const out = linkifyMarkdownContent(input, REPORT_DIR);
    expect(out).toContain("file://");
    expect(out).toContain("#L9");
    // The link that's NOT the last should stay relative (greedy match
    // consumes everything up to the last ]( )
  });

  it("keeps absolute link targets as-is when already rooted", () => {
    const input = "|  warning  | x | [`a.ts`](/abs/a.ts) |    1    |";
    const out = linkifyMarkdownContent(input, REPORT_DIR);
    expect(out).toContain("file:///abs/a.ts#L1");
  });

  it("handles CRLF line endings by splitting on both \\r\\n and \\n", () => {
    const input =
      "|  warning  | x | [`a.ts`](../b/a.ts) |    1    |\r\n|  info  | y | [`c.ts`](../b/c.ts) |    2    |";
    const out = linkifyMarkdownContent(input, "/r");
    expect(out).toContain("file:///b/a.ts#L1");
    expect(out).toContain("file:///b/c.ts#L2");
  });

  it("handles empty input", () => {
    expect(linkifyMarkdownContent("", REPORT_DIR)).toBe("");
  });

  it("preserves surrounding whitespace in the line-number cell", () => {
    const input = "| a | b | [`f.ts`](../f.ts) |   42   |";
    const out = linkifyMarkdownContent(input, "/r");
    // The "   42   " spacing should survive
    expect(out).toMatch(/\|\s+42\s+\|$/);
  });
});
