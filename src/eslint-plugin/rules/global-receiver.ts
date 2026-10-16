/**
 * Finding every place code reaches a global, whatever the spelling.
 *
 * The sandbox rules must catch `fetch()`, `const f = fetch`, `fetch.call()`,
 * `globalThis['fetch']()` and `Math['random']` alike (#737), without catching a
 * game's own `deck.fetch()` or a parameter named `fetch` (#38). So they match
 * references the scope manager resolved to the global scope, not call shapes.
 */
import type { Rule, Scope, SourceCode } from 'eslint';

// AST types come through eslint's own typings: 'estree' is not a package boardsmith declares (#380).
type Identifier = Scope.Reference['identifier'];
type MemberExpression = Extract<Rule.Node, { type: 'MemberExpression' }>;

/** An expression that evaluates to a global: `fetch` or `globalThis.fetch`. */
type GlobalRead = (Identifier | MemberExpression) & Rule.NodeParentExtension;

/** Identifiers that really do name the global object. */
const GLOBAL_RECEIVERS: ReadonlySet<string> = new Set(['window', 'globalThis', 'self', 'global']);

/** The name in `a.b`, `a['b']`, `{ b }` or `{ 'b': x }`, or undefined when it is computed. */
function staticName(key: MemberExpression['property'], computed: boolean): string | undefined {
  if (!computed && key.type === 'Identifier') return key.name;
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  return undefined;
}

/** True when a reference only names a type (`x: WebSocket`, `typeof fetch` in a type), so nothing runs. */
function isTypeOnly(reference: Scope.Reference): boolean {
  // typescript-eslint flags type references, but counts `typeof x` inside a type as a value read.
  if ((reference as { isTypeReference?: boolean }).isTypeReference) return true;
  for (let n: Rule.Node | null = (reference.identifier as Rule.Node).parent; n; n = n.parent) {
    if ((n.type as string) === 'TSTypeQuery') return true;
  }
  return false;
}

/**
 * Calls `visit` for every reference to one of `names` that reaches the global
 * scope: a bare name no local binding shadows, or a property read through a
 * global receiver (`globalThis.fetch`, `window['fetch']`), outside type positions. `node` is the
 * expression that evaluates to the global.
 */
export function forEachGlobalReference(
  sourceCode: SourceCode,
  names: ReadonlySet<string>,
  visit: (name: string, node: GlobalRead) => void,
): void {
  const globalScope = sourceCode.scopeManager.globalScope!;
  // Configured and built-in globals resolve to variables with no declaration; the rest stay unresolved.
  const references = [
    ...globalScope.through,
    ...globalScope.variables.filter((v) => v.defs.length === 0).flatMap((v) => v.references),
  ];
  for (const reference of references) {
    if (isTypeOnly(reference)) continue;
    const node = reference.identifier as Identifier & Rule.NodeParentExtension;
    if (names.has(node.name)) {
      visit(node.name, node);
    } else if (GLOBAL_RECEIVERS.has(node.name)) {
      const parent = node.parent;
      if (parent.type === 'MemberExpression' && parent.object === node) {
        const name = staticName(parent.property, parent.computed);
        if (name !== undefined && names.has(name)) visit(name, parent as GlobalRead);
      }
    }
  }
}

/** True when `node` is read for `property`: `node.property`, `node['property']` or `const { property } = node`. */
export function readsProperty(node: GlobalRead, property: string): boolean {
  const parent = node.parent;
  if (parent.type === 'MemberExpression' && parent.object === node) {
    return staticName(parent.property, parent.computed) === property;
  }
  if (parent.type === 'VariableDeclarator' && parent.init === node && parent.id.type === 'ObjectPattern') {
    return parent.id.properties.some(
      (p) => p.type === 'Property' && staticName(p.key, p.computed) === property,
    );
  }
  return false;
}
