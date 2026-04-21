import { describe, it, expect } from "vitest";
import plugin from "../eslint-rules/index.mjs";
import { isComponentName, getFunctionName, isHookCall } from "../eslint-rules/utils.mjs";

describe("eslint-rules plugin shape", () => {
  it("exports a plugin object with meta + rules", () => {
    expect(plugin.meta.name).toBe("code-smells");
    expect(typeof plugin.meta.version).toBe("string");
    expect(Object.keys(plugin.rules).sort()).toEqual(
      ["domain-boundaries", "hook-count", "unstable-selector-returns", "use-effect-count"].sort(),
    );
  });
});

describe("isComponentName", () => {
  it.each([
    ["Foo", true],
    ["MyComponent", true],
    ["Foo123", true],
    ["foo", false],
    ["fooBar", false],
    ["F", false], // single-char doesn't match: regex requires at least 2 chars
    ["", false],
    ["2Foo", false],
  ])("isComponentName(%j) === %s", (input, expected) => {
    expect(isComponentName(input)).toBe(expected);
  });

  it("handles non-string inputs", () => {
    expect(isComponentName(null)).toBe(false);
    expect(isComponentName(undefined)).toBe(false);
    expect(isComponentName(42)).toBe(false);
  });
});

describe("getFunctionName", () => {
  it("returns id.name from FunctionDeclaration", () => {
    const node = { type: "FunctionDeclaration", id: { name: "MyComp" } };
    expect(getFunctionName(node)).toBe("MyComp");
  });

  it("returns null for anonymous FunctionDeclaration", () => {
    const node = { type: "FunctionDeclaration", id: null };
    expect(getFunctionName(node)).toBe(null);
  });

  it("returns parent.id.name for arrow assigned to const", () => {
    const node = {
      type: "ArrowFunctionExpression",
      parent: { type: "VariableDeclarator", id: { type: "Identifier", name: "Arrow" } },
    };
    expect(getFunctionName(node)).toBe("Arrow");
  });

  it("returns null when parent is not a VariableDeclarator", () => {
    const node = {
      type: "ArrowFunctionExpression",
      parent: { type: "ObjectProperty" },
    };
    expect(getFunctionName(node)).toBe(null);
  });

  it("returns null when parent.id is not an Identifier (destructuring)", () => {
    const node = {
      type: "ArrowFunctionExpression",
      parent: { type: "VariableDeclarator", id: { type: "ArrayPattern" } },
    };
    expect(getFunctionName(node)).toBe(null);
  });
});

describe("isHookCall", () => {
  it("flags bare use*() calls", () => {
    expect(isHookCall({ callee: { type: "Identifier", name: "useState" } })).toBe(true);
    expect(isHookCall({ callee: { type: "Identifier", name: "useMyCustomHook" } })).toBe(true);
  });

  it("rejects non-matching identifier calls", () => {
    expect(isHookCall({ callee: { type: "Identifier", name: "useful" } })).toBe(false); // no capital after 'use'
    expect(isHookCall({ callee: { type: "Identifier", name: "getState" } })).toBe(false);
  });

  it("rejects member-access calls (Foo.useEffect is not a hook here)", () => {
    expect(isHookCall({ callee: { type: "MemberExpression", name: "useState" } })).toBe(false);
  });

  it("handles callee without name (e.g. dynamic)", () => {
    expect(isHookCall({ callee: { type: "Identifier" } })).toBe(false);
  });

  it("handles callee missing entirely", () => {
    expect(isHookCall({})).toBe(false);
  });
});
