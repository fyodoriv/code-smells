import { describe, it, expect } from "vitest";
import rule from "../eslint-rules/use-effect-count.mjs";
import { ruleTester } from "./rule-tester.mjs";

// use-effect-count: tight focus on useEffect specifically. Does NOT
// trigger on other hooks, non-components, or member-access `useEffect`.

describe("use-effect-count", () => {
  ruleTester.run("use-effect-count", rule, {
    valid: [
      {
        name: "component at threshold — equal but not over",
        code: `
          function MyComp() {
            useEffect(() => {});
            useEffect(() => {});
            useEffect(() => {});
            return <div />;
          }
        `,
        options: [{ threshold: 3 }],
      },
      {
        name: "component with other hooks — only counts useEffect",
        code: `
          function OtherHooks() {
            useState(); useState(); useState(); useState();
            useMemo(() => null, []);
            useCallback(() => null, []);
            useEffect(() => {});
            return <div />;
          }
        `,
        options: [{ threshold: 3 }],
      },
      {
        name: "non-component (camelCase) — ignored",
        code: `
          function helperFn() {
            useEffect(() => {});
            useEffect(() => {});
            useEffect(() => {});
            useEffect(() => {});
            return <div />;
          }
        `,
        options: [{ threshold: 1 }],
      },
      {
        name: "component without JSX — ignored",
        code: `
          function NotAComponent() {
            useEffect(() => {});
            useEffect(() => {});
            useEffect(() => {});
            return 42;
          }
        `,
        options: [{ threshold: 1 }],
      },
      {
        name: "member-access useEffect — not counted",
        code: `
          function MyComp() {
            Foo.useEffect(() => {});
            Bar.useEffect(() => {});
            return <div />;
          }
        `,
        options: [{ threshold: 1 }],
      },
    ],
    invalid: [
      {
        name: "four useEffect at threshold 3 — flagged",
        code: `
          function Over() {
            useEffect(() => {});
            useEffect(() => {});
            useEffect(() => {});
            useEffect(() => {});
            return <div />;
          }
        `,
        options: [{ threshold: 3 }],
        errors: [{ messageId: "tooManyEffects" }],
      },
      {
        name: "arrow component with 2 useEffect at threshold 1",
        code: `
          const ArrowOver = () => {
            useEffect(() => {});
            useEffect(() => {});
            return <></>;
          };
        `,
        options: [{ threshold: 1 }],
        errors: [{ messageId: "tooManyEffects" }],
      },
      {
        name: "default threshold (3) — 4 flagged",
        code: `
          function DefaultThreshold() {
            useEffect(() => {});
            useEffect(() => {});
            useEffect(() => {});
            useEffect(() => {});
            return <span />;
          }
        `,
        errors: [{ messageId: "tooManyEffects" }],
      },
    ],
  });

  it("has a meta description mentioning useEffect", () => {
    expect(rule.meta.docs.description).toMatch(/useEffect/);
  });
});
