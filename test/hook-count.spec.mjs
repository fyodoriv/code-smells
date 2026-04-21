import { describe, it, expect } from "vitest";
import rule from "../eslint-rules/hook-count.mjs";
import { ruleTester } from "./rule-tester.mjs";

// hook-count: only flags PascalCase functions that (a) return JSX and
// (b) call more than `threshold` hooks. Non-components, hookless
// components, and functions that only *look* like hooks (member-access
// calls like `Foo.useEffect()`) must not trigger.

describe("hook-count", () => {
  ruleTester.run("hook-count", rule, {
    valid: [
      {
        name: "component under threshold",
        code: `
          function MyComp() {
            const [a, setA] = useState(0);
            const [b, setB] = useState(0);
            return <div />;
          }
        `,
        options: [{ threshold: 10 }],
      },
      {
        name: "non-component (camelCase, returns JSX) — ignored",
        code: `
          function renderStuff() {
            const [a, setA] = useState(0);
            const [b, setB] = useState(0);
            const [c, setC] = useState(0);
            return <div />;
          }
        `,
        options: [{ threshold: 2 }],
      },
      {
        name: "component that doesn't return JSX — ignored",
        code: `
          function MyHook() {
            const [a, setA] = useState(0);
            const [b, setB] = useState(0);
            const [c, setC] = useState(0);
            return a + b + c;
          }
        `,
        options: [{ threshold: 2 }],
      },
      {
        name: "member-access 'hook' not counted (Foo.useThing)",
        code: `
          function MyComp() {
            Foo.useEffect();
            Bar.useState();
            return <div />;
          }
        `,
        options: [{ threshold: 1 }],
      },
      {
        name: "arrow component assigned to PascalCase const — under threshold",
        code: `
          const MyArrow = () => {
            const x = useState(0);
            return <span />;
          };
        `,
        options: [{ threshold: 5 }],
      },
      {
        name: "fragment return counts as JSX — under threshold",
        code: `
          function FragmentComp() {
            useState(0);
            return <></>;
          }
        `,
        options: [{ threshold: 5 }],
      },
      {
        name: "unnamed function expression — ignored (name unresolved)",
        code: `
          export default function () {
            useState(); useState(); useState(); useState();
            return <div />;
          }
        `,
        options: [{ threshold: 1 }],
      },
    ],
    invalid: [
      {
        name: "component with 3 hooks at threshold 2 — flagged",
        code: `
          function BigComp() {
            const a = useState(0);
            const b = useState(0);
            const c = useState(0);
            return <div />;
          }
        `,
        options: [{ threshold: 2 }],
        errors: [{ messageId: "tooManyHooks" }],
      },
      {
        name: "arrow component with JSX-fragment body",
        code: `
          const ArrowBig = () => {
            useState(); useState(); useState(); useState();
            return <></>;
          };
        `,
        options: [{ threshold: 2 }],
        errors: [{ messageId: "tooManyHooks" }],
      },
      {
        name: "default threshold (10) — 11 hooks flagged",
        code: `
          function DefaultThreshold() {
            useState(); useState(); useState(); useState();
            useState(); useState(); useState(); useState();
            useState(); useState(); useState();
            return <div />;
          }
        `,
        errors: [{ messageId: "tooManyHooks" }],
      },
    ],
  });

  it("has a meta description mentioning hooks", () => {
    expect(rule.meta.docs.description).toMatch(/hook/i);
  });
});
