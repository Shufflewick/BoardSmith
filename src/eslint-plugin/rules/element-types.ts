/**
 * Same-file evidence shared by the element identity rules (no-element-identity-comparison,
 * no-element-array-state): which type names are GameElement classes, and which calls return
 * element collections.
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

/**
 * The engine's element class names plus every class declared in `program` that extends one of
 * them, transitively and in any declaration order.
 */
export function collectElementTypeNames(program: unknown): Set<string> {
  const elementTypeNames = new Set<string>(ENGINE_ELEMENT_CLASS_NAMES);
  const classDecls: { name: string; superName: string | undefined }[] = [];
  walk(program, (node) => {
    if (node.type === 'ClassDeclaration') {
      const id = node.id as { name?: string } | null | undefined;
      const superClass = node.superClass as { type?: string; name?: string } | null | undefined;
      if (id?.name) {
        classDecls.push({
          name: id.name,
          superName: superClass?.type === 'Identifier' ? superClass.name : undefined,
        });
      }
    }
  });

  let changed = true;
  while (changed) {
    changed = false;
    for (const decl of classDecls) {
      if (decl.superName && elementTypeNames.has(decl.superName) && !elementTypeNames.has(decl.name)) {
        elementTypeNames.add(decl.name);
        changed = true;
      }
    }
  }
  return elementTypeNames;
}
