/**
 * Shared RuleTester factory — wires up ESLint's RuleTester with the JSX
 * + TypeScript parser options we need for our rules. Using this single
 * instance in every rule test means the rules are exercised the same
 * way they're exercised in a target repo.
 */
import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";

export const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});
