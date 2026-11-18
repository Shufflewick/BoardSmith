/**
 * Same-file evidence shared by the plugin's syntactic rules: which type names are GameElement (or
 * Game) classes, which calls return element collections, and the names keys and annotations spell.
 */

/** Calls on an element that return element collections. */
export const COLLECTION_CALL_NAMES = new Set(['all', 'first', 'firstN', 'last', 'lastN']);

/**
 * Every GameElement class the engine exports, GameElement included. Games extend these, never
 * GameElement alone (#872). element-types.test.ts fails when the engine's exports drift from it.
 */
export const ENGINE_ELEMENT_CLASS_NAMES: readonly string[] = [
  'GameElement', 'Space', 'Piece', 'Card', 'Hand', 'Deck', 'Die', 'DicePool',
  'Grid', 'GridCell', 'HexGrid', 'HexCell', 'Game', 'Player',
];

/** The type name a `TSTypeReference` node names (`Card` in `Card` or `Card<G>`), if any. */
export function typeReferenceName(node: Record<string, unknown> | undefined): string | undefined {
  if (node?.type !== 'TSTypeReference') return undefined;
  const typeName = node.typeName as { type?: string; name?: string } | undefined;
  return typeName?.type === 'Identifier' ? typeName.name : undefined;
}

/** The name a member key or property spells when it is static: `a.b`, `a['b']`, `{ b }` or `{ 'b': x }`. */
export function staticName(key: unknown, computed: unknown): string | undefined {
  const node = key as { type?: string; name?: string; value?: unknown } | undefined;
  if (node?.type === 'Identifier' && !computed) return node.name;
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  return undefined;
}

/** The type name a TSTypeAnnotation wrapper names, and whether it is an array of it (`Card[]`). */
export function annotatedTypeName(typeAnnotationWrapper: unknown): { name: string | undefined; isArray: boolean } {
  const ta = (typeAnnotationWrapper as { typeAnnotation?: Record<string, unknown> } | undefined)?.typeAnnotation;
  if (ta?.type === 'TSArrayType') {
    return { name: typeReferenceName(ta.elementType as Record<string, unknown> | undefined), isArray: true };
  }
  return { name: typeReferenceName(ta), isArray: false };
}

/** Generic deep walker over an ESLint/TS-ESLint AST subtree. */
export function walk(node: unknown, visit: (n: Record<string, unknown>) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (typeof obj.type === 'string') {
    visit(obj);
  }
  for (const key of Object.keys(obj)) {
    if (key === 'parent') continue;
    const value = obj[key];
    if (value && typeof value === 'object') {
      walk(value, visit);
    }
  }
}

/** The local names an `ImportDeclaration` from boardsmith or a subpath binds `roots` to. */
function boardsmithLocalNames(node: Record<string, unknown>, roots: readonly string[]): string[] {
  const source = String((node.source as { value?: unknown }).value);
  if (source !== 'boardsmith' && !source.startsWith('boardsmith/')) return [];
  return (node.specifiers as { type: string; imported?: { name?: string }; local: { name: string } }[])
    .filter((spec) => spec.type === 'ImportSpecifier' && roots.includes(spec.imported?.name ?? ''))
    .map((spec) => spec.local.name);
}

/** The name of the class a node extends, when it is a plain identifier. */
export function superClassName(classNode: Record<string, unknown>): string | undefined {
  const superClass = classNode.superClass as { type?: string; name?: string } | null | undefined;
  return superClass?.type === 'Identifier' ? superClass.name : undefined;
}

/**
 * `roots`, the local name of each root imported from boardsmith under another name
 * (`import { Card as BaseCard } from 'boardsmith'`, #1036), and every class declared in `program`
 * (`class X extends Y` or `const X = class extends Y`, #1695) that extends one of them,
 * transitively and in any declaration order.
 */
export function collectSubclassNames(program: unknown, roots: readonly string[]): Set<string> {
  const names = new Set<string>(roots);
  const classDecls: { name: string; superName: string | undefined }[] = [];
  walk(program, (node) => {
    if (node.type === 'ImportDeclaration') {
      for (const local of boardsmithLocalNames(node, roots)) names.add(local);
      return;
    }
    const id = node.id as { type?: string; name?: string } | null | undefined;
    const init = node.init as Record<string, unknown> | null | undefined;
    if (node.type === 'ClassDeclaration' && id?.name) {
      classDecls.push({ name: id.name, superName: superClassName(node) });
    } else if (node.type === 'VariableDeclarator' && id?.type === 'Identifier' && id.name && init?.type === 'ClassExpression') {
      classDecls.push({ name: id.name, superName: superClassName(init) });
    }
  });

  let changed = true;
  while (changed) {
    changed = false;
    for (const decl of classDecls) {
      if (decl.superName && names.has(decl.superName) && !names.has(decl.name)) {
        names.add(decl.name);
        changed = true;
      }
    }
  }
  return names;
}
