import { describe, it, expect } from "vitest";
import rule from "../eslint-rules/domain-boundaries.mjs";
import { ruleTester } from "./rule-tester.mjs";

// domain-boundaries: no built-in domain knowledge. Without a
// `categories` map, it's a no-op. With a map, it tallies distinct
// category buckets referenced in the file and flags once per file
// when the count crosses the threshold.

describe("domain-boundaries", () => {
  const CATS_MAP = {
    ORDER: "order",
    OrderContainer: "order",
    Order: "order",
    CUSTOMER: "customer",
    CustomerContainer: "customer",
    Customer: "customer",
    PRODUCT: "product",
    ProductContainer: "product",
    Product: "product",
  };

  ruleTester.run("domain-boundaries", rule, {
    valid: [
      {
        name: "no categories option — rule inert",
        code: `const x = ORDER; const y = CUSTOMER; const z = PRODUCT; const q = BILLING;`,
        options: [{ threshold: 2 }],
      },
      {
        name: "under threshold (1 category)",
        code: `const x = ORDER; const y = OrderContainer; fn("Order");`,
        options: [{ threshold: 3, categories: CATS_MAP }],
      },
      {
        name: "two categories at threshold 3 — not flagged",
        code: `const a = ORDER; const b = CUSTOMER;`,
        options: [{ threshold: 3, categories: CATS_MAP }],
      },
    ],
    invalid: [
      {
        name: "three categories via bare identifiers",
        code: `const a = ORDER; const b = CUSTOMER; const c = PRODUCT;`,
        options: [{ threshold: 3, categories: CATS_MAP }],
        errors: [{ messageId: "tooManyCategories" }],
      },
      {
        name: "categories via string literals",
        code: `fn("Order"); fn("Customer"); fn("Product");`,
        options: [{ threshold: 3, categories: CATS_MAP }],
        errors: [{ messageId: "tooManyCategories" }],
      },
      {
        name: "categories via member access",
        code: `
          const a = CATS.ORDER;
          const b = CATS.CUSTOMER;
          const c = CATS.PRODUCT;
        `,
        options: [{ threshold: 3, categories: CATS_MAP }],
        errors: [{ messageId: "tooManyCategories" }],
      },
      {
        name: "categories via template literal (no expressions)",
        code: "const a = `Order`; const b = `Customer`; const c = `Product`;",
        options: [{ threshold: 3, categories: CATS_MAP }],
        errors: [{ messageId: "tooManyCategories" }],
      },
      {
        name: "mixed surfaces collapse to same categories",
        code: `
          import { OrderContainer } from "./order";
          import { CustomerContainer } from "./customer";
          import { ProductContainer } from "./product";
        `,
        options: [{ threshold: 3, categories: CATS_MAP }],
        errors: [{ messageId: "tooManyCategories" }],
      },
      {
        name: "dynamic member access (computed) — property Identifier ignored",
        code: `
          const a = CATS["ORDER"];
          const b = CATS["CUSTOMER"];
          const c = CATS["PRODUCT"];
        `,
        options: [{ threshold: 3, categories: CATS_MAP }],
        errors: [{ messageId: "tooManyCategories" }],
      },
    ],
  });

  it("categories map with zero entries is a no-op", () => {
    // Direct create() call — verifies the early-return branch.
    const context = { options: [{ threshold: 3, categories: {} }], report: () => {} };
    const visitors = rule.create(context);
    expect(visitors).toEqual({});
  });
});
