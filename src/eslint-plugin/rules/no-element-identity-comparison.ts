import type { Rule } from 'eslint';

/**
 * Disallows `===`/`!==` identity comparison between GameElement instances,
 * and `GameElement[].includes(element)`, in favor of comparing `.id`.
 *
 * Rationale: GameElement instances may be wrapped in reactive proxies or
 * re-created via clone/restore (snapshots, replay, AI simulation). Two
 * references to "the same" game element are not guaranteed to be `===`
 * across those boundaries, but `.id` is stable. Comparing elements
 * directly with `===`/`!==` (or via `Array.prototype.includes`, which uses
 * `===` internally) is therefore an unreliable footgun; comparing `.id` is
 * the correct, reliable pattern.
 *
 * SYNTACTIC-ONLY HEURISTIC (no type information available -- this repo's
 * eslint.config.mjs sets `parserOptions.project: false`). An operand is
 * considered "GameElement-looking" using same-file evidence only:
 *
 *   (a) A variable/parameter whose declared TS type annotation names
 *       `GameElement` directly, or a class known (from evidence (b), in
 *       the SAME file) to extend `GameElement` (transitively).
 *   (b) A `class X extends Y` declaration in the same file, where `Y` is
 *       `GameElement` or another known subclass -- used only to resolve
 *       type names for (a), not as a comparison target itself.
 *   (c) A variable whose initializer is a known collection-returning call
 *       (`.all(...)`, `.first(...)`, `.firstN(...)`, `.last(...)`,
 *       `.lastN(...)`) is treated as GameElement[]-looking for the
 *       `.includes()` check, regardless of type annotation.
 *
 * SCOPE RESOLUTION (WR-03 fix): a used Identifier is matched against the
 * evidence in (a)/(c) by resolving it to its actual binding via the ESLint
 * scope manager (`sourceCode.getScope(node)` + the resolved `Reference`),
 * not by bare variable name. This means two unrelated same-named variables
 * declared in different functions/scopes in one file (e.g. a `Card`-typed
 * `card` in one function and a `string`-typed `card` in another) are never
 * conflated -- only the actual GameElement-typed binding is flagged.
 *
 * ACCEPTED BOUNDS (documented, not bugs):
 *   - False negatives: untyped operands with no same-file type/class/
 *     collection-call evidence (e.g. plain function params with no type
 *     annotation, or elements typed/declared in another file) are NOT
 *     flagged. This is a deliberate scope limit of a syntactic-only rule;
 *     catching those would require full type information.
 *   - False positives: a same-file class/type happening to be named after
 *     a GameElement subclass without actually extending GameElement (or a
 *     shadowing local type of the same name) could be flagged incorrectly.
 *     Considered acceptable risk for an authoring lint (see RESEARCH
 *     Pitfall #3) -- real games are exercised in a later phase, not here.
 *
 * Auto-fix: only applied to `===`/`!==` between two syntactically "simple"
 * operands (an identifier, or a non-computed member-expression chain
 * rooted in an identifier) -- rewritten to compare `.id` on each side.
 * Complex operands (calls, computed access, etc.) are reported without a
 * fix so a human decides how to rewrite them. `.includes()` matches are
 * never auto-fixed (the correct rewrite, `.some(el => el.id === x.id)`,
 * changes the surrounding expression shape rather than a single operand).
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

/** Resolves a TSTypeAnnotation wrapper to a referenced type name, if any. */
function resolveTypeAnnotation(typeAnnotationWrapper: unknown): { name: string | undefined; isArray: boolean } {
  const wrapper = typeAnnotationWrapper as { typeAnnotation?: Record<string, unknown> } | undefined;
  const ta = wrapper?.typeAnnotation;
  if (!ta) return { name: undefined, isArray: false };

  if (ta.type === 'TSTypeReference') {
    const typeName = ta.typeName as { type?: string; name?: string } | undefined;
    if (typeName?.type === 'Identifier' && typeof typeName.name === 'string') {
      return { name: typeName.name, isArray: false };
    }
  }

  if (ta.type === 'TSArrayType') {
    const elementType = ta.elementType as Record<string, unknown> | undefined;
    if (elementType?.type === 'TSTypeReference') {
      const typeName = elementType.typeName as { type?: string; name?: string } | undefined;
      if (typeName?.type === 'Identifier' && typeof typeName.name === 'string') {
        return { name: typeName.name, isArray: true };
      }
    }
  }

  return { name: undefined, isArray: false };
}

