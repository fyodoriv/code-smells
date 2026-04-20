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
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
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
  // Print a clickable report path — most terminals render file:// URLs as
  // Cmd/Ctrl+click targets. Helps users find reports without digging.
  const mdPath = resolve(outputDir, "report.md");
  const jsonPath = resolve(outputDir, "report.json");
  if (code === 0 && existsSync(mdPath)) {
    process.stderr.write(`\nOpen report: file://${mdPath}\n`);
    process.stderr.write(`         or: file://${jsonPath}\n`);
  }

  // Optional auto-open. CP_OPEN=md | html | json picks a format; if set,
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
