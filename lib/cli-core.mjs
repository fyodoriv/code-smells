/**
 * Pure logic for the code-smells CLI wrapper. Kept free of side effects
 * so it's unit-testable — the thin binary in bin/code-smells.mjs just
 * wires these helpers to process / filesystem.
 */
import { homedir, tmpdir } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";

// code-pushup's own top-level subcommands — if the user passes one we
// honor it; otherwise we default to `collect`.
const SUBCOMMANDS = new Set([
  "collect",
  "compare",
  "upload",
  "autorun",
  "history",
  "print-config",
  "merge-diffs",
]);

/**
 * Returns true if Node's major version is too old for code-pushup's
 * transitive deps (string-width etc. need Node 20+).
 */
export const isUnsupportedNode = (versionString) => {
  const major = Number.parseInt(String(versionString).split(".")[0], 10);
  return !Number.isFinite(major) || major < 20;
};

/**
 * Pick the output directory for reports. Mirrors the resolution in
 * code-pushup.config.mjs exactly so the CLI can print the right path
 * after the run.
 *
 * Resolution order:
 *   1. CP_OUTPUT_DIR env var (explicit override)
 *   2. $XDG_CACHE_HOME/code-smells/<sanitized target dir name>
 *   3. Platform default: ~/Library/Caches, %TEMP%, or ~/.cache
 */
export const resolveOutputDir = ({ env, platform, targetDir }) => {
  if (env.CP_OUTPUT_DIR) return resolve(env.CP_OUTPUT_DIR);
  const safeName = basename(targetDir).replace(/[^a-zA-Z0-9._-]/g, "_") || "default";
  const cacheHome =
    env.XDG_CACHE_HOME ??
    (platform === "darwin"
      ? resolve(homedir(), "Library/Caches")
      : platform === "win32"
        ? tmpdir()
        : resolve(homedir(), ".cache"));
  return resolve(cacheHome, "code-smells", safeName);
};

/**
 * Build the argv that gets forwarded to code-pushup. If the user
 * didn't start with a subcommand, we default to `collect` — that's
 * the 99% use case and lets `npx code-smells` Just Work.
 *
 * We always append `--config <bundledConfig>` so code-pushup doesn't
 * look for a config in the target's cwd.
 */
export const buildChildArgs = (userArgs, configPath) => {
  const firstIsSubcommand = userArgs.length > 0 && SUBCOMMANDS.has(userArgs[0]);
  const args = firstIsSubcommand ? [...userArgs] : ["collect", ...userArgs];
  args.push("--config", configPath);
  return args;
};

/**
 * Pick the OS-native "open this file" command — macOS `open`, Windows
 * `start`, Linux / everything else `xdg-open`.
 */
export const pickOpener = (platform) =>
  platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";

/**
 * Map CP_OPEN value to a concrete report file path.
 * Unknown formats (and missing value) return undefined.
 */
export const resolveOpenTarget = (openFormat, { mdPath, jsonPath }) => {
  if (!openFormat) return undefined;
  const formatMap = { md: mdPath, markdown: mdPath, json: jsonPath };
  return formatMap[openFormat.toLowerCase()];
};

/**
 * Build the one-line "Node X is not supported" message shown when the
 * version gate trips. Kept here so the wording is unit-testable.
 */
export const buildNodeVersionMessage = (runningVersion) =>
  `\ncode-smells: Node ${runningVersion} is not supported — requires Node 20 or newer.\n` +
  "\n" +
  `  Switch Node version:   fnm use 22    (or)   nvm use 22\n` +
  `  Then re-run:           npx code-smells\n` +
  "\n" +
  "This repo's .nvmrc may be pinning you to an older version — if so,\n" +
  "you can still run code-smells by temporarily switching shells.\n\n";

/**
 * Rewrite relative file links in the markdown report to absolute
 * file:// URLs with #LNN line fragments pulled from the adjacent
 * "Location" column.
 *
 * Table rows in code-pushup issue tables look like:
 *   | <sev> | <msg> | [`path/to/file`](<rel-path>) | <line-or-blank> |
 * Message cells can contain escaped `\|` pipes (e.g. TypeScript union
 * types), so we can't anchor on cell boundaries. Strategy:
 *   (1) match the trailing cell from the end (may be blank for
 *       file-level issues like "imports N modules")
 *   (2) find the last link target before it
 *   (3) rewrite the link target only — preserve surrounding cell
 *       whitespace so the table keeps its shape
 *
 * Idempotent — running twice over the same content is a no-op because
 * already-rewritten rows start with `file:` (negative lookahead skips).
 */
export const linkifyMarkdownContent = (raw, reportDir) => {
  const lines = raw.split(/\r?\n/);
  const trailingCell = /^(\|.*)\|(\s*)(\d*)(\s*)\|(\s*)$/;
  const lastLinkTarget = /^(.*\]\()(?!file:|https?:)([^)]+)(\).*)$/;

  return lines
    .map((line) => {
      const tail = line.match(trailingCell);
      if (!tail) return line;
      const [, body, spBeforeNum, lineNum, spAfterNum, spTrail] = tail;
      const link = body.match(lastLinkTarget);
      if (!link) return line;
      const [, linkPrefix, relTarget, linkSuffix] = link;
      const absPath = isAbsolute(relTarget) ? relTarget : resolve(reportDir, relTarget);
      const anchor = lineNum ? `#L${lineNum}` : "";
      return `${linkPrefix}file://${absPath}${anchor}${linkSuffix}|${spBeforeNum}${lineNum}${spAfterNum}|${spTrail}`;
    })
    .join("\n");
};
