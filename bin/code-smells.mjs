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
 *
 * This file is intentionally a thin shim over lib/cli-core.mjs — all
 * pure logic lives there and has unit tests. Changes to argv parsing,
 * path resolution, or report rewriting should go in cli-core, not here.
 */

// Node version gate FIRST — runs before the ESM imports further down
// are evaluated (import statements use node:* built-ins that work on
// any version, but code-pushup's transitive deps use /v regex flags
// that only parse on Node 20+). Fail fast with an actionable message.
import { buildNodeVersionMessage, isUnsupportedNode } from "../lib/cli-core.mjs";
if (isUnsupportedNode(process.versions.node)) {
  process.stderr.write(buildNodeVersionMessage(process.versions.node));
  process.exit(1);
}

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildChildArgs,
  linkifyMarkdownContent,
  pickOpener,
  resolveOpenTarget,
  resolveOutputDir,
} from "../lib/cli-core.mjs";

// Resolve the bundled config file relative to this script — works whether
// the package is installed globally, into a target's node_modules/, or
// run via npx (cached under ~/.npm/_npx/).
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
// to find git/tsconfig roots; if cwd is wrong they fail.
const targetDir = resolve(process.env.CP_TARGET ?? process.cwd());
if (!existsSync(targetDir)) {
  console.error(`code-smells: CP_TARGET directory does not exist: ${targetDir}`);
  process.exit(1);
}

const outputDir = resolveOutputDir({
  env: process.env,
  platform: process.platform,
  targetDir,
});

const args = buildChildArgs(process.argv.slice(2), configPath);

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
    // browser, GitHub rendering) can click through.
    try {
      const raw = readFileSync(mdPath, "utf-8");
      writeFileSync(mdPath, linkifyMarkdownContent(raw, outputDir));
    } catch (err) {
      // Don't fail the run if post-processing breaks — the user still
      // has a usable report, just with non-clickable relative paths.
      process.stderr.write(`\n[code-smells] link rewrite skipped: ${err?.message ?? err}\n`);
    }

    // Print a clickable report path — most terminals render file:// URLs as
    // Cmd/Ctrl+click targets.
    process.stderr.write(`\nOpen report: file://${mdPath}\n`);
    process.stderr.write(`         or: file://${jsonPath}\n`);
  }

  // Optional auto-open. CP_OPEN=md | json picks a format.
  if (code === 0) {
    const target = resolveOpenTarget(process.env.CP_OPEN, { mdPath, jsonPath });
    if (target && existsSync(target)) {
      spawnSync(pickOpener(process.platform), [target], { stdio: "ignore", detached: true });
    }
  }

  process.exit(code ?? (signal ? 1 : 0));
});
