/**
 * domain-boundaries ESLint rule
 *
 * Flags files that reference more than `threshold` distinct domain
 * categories. "Categories" are user-supplied buckets, keyed off string
 * literals, identifiers, or member-access property names that appear in
 * the file. Router files, constants barrels, and feature-flag registries
 * that legitimately bridge every category show up; they're the signal
 * the rule is working. Suppress at the file level when intentional:
 *
 *   // eslint-disable @code-smells/domain-boundaries
 *
 * Category detection covers three surface forms:
 *
 *   1. Member access — `CATEGORIES.ORDER`, `CATEGORIES['ORDER']`
 *   2. Bare identifiers — `OrderContainer`, `ORDER_MILESTONES`
 *   3. String literals — exact match, e.g. `'Order'`, `'order-detail'`
 *
 * ## Options
 *
 * ```js
 * "code-smells/domain-boundaries": ["warn", {
 *   threshold: 3,
 *   categories: {
 *     // token → category bucket. Multiple tokens can map to the same
 *     // bucket so consumer/business variants collapse into one category.
 *     ORDER: "order",
 *     OrderContainer: "order",
 *     "Order": "order",
 *     CUSTOMER: "customer",
 *     "Customer": "customer",
 *     // ...
 *   }
 * }]
 * ```
 *
 * Without a `categories` map, the rule is a no-op — no signal without
 * domain input. That's intentional: the rule has no built-in domain
 * knowledge; teams bring their own.
 */

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Flag files that reference N+ distinct domain categories — signals the file has crossed a container / module / feature boundary. Categories are user-supplied via the `categories` option.",
    },
    schema: [
      {
        type: "object",
        properties: {
          threshold: { type: "integer", minimum: 2 },
          categories: {
            type: "object",
            additionalProperties: { type: "string" },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      tooManyCategories:
        "File references {{count}} domain categories ({{categories}}). Threshold is {{threshold}} — this file likely crosses a container boundary. Consider splitting per-category logic into dedicated modules, or use a registry indirection.",
    },
  },
  create(context) {
    const threshold = context.options[0]?.threshold ?? 3;
    const tokenToCategory = context.options[0]?.categories ?? {};
    if (Object.keys(tokenToCategory).length === 0) return {};

    const hits = new Set();

    const record = (token) => {
      const category = tokenToCategory[token];
      if (category) hits.add(category);
    };

    return {
      Literal(node) {
        if (typeof node.value === "string") record(node.value);
      },
      TemplateLiteral(node) {
        if (node.expressions.length === 0 && node.quasis.length === 1) {
          record(node.quasis[0].value.cooked);
        }
      },
      Identifier(node) {
        // Skip RHS of `obj.NAME` — handled by MemberExpression branch to
        // avoid double-counting both `obj` and `NAME` as independent hits.
        if (node.parent?.type === "MemberExpression" && node.parent.property === node && !node.parent.computed) {
          return;
        }
        record(node.name);
      },
      MemberExpression(node) {
        if (!node.computed && node.property?.type === "Identifier") {
          record(node.property.name);
        }
      },
      "Program:exit"(node) {
        if (hits.size >= threshold) {
          context.report({
            node,
            messageId: "tooManyCategories",
            data: {
              count: String(hits.size),
              categories: [...hits].sort().join(", "),
              threshold: String(threshold),
            },
          });
        }
      },
    };
  },
};
