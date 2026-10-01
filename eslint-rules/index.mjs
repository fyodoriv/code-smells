/**
 * ESLint plugin exposing our gap-filler rules. Named `code-smells`.
 *
 * Only four rules live here — each fills a gap where no maintained ESLint
 * rule from the community does the job (per VISION.md boundaries).
 */
import domainBoundaries from "./domain-boundaries.mjs";
import hookCount from "./hook-count.mjs";
import unstableSelectorReturns from "./unstable-selector-returns.mjs";
import useEffectCount from "./use-effect-count.mjs";

export default {
  meta: {
    name: "code-smells",
    version: "0.3.0",
  },
  rules: {
    "domain-boundaries": domainBoundaries,
    "hook-count": hookCount,
    "use-effect-count": useEffectCount,
    "unstable-selector-returns": unstableSelectorReturns,
  },
};
