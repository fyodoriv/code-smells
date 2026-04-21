#!/usr/bin/env node
/**
 * code-smells CLI — thin wrapper that delegates to code-pushup with our
 * bundled config.
 *
 * Usage:
 *   npx code-smells                           # run against $PWD
 *   CP_TARGET=/path/to/repo npx code-smells   # run against that repo
 *   npx code-smells --onlyPlugins eslint      # forward any code-pushup flag
 *   npx code-smells collect --verbose         # or pass a full subcommand
 *
 * Env var knobs are honored verbatim (CP_TARGET, CP_PATTERNS, CP_ENTRY,
 * CP_TSCONFIG, CP_COVERAGE_LCOV, CP_ENABLE_FORMATJS, CP_OUTPUT_DIR,
 * CP_OPEN). See README.md.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the bundled config file relative to this script — works whether
// the package is installed globally (~/.npm/...), into a target's
// node_modules/, or run via npx (cached under ~/.npm/_npx/).
const __dirname = dirname(fileURLToPath(import.meta.url));
const toolRoot = resolve(__dirname, "..");
const configPath = resolve(toolRoot, "code-pushup.config.mjs");

if (!existsSync(configPath)) {
  console.error(`code-smells: bundled config not found at ${configPath}`);
  console.error("This likely means the package was installed incorrectly. Try reinstalling.");
  process.exit(1);
}

// Resolve the target directory for the working-directory switch below.
// Several plugins (dependency-cruiser, simple-git, jscpd) walk up from cwd
// to find git/tsconfig roots; if cwd is wrong they fail. Changing into the
// target directory makes all tools Just Work with no per-plugin hacks.
const targetDir = resolve(process.env.CP_TARGET ?? process.cwd());
if (!existsSync(targetDir)) {
  console.error(`code-smells: CP_TARGET directory does not exist: ${targetDir}`);
  process.exit(1);
}

// Mirror code-pushup.config.mjs's output-directory resolution so we can
// print the report path after the run. Keep the logic in sync.
const resolveOutputDir = () => {
  if (process.env.CP_OUTPUT_DIR) return resolve(process.env.CP_OUTPUT_DIR);
  const safeName = basename(targetDir).replace(/[^a-zA-Z0-9._-]/g, "_") || "default";
  const cacheHome =
    process.env.XDG_CACHE_HOME ??
    (process.platform === "darwin"
      ? resolve(homedir(), "Library/Caches")
      : process.platform === "win32"
        ? tmpdir()
        : resolve(homedir(), ".cache"));
  return resolve(cacheHome, "code-smells", safeName);
};
const outputDir = resolveOutputDir();

// If the user didn't pass a subcommand, default to 'collect' — matches the
// 99% use case and lets `npx code-smells` Just Work.
const userArgs = process.argv.slice(2);
const subcommands = new Set(["collect", "compare", "upload", "autorun", "history", "print-config", "merge-diffs"]);
const firstIsSubcommand = userArgs.length > 0 && subcommands.has(userArgs[0]);
const args = firstIsSubcommand ? userArgs : ["collect", ...userArgs];

// Pass --config explicitly so code-pushup doesn't look for one in cwd.
args.push("--config", configPath);

// Find code-pushup — it's a direct dependency, so node_modules/.bin/ next
// to this script's package root should have it.
const cliPath = resolve(toolRoot, "node_modules", ".bin", "code-pushup");
const command = existsSync(cliPath) ? cliPath : "code-pushup";

const child = spawn(command, args, {
  stdio: "inherit",
  cwd: targetDir,
  // CP_TARGET resolves to an absolute path; set it explicitly so the config
  // doesn't fall back to cwd (which we just moved).
  env: { ...process.env, CP_TARGET: targetDir },
});

child.on("error", (err) => {
  console.error(`code-smells: failed to spawn ${command}:`, err.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  const mdPath = resolve(outputDir, "report.md");
  const jsonPath = resolve(outputDir, "report.json");

  if (code === 0 && existsSync(mdPath)) {
    // Rewrite the markdown report's relative file links to absolute file://
    // URLs so every viewer (TextEdit, Typora, Marked, VS Code preview,
    // browser, GitHub rendering) can click through to the source line
    // without resolving relative paths against the report directory.
    try {
      linkifyMarkdownReport(mdPath, outputDir);
    } catch (err) {
      // Don't fail the run if post-processing breaks — the user still
      // has a usable report, just with non-clickable relative paths.
      process.stderr.write(`\n[code-smells] link rewrite skipped: ${err?.message ?? err}\n`);
    }

    // Print a clickable report path — most terminals render file:// URLs as
    // Cmd/Ctrl+click targets. Helps users find reports without digging.
    process.stderr.write(`\nOpen report: file://${mdPath}\n`);
    process.stderr.write(`         or: file://${jsonPath}\n`);
  }

  // Optional auto-open. CP_OPEN=md | json picks a format; if set,
  // spawn the platform's default viewer (macOS `open`, Windows `start`,
  // Linux `xdg-open`). Backgrounded so it doesn't delay our exit.
  const openFormat = process.env.CP_OPEN;
  if (code === 0 && openFormat) {
    const formatMap = { md: mdPath, markdown: mdPath, json: jsonPath };
    const target = formatMap[openFormat.toLowerCase()];
    if (target && existsSync(target)) {
      const opener =
        process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      spawnSync(opener, [target], { stdio: "ignore", detached: true });
    }
  }

  process.exit(code ?? (signal ? 1 : 0));
});

/**
 * Rewrite relative file links in the markdown report to absolute file://
 * URLs with #LNN line fragments pulled from the adjacent "Location"
 * column. Idempotent — safe to run multiple times.
 */
function linkifyMarkdownReport(mdPath, reportDir) {
  const raw = readFileSync(mdPath, "utf-8");
  const lines = raw.split(/\r?\n/);

  // Table rows in code-pushup issue tables look like:
  //   | <sev> | <msg> | [`path/to/file`](<rel-path>) | <line-or-blank> |
  // Message cells can contain escaped `\|` pipes (e.g. TypeScript union
  // types), so we can't anchor on cell boundaries. Instead: (1) match the
  // trailing cell from the end (may be blank for file-level issues like
  // "imports N modules"), (2) find the last link target before it, and
  // (3) rewrite only the link target to an absolute file:// URL, adding
  // a #Lnumber anchor when a line number is present.
  const trailingCell = /^(\|.*)\|(\s*)(\d*)(\s*)\|(\s*)$/;
  const lastLinkTarget = /^(.*\]\()(?!file:|https?:)([^)]+)(\).*)$/;

  const rewritten = lines.map((line) => {
    const tail = line.match(trailingCell);
    if (!tail) return line;
    const [, body, spBeforeNum, lineNum, spAfterNum, spTrail] = tail;
    const link = body.match(lastLinkTarget);
    if (!link) return line;
    const [, linkPrefix, relTarget, linkSuffix] = link;
    // Always rewrite — even for files that no longer exist on disk (the git
    // churn/bug-fix plugins cite historical paths). A well-formed absolute
    // file:// URL is clickable; a relative link isn't.
    const absPath = isAbsolute(relTarget) ? relTarget : resolve(reportDir, relTarget);
    const anchor = lineNum ? `#L${lineNum}` : "";
    return `${linkPrefix}file://${absPath}${anchor}${linkSuffix}|${spBeforeNum}${lineNum}${spAfterNum}|${spTrail}`;
  });

  writeFileSync(mdPath, rewritten.join("\n"));
}
