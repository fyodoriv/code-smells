/**
 * use-effect-count ESLint rule
 *
 * Flags React component functions with more than N `useEffect` calls.
 * Complements hook-count — useEffect specifically is a strong smell signal
 * (effect chains often encode hidden state machines).
 *
 * Options: [{ threshold: number }] (default 3)
 */
import { getFunctionName, isComponentName } from "./utils.mjs";

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Flag React components with more than N `useEffect` calls — indicates effect-chain complexity.",
    },
    schema: [
      {
        type: "object",
        properties: { threshold: { type: "integer", minimum: 1 } },
        additionalProperties: false,
      },
    ],
    messages: {
      tooManyEffects:
        "Component '{{name}}' has {{count}} useEffect calls (threshold {{threshold}}). Consider consolidating or extracting a custom hook.",
    },
  },
  create(context) {
    const threshold = context.options[0]?.threshold ?? 3;
    const stack = [];

    const enter = (node) => {
      const name = getFunctionName(node);
      stack.push({ name, node, effectCount: 0, hasJsx: false });
    };

    const exit = (node) => {
      const top = stack[stack.length - 1];
      if (top?.node !== node) return;
      stack.pop();
      if (!isComponentName(top.name) || !top.hasJsx) return;
      if (top.effectCount > threshold) {
        context.report({
          node,
          messageId: "tooManyEffects",
          data: { name: top.name, count: String(top.effectCount), threshold: String(threshold) },
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
        if (stack.length > 0 && node.callee?.type === "Identifier" && node.callee.name === "useEffect") {
          stack[stack.length - 1].effectCount++;
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