/** Is this expression node "simple" enough to safely rewrite to `<expr>.id`? */
function isSimpleOperand(node: Record<string, unknown>): boolean {
  if (node.type === 'Identifier') return true;
  if (node.type === 'MemberExpression' && node.computed === false) {
    return isSimpleOperand(node.object as Record<string, unknown>);
  }
  return false;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    fixable: 'code',
    docs: {
      description:
        'Disallow identity comparison (=== / !==, or Array#includes) between GameElement instances; compare `.id` instead. Syntactic-only heuristic (no type info) -- see rule source for documented false-positive/negative bounds.',
      recommended: true,
    },
    messages: {
      identityComparison:
        'Comparing GameElement instances with {{operator}} is unreliable (proxies/clones may break reference equality). Compare `.id` instead, e.g. `{{leftText}}.id {{operator}} {{rightText}}.id`.',
      identityIncludes:
        '`{{arrayText}}.includes({{argText}})` uses === identity, which is unreliable for GameElement instances (proxies/clones). Use `{{arrayText}}.some(el => el.id === {{argText}}.id)` instead.',
    },
    schema: [],
  },

  create(context) {
    const elementTypeNames = new Set<string>(['GameElement']);
    // Scope-hygiene fix (WR-03): membership is tracked by the *declaration*
    // Identifier AST node (the param/variable-declarator `id` node that
    // carried the GameElement(-ish) type annotation, or was initialized
    // from a collection-returning call) rather than by bare variable name.
    // A used Identifier is resolved to its binding via the ESLint scope
    // manager, then checked against these node sets -- so two unrelated
    // same-named variables in different functions (e.g. `card: Card` in one
    // function and `card: string` in another) are never conflated.
    const elementVarDeclNodes = new Set<object>();
    const elementArrayVarDeclNodes = new Set<object>();

    /**
     * Resolve a used Identifier node to its declaration node(s) via the
     * ESLint scope manager. Falls back to `null` (no match) if scope
     * information is unavailable or the identifier cannot be resolved --
     * NOT to name-based matching, since that would reintroduce the exact
     * cross-scope false positive this fix removes.
     */
    function resolveDeclNodes(identifierNode: Record<string, unknown>): object[] {
      const sourceCode = context.sourceCode ?? context.getSourceCode();
      if (typeof sourceCode.getScope !== 'function') return [];
      const scope = sourceCode.getScope(identifierNode as unknown as Rule.Node);
      const ref = scope.references.find((r) => (r.identifier as unknown) === identifierNode);
      const variable = ref?.resolved;
      if (!variable) return [];
      return variable.identifiers as unknown as object[];
    }

    function isElementDecl(identifierNode: Record<string, unknown>): boolean {
      return resolveDeclNodes(identifierNode).some((n) => elementVarDeclNodes.has(n));
    }

    function isElementArrayDecl(identifierNode: Record<string, unknown>): boolean {
      return resolveDeclNodes(identifierNode).some((n) => elementArrayVarDeclNodes.has(n));
    }

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

        // Pass 2: collect declaration nodes (params/variable-declarator ids)
        // with a resolved GameElement(-ish) type annotation, and variables
        // initialized from a known collection-returning call.
        walk(program, (node) => {
          if (node.type === 'Identifier' && node.typeAnnotation) {
            const { name, isArray } = resolveTypeAnnotation(node.typeAnnotation);
            if (name && elementTypeNames.has(name)) {
              if (isArray) elementArrayVarDeclNodes.add(node);
              else elementVarDeclNodes.add(node);
            }
          }

          if (node.type === 'VariableDeclarator') {
            const id = node.id as { type?: string; name?: string } | undefined;
            const init = node.init as
              | { type?: string; callee?: { type?: string; property?: { type?: string; name?: string } } }
              | null
              | undefined;
            if (
              id?.type === 'Identifier' &&
              id.name &&
              init?.type === 'CallExpression' &&
              init.callee?.type === 'MemberExpression' &&
              init.callee.property?.type === 'Identifier' &&
              init.callee.property.name &&
              COLLECTION_CALL_NAMES.has(init.callee.property.name)
            ) {
              elementArrayVarDeclNodes.add(id as unknown as object);
            }
          }
        });
      },

      BinaryExpression(node) {
        if (node.operator !== '===' && node.operator !== '!==') return;

        const left = node.left;
        const right = node.right;
        const isElementLike = (n: typeof left) =>
          n.type === 'Identifier' && isElementDecl(n as unknown as Record<string, unknown>);

        if (!isElementLike(left) || !isElementLike(right)) return;

        const sourceCode = context.sourceCode ?? context.getSourceCode();
        const leftText = sourceCode.getText(left);
        const rightText = sourceCode.getText(right);
        const canAutoFix = isSimpleOperand(left as unknown as Record<string, unknown>) && isSimpleOperand(right as unknown as Record<string, unknown>);

        context.report({
          node,
          messageId: 'identityComparison',
          data: { operator: node.operator, leftText, rightText },
          fix: canAutoFix
            ? (fixer) => [
                fixer.replaceText(left, `${leftText}.id`),
                fixer.replaceText(right, `${rightText}.id`),
              ]
            : undefined,
        });
      },

      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'includes' &&
          callee.object.type === 'Identifier' &&
          isElementArrayDecl(callee.object as unknown as Record<string, unknown>) &&
          node.arguments.length === 1
        ) {
          const sourceCode = context.sourceCode ?? context.getSourceCode();
          context.report({
            node,
            messageId: 'identityIncludes',
            data: {
              arrayText: sourceCode.getText(callee.object),
              argText: sourceCode.getText(node.arguments[0]),
            },
          });
        }
      },
    };
  },
};

export default rule;
