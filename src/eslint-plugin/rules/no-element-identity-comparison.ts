import type { Rule } from 'eslint';
import { annotatedTypeName, ENGINE_ELEMENT_CLASS_NAMES, collectSubclassNames, isCollectionCall, walk } from './element-types.js';

/**
 * Disallows `===`/`!==` identity comparison between GameElement instances,
 * and `GameElement[].includes(element)`, in favor of comparing `.id`.
 *
 * Rationale: GameElement instances may be wrapped in reactive proxies or
 * re-created via clone/restore (snapshots, undo, bot simulation). Two
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
 *       an engine element class (`GameElement`, `Piece`, `Card`, ... --
 *       ENGINE_ELEMENT_CLASS_NAMES in ./element-types.ts) directly, or a
 *       class known (from evidence (b)) to extend one (transitively).
 *   (b) A `class X extends Y` declaration in the same file, where `Y` is
 *       an engine element class or another known subclass -- used only to resolve
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
 * Auto-fix: `===`/`!==` is only flagged between two identifiers, so it is
 * always rewritten to compare `.id` on each side. `.includes()` matches are
 * never auto-fixed (the correct rewrite, `.some(el => el.id === x.id)`,
 * changes the surrounding expression shape rather than a single operand).
 */

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
    let elementTypeNames = new Set<string>();
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
     * ESLint scope manager. An identifier that cannot be resolved has no
     * declarations, so it never matches. Matching by name instead would
     * reintroduce the cross-scope false positive this rule exists to avoid.
     */
    function resolveDeclNodes(identifierNode: Record<string, unknown>): object[] {
      const sourceCode = context.sourceCode;
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
        elementTypeNames = collectSubclassNames(program, ENGINE_ELEMENT_CLASS_NAMES);

        // Pass 2: collect declaration nodes (params/variable-declarator ids)
        // with a resolved GameElement(-ish) type annotation, and variables
        // initialized from a known collection-returning call.
        walk(program, (node) => {
          if (node.type === 'Identifier' && node.typeAnnotation) {
            const { name, isArray } = annotatedTypeName(node.typeAnnotation);
            if (name && elementTypeNames.has(name)) {
              if (isArray) elementArrayVarDeclNodes.add(node);
              else elementVarDeclNodes.add(node);
            }
          }

          if (node.type === 'VariableDeclarator') {
            const id = node.id as { type?: string; name?: string } | undefined;
            if (id?.type === 'Identifier' && id.name && isCollectionCall(node.init as Record<string, unknown> | null | undefined)) {
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

        const sourceCode = context.sourceCode;
        const leftText = sourceCode.getText(left);
        const rightText = sourceCode.getText(right);

        context.report({
          node,
          messageId: 'identityComparison',
          data: { operator: node.operator, leftText, rightText },
          fix: (fixer) => [
            fixer.replaceText(left, `${leftText}.id`),
            fixer.replaceText(right, `${rightText}.id`),
          ],
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
          const sourceCode = context.sourceCode;
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
