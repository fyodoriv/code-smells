/**
 * type-coverage plugin
 *
 * Measures TypeScript "type coverage" — the percentage of type nodes that are
 * explicitly typed (not inferred-any from untyped JSON.parse, untyped catch,
 * third-party untyped returns, `as any` casts, non-null assertions, etc.).
 *
 * Complements `no-explicit-any` ESLint rule — that only flags explicit writes,
 * this catches the inferred-any that sneaks in through untyped external APIs.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { lint } from "type-coverage-core";

/**
 * @param {{ targetDir: string, tsconfig?: string, strict?: boolean }} options
 * @returns {import('@code-pushup/models').PluginConfig}
 */
export default function typeCoveragePlugin({ targetDir, tsconfig = "tsconfig.json", strict = true }) {
  return {
    slug: "type-coverage",
    title: "Type Coverage",
    icon: "typescript",
    description:
      "Percentage of type nodes that are explicitly typed. Catches inferred-any propagation beyond what `no-explicit-any` ESLint rule covers.",
    audits: [
      {
        slug: "type-coverage-percentage",
        title: "Type coverage percentage",
      },
    ],
    runner: async () => {
      const tsconfigPath = resolve(targetDir, tsconfig);
      if (!existsSync(tsconfigPath)) {
        // Graceful skip — no tsconfig means we can't compute type coverage.
        return [
          {
            slug: "type-coverage-percentage",
            title: "Type coverage percentage",
            score: 1,
            value: 100,
            displayValue: "skipped — no tsconfig.json",
            details: { issues: [] },
          },
        ];
      }

      // type-coverage-core resolves the project relative to process.cwd(). Switch
      // into the target directory so tsconfig paths/extends resolve correctly.
      const originalCwd = process.cwd();
      process.chdir(targetDir);
      let result;
      try {
        result = await lint(tsconfigPath, { strict });
      } finally {
        process.chdir(originalCwd);
      }

      const { correctCount, totalCount, anys } = result;
      const ratio = totalCount > 0 ? correctCount / totalCount : 1;
      const percentage = Math.round(ratio * 10000) / 100;

      // Cap issues to top 50 by file (most any-heavy files first).
      const perFile = new Map();
      for (const a of anys) {
        if (!perFile.has(a.file)) perFile.set(a.file, []);
        perFile.get(a.file).push(a);
      }
      const issues = [...perFile.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 50)
        .map(([file, entries]) => ({
          source: { file, position: { startLine: Math.max(1, entries[0].line ?? 1) } },
          severity: entries.length > 10 ? "error" : "warning",
          message: `${entries.length} untyped nodes (${entries[0].text ?? "inferred-any"})`,
        }));

      return [
        {
          slug: "type-coverage-percentage",
          title: "Type coverage percentage",
          score: ratio,
          value: percentage,
          displayValue: `${percentage}% (${correctCount}/${totalCount} typed)`,
          details: { issues },
        },
      ];
    },
  };
}
