/**
 * hook-count ESLint rule
 *
 * Flags React component functions with more than N total `use*()` hook
 * calls. Gap-filler — no maintained ESLint rule does this. The user's
 * original complaint ("too many hooks in one component") is exactly what
 * this catches.
 *
 * Options: [{ threshold: number }] (default 10)
 */
import { getFunctionName, isComponentName, isHookCall } from "./utils.mjs";

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Flag React components with more than N total hook calls — a signal the component has too many responsibilities.",
    },
    schema: [
      {
        type: "object",
        properties: { threshold: { type: "integer", minimum: 1 } },
        additionalProperties: false,
      },
    ],
    messages: {
      tooManyHooks:
        "Component '{{name}}' calls {{count}} hooks (threshold {{threshold}}). Consider extracting logic into custom hooks or sub-components.",
    },
  },
  create(context) {
    const threshold = context.options[0]?.threshold ?? 10;
    const stack = []; // { name, node, hookCount, hasJsx }

    const enter = (node) => {
      const name = getFunctionName(node);
      stack.push({ name, node, hookCount: 0, hasJsx: false });
    };

    const exit = (node) => {
      const top = stack[stack.length - 1];
      if (top?.node !== node) return;
      stack.pop();
      if (!isComponentName(top.name) || !top.hasJsx) return;
      if (top.hookCount > threshold) {
        context.report({
          node,
          messageId: "tooManyHooks",
          data: { name: top.name, count: String(top.hookCount), threshold: String(threshold) },
        });
      }
    };

    return {
      FunctionDeclaration: enter,
      ArrowFunctionExpression: enter,
      FunctionExpression: enter,
      "FunctionDeclaration:exit": exit,
      "ArrowFunctionExpression:exit": exit,
      "FunctionExpression:exit": exit,
      CallExpression(node) {
        if (stack.length > 0 && isHookCall(node)) {
          stack[stack.length - 1].hookCount++;
        }
      },
      JSXElement() {
        if (stack.length > 0) stack[stack.length - 1].hasJsx = true;
      },
      JSXFragment() {
        if (stack.length > 0) stack[stack.length - 1].hasJsx = true;
      },
    };
  },
};
