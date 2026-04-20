/**
 * unstable-selector-returns ESLint rule
 *
 * Flags `useSelector(state => ({ ... }))` calls that return an inline object
 * without passing an equality function. Every store dispatch creates a new
 * object, triggering re-render regardless of whether the selected values
 * actually changed. This is a real performance bug, not a stylistic smell.
 *
 * Correct patterns (NOT flagged):
 *   useSelector(state => state.foo)                    // scalar return
 *   useSelector(state => ({a, b}), shallowEqual)       // explicit equality
 *   useSelector(useMemo(() => createSelector(...), []))// memoized selector
 */

/** Returns true if a function body (or concise arrow body) yields an object literal. */
const bodyYieldsObjectLiteral = (fnNode) => {
  const body = fnNode.body;
  if (!body) return false;
  // Concise arrow: `state => ({ ... })` parses as ArrowFunctionExpression
  // with body = ObjectExpression (when wrapped) or ParenthesizedExpression.
  if (body.type === "ObjectExpression") return true;
  // Block body: look for a single `return { ... }`.
  if (body.type === "BlockStatement") {
    const returns = body.body.filter((s) => s.type === "ReturnStatement");
    // If any return produces an inline object literal, flag it.
    return returns.some((r) => r.argument?.type === "ObjectExpression");
  }
  return false;
};

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Flag `useSelector` calls that return inline object literals without an equality function. Triggers unnecessary re-renders on every store update.",
    },
    schema: [],
    messages: {
      unstableReturn:
        "`useSelector` returns an inline object without an equality function. Every store dispatch will trigger a re-render. Pass `shallowEqual` as the second argument or use a memoized selector.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== "Identifier" || callee.name !== "useSelector") {
          return;
        }
        // If a second argument is present, trust the caller passed shallowEqual or similar.
        if (node.arguments.length >= 2) return;

        const first = node.arguments[0];
        if (!first) return;
        const isFn = first.type === "ArrowFunctionExpression" || first.type === "FunctionExpression";
        if (!isFn) return;

        if (bodyYieldsObjectLiteral(first)) {
          context.report({ node, messageId: "unstableReturn" });
        }
      },
    };
  },
};
