import type { Rule } from 'eslint';

/**
 * Disallows storing arrays of GameElement instances as persistent class
 * state outside the element tree, and disallows persisting the result of
 * a collection-returning query (`.all()`, `.first()`, etc.) onto a class
 * property.
 *
 * Rationale: Element arrays stored as plain state go stale the moment an
 * element moves elsewhere in the element tree (a card changes hands, a
 * piece is captured, etc.) -- the stored array does not automatically
 * reflect the new tree shape. The correct pattern is either to query the
 * element tree at point of use (`game.all(...)`, `space.contents()`, ...)
 * or to persist stable element `.id`s and resolve them via the tree when
 * needed. This rule is NOT auto-fixable: the correct rewrite depends on
 * why the array was being stored (id-list vs. re-query), which requires a
 * human decision.
 *
 * SYNTACTIC-ONLY HEURISTIC (no type information available -- this repo's
 * eslint.config.mjs sets `parserOptions.project: false`), matching the
 * convention established in no-element-identity-comparison.ts:
 *
 *   (a) A `class X extends Y` declaration in the same file, where `Y` is
 *       `GameElement` or another known subclass (resolved transitively) --
 *       used to determine whether a class is itself an element (in which
 *       case storing a child array is the intended, correct pattern and is
 *       NOT flagged).
 *   (b) A `PropertyDefinition` (class field) whose type annotation is an
 *       array of a same-file-known GameElement/subclass type, declared in
 *       a class that does NOT itself extend GameElement/subclass -- flagged
 *       as `elementArrayField`.
 *   (c) An assignment `this.<prop> = <recv>.<method>(...)` (as a plain
 *       `AssignmentExpression`, or as a `PropertyDefinition` initializer)
 *       where `<method>` is a known collection-returning call name
 *       (`all`, `first`, `firstN`, `last`, `lastN`) -- flagged as
 *       `elementArrayAssignment`. This does NOT require type information;
 *       it fires on the shape of the call regardless of the receiver's
 *       declared type, but ONLY when the result is persisted onto `this.*`
 *       (a class property), never for locals.
 *
 * ACCEPTED BOUNDS (documented, not bugs):
 *   - False negatives: a persisted element array with no same-file type
 *     evidence and no recognizable collection-call shape (e.g. an
 *     untyped field assigned from an opaquely-named helper) is NOT
 *     flagged. This is a deliberate scope limit of a syntactic-only rule;
 *     catching those would require full type information.
 *   - False positives: a same-file class/type happening to be named after
 *     a GameElement subclass without actually extending GameElement (or a
 *     shadowing local type of the same name) could be flagged incorrectly.
 *     Considered acceptable risk for an authoring lint (see RESEARCH
 *     Pitfall #3) -- real games are exercised in a later phase, not here.
 *
 * Not auto-fixable: whether the fix is "query at point of use" or "store
 * IDs instead" depends on intent, so this rule reports only.
 */

const COLLECTION_CALL_NAMES = new Set(['all', 'first', 'firstN', 'last', 'lastN']);

interface ClassDecl {
  name: string;
  superName: string | undefined;
}

