import { describe, it, expect } from "vitest";
import rule from "../eslint-rules/unstable-selector-returns.mjs";
import { ruleTester } from "./rule-tester.mjs";

// unstable-selector-returns: flag useSelector returning inline object
// literals without an equality function. The fix is either a scalar
// return, a memoized selector, or passing shallowEqual.

describe("unstable-selector-returns", () => {
  ruleTester.run("unstable-selector-returns", rule, {
    valid: [
      {
        name: "scalar return — fine",
        code: `useSelector(state => state.foo);`,
      },
      {
        name: "object return WITH equality fn — fine",
        code: `useSelector(state => ({ a: state.a, b: state.b }), shallowEqual);`,
      },
      {
        name: "non-function first arg — fine",
        code: `useSelector(getFoo);`,
      },
      {
        name: "empty call — fine (no first arg)",
        code: `useSelector();`,
      },
      {
        name: "not useSelector — not our concern",
        code: `somethingElse(state => ({ a: 1 }));`,
      },
      {
        name: "member-access useSelector — not flagged",
        code: `ns.useSelector(state => ({ a: 1 }));`,
      },
      {
        name: "block body returns a non-object",
        code: `
          useSelector(state => {
            const x = state.foo;
            return x;
          });
        `,
      },
      {
        name: "block body with early return of scalar, no object return",
        code: `
          useSelector(state => {
            if (state.foo) return 1;
            return 2;
          });
        `,
      },
    ],
    invalid: [
      {
        name: "arrow returning inline object literal",
        code: `useSelector(state => ({ a: state.a, b: state.b }));`,
        errors: [{ messageId: "unstableReturn" }],
      },
      {
        name: "function expression returning inline object literal",
        code: `useSelector(function (state) { return { x: state.x }; });`,
        errors: [{ messageId: "unstableReturn" }],
      },
      {
        name: "block body with ObjectExpression return among others",
        code: `
          useSelector(function (state) {
            if (state.x) return 1;
            return { a: state.a };
          });
        `,
        errors: [{ messageId: "unstableReturn" }],
      },
    ],
  });

  it("has a meta type of 'problem' (not suggestion)", () => {
    expect(rule.meta.type).toBe("problem");
  });
});
