/**
 * Helper utilities shared by the hook-count and use-effect-count ESLint rules.
 *
 * Both rules need "is this function a React component?" detection — PascalCase
 * name + returns JSX. Extracted so the rules stay small and testable.
 */

/** True if a name looks like a React component (PascalCase). */
export const isComponentName = (name) => typeof name === "string" && /^[A-Z][A-Za-z0-9]+$/.test(name);

/** Try to resolve the name of a function-like node (declaration or assigned arrow). */
export const getFunctionName = (node) => {
  if (node.type === "FunctionDeclaration") return node.id?.name ?? null;
  // Arrow or function expression assigned to a const: `const Foo = () => ...`
  const parent = node.parent;
  if (parent?.type === "VariableDeclarator" && parent.id?.type === "Identifier") {
    return parent.id.name;
  }
  // Object property, etc. — we skip these (not typical for React components)
  return null;
};

/**
 * True if the call is a React hook (`use*()`) by name convention.
 * Conservative: only bare identifiers, not member expressions (we don't
 * want to flag `Foo.useEffect()` which isn't a real thing).
 */
export const isHookCall = (node) =>
  node.callee?.type === "Identifier" &&
  typeof node.callee.name === "string" &&
  /^use[A-Z]/.test(node.callee.name);