/** Generic deep walker over an ESLint/TS-ESLint AST subtree. */
function walk(node: unknown, visit: (n: Record<string, unknown>) => void): void {
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

/** Resolves a TSTypeAnnotation wrapper to a referenced array element type name, if any. */
function resolveArrayElementTypeName(typeAnnotationWrapper: unknown): string | undefined {
  const wrapper = typeAnnotationWrapper as { typeAnnotation?: Record<string, unknown> } | undefined;
  const ta = wrapper?.typeAnnotation;
  if (!ta || ta.type !== 'TSArrayType') return undefined;

  const elementType = ta.elementType as Record<string, unknown> | undefined;
  if (elementType?.type === 'TSTypeReference') {
    const typeName = elementType.typeName as { type?: string; name?: string } | undefined;
    if (typeName?.type === 'Identifier' && typeof typeName.name === 'string') {
      return typeName.name;
    }
  }
  return undefined;
}

/** Is this call expression a known collection-returning query (`.all()`, `.first()`, ...)? */
function isCollectionCall(node: Record<string, unknown> | null | undefined): boolean {
  if (!node || node.type !== 'CallExpression') return false;
  const callee = node.callee as { type?: string; property?: { type?: string; name?: string } } | undefined;
  return (
    callee?.type === 'MemberExpression' &&
    callee.property?.type === 'Identifier' &&
    typeof callee.property.name === 'string' &&
    COLLECTION_CALL_NAMES.has(callee.property.name)
  );
}

/** Is this a `this.<prop>` member expression (a persistent class property target)? */
function isThisPropertyTarget(node: Record<string, unknown> | null | undefined): boolean {
  if (!node) return false;
  if (node.type === 'MemberExpression') {
    const object = node.object as { type?: string } | undefined;
    return object?.type === 'ThisExpression';
  }
  // A bare PropertyDefinition key counts as a persistent class property too.
  return false;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow storing GameElement arrays as persistent class state, and disallow persisting game.all()/first()/etc. query results onto a class property. Query the element tree at point of use, or store element IDs instead. Syntactic-only heuristic (no type info) -- see rule source for documented false-positive/negative bounds.',
      recommended: true,
    },
    messages: {
      elementArrayField:
        'Storing `{{typeName}}[]` as a class field on a non-GameElement class goes stale when elements move in the tree. Query the element tree at point of use (e.g. `game.all({{typeName}})`) or store element IDs instead.',
      elementArrayAssignment:
        'Persisting the result of `{{methodName}}(...)` onto `this.{{propName}}` goes stale when elements move in the tree. Query the element tree at point of use instead of caching the result on a class property.',
    },
    schema: [],
  },

  create(context) {
    const elementTypeNames = new Set<string>(['GameElement']);

    return {
      Program(program) {
        // Pass 1: collect same-file class declarations to resolve which
        // local type names are GameElement subclasses (transitively).
        const classDecls: ClassDecl[] = [];
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
      },

      ClassDeclaration(classNode) {
        const superClass = classNode.superClass as { type?: string; name?: string } | null | undefined;
        const isElementClass =
          superClass?.type === 'Identifier' && !!superClass.name && elementTypeNames.has(superClass.name);

        if (isElementClass) return; // element-tree owner: storing children is correct.

        const body = (classNode.body as { body?: unknown[] }).body ?? [];
        for (const member of body) {
          const propDef = member as Record<string, unknown>;
          if (propDef.type !== 'PropertyDefinition') continue;

          // (b) GameElement[]-typed field.
          const typeName = resolveArrayElementTypeName((propDef as { typeAnnotation?: unknown }).typeAnnotation);
          if (typeName && elementTypeNames.has(typeName)) {
            context.report({
              node: propDef as unknown as Rule.Node,
              messageId: 'elementArrayField',
              data: { typeName },
            });
            continue;
          }

          // (c) PropertyDefinition initializer is a persisted collection call,
          // e.g. `captured = game.all(Piece);` as a class field initializer.
          const value = propDef.value as Record<string, unknown> | null | undefined;
          if (isCollectionCall(value)) {
            const callee = value!.callee as { property?: { name?: string } };
            const key = propDef.key as { name?: string } | undefined;
            context.report({
              node: propDef as unknown as Rule.Node,
              messageId: 'elementArrayAssignment',
              data: {
                methodName: callee.property?.name ?? '',
                propName: key?.name ?? '',
              },
            });
          }
        }
      },

      AssignmentExpression(node) {
        if (node.operator !== '=') return;
        const left = node.left as unknown as Record<string, unknown>;
        if (!isThisPropertyTarget(left)) return;

        const right = node.right as unknown as Record<string, unknown>;
        if (!isCollectionCall(right)) return;

        const callee = (right.callee as { property?: { name?: string } }).property;
        const propKey = (left as { property?: { type?: string; name?: string } }).property;

        context.report({
          node: node as unknown as Rule.Node,
          messageId: 'elementArrayAssignment',
          data: {
            methodName: callee?.name ?? '',
            propName: propKey?.type === 'Identifier' ? propKey.name ?? '' : '',
          },
        });
      },
    };
  },
};

export default rule;
