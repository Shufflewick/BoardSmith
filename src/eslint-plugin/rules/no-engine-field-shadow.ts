import type { Rule } from 'eslint';
import { describeEngineFieldShadow, isEngineOwnedGameField } from '../../engine/element/engine-owned-fields.js';
import { collectSubclassNames, staticName, superClassName } from './element-types.js';

/**
 * Disallows a Game subclass from using the name of a field the engine owns on
 * every Game (#346): `pile`, `random`, `phase`, `settings`, `messages`,
 * and the rest of `ENGINE_OWNED_GAME_FIELDS`.
 *
 * A zone called `pile` type-checks (it narrows `Game.pile`) and works in a
 * fresh game, but the engine never serializes `pile` and rebuilds it on every
 * restore, so after the first session op, undo or bot search the game reads a
 * discarded copy while the live tree holds the real one. The same happens,
 * one way or another, to every name in the table.
 *
 * Reported, inside a class that extends `Game` (also when imported from
 * boardsmith under another name, or a same-file subclass of it, transitively):
 *   - a class member of that name: a field (including `declare`), a method, or
 *     an accessor;
 *   - an assignment `this.<name> = ...` whose `this` is the game, including
 *     inside arrow functions in the class.
 *
 * Reading and mutating engine fields (`this.settings.variant = ...`,
 * `this.pile.all()`) is the engine's API and is not reported.
 *
 * SYNTACTIC, like the other rules here (`parserOptions.project` is off): a
 * class whose Game ancestry passes through an import from another file is not
 * recognised. `constructGame` refuses the same mistake at runtime for the
 * fields whose value it can check, which covers that case for those.
 */

type AstNode = Record<string, unknown> & { type: string; parent?: AstNode };

/** The name a class is known by: its own id, or the variable it is assigned to. */
function className(classNode: AstNode): string {
  const id = classNode.id as { name?: string } | null | undefined;
  if (id?.name) return id.name;
  const parent = classNode.parent;
  if (parent?.type === 'VariableDeclarator') {
    const declared = parent.id as { type?: string; name?: string };
    if (declared.type === 'Identifier' && declared.name) return declared.name;
  }
  return 'This Game subclass';
}

const MEMBER_TYPES: ReadonlySet<string> = new Set([
  'PropertyDefinition',
  'MethodDefinition',
  'TSAbstractPropertyDefinition',
  'TSAbstractMethodDefinition',
]);

/** The engine field an instance member of a class claims, if it claims one. */
function claimedMemberField(member: AstNode): string | undefined {
  if (!MEMBER_TYPES.has(member.type) || member.static || member.kind === 'constructor') return undefined;
  const name = staticName(member.key, member.computed);
  return name !== undefined && isEngineOwnedGameField(name) ? name : undefined;
}

/** The engine field an assignment `this.<name> = ...` writes, if it writes one. */
function assignedThisField(assignment: AstNode): string | undefined {
  const target = assignment.left as AstNode;
  if (target.type !== 'MemberExpression' || (target.object as AstNode).type !== 'ThisExpression') return undefined;
  const name = staticName(target.property, target.computed);
  return name !== undefined && isEngineOwnedGameField(name) ? name : undefined;
}

/**
 * The class whose instance `this` is at `node`: the nearest enclosing class,
 * unless a non-arrow function that is not one of that class's own members
 * rebinds `this` first.
 */
function enclosingThisClass(node: AstNode): AstNode | undefined {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === 'ClassBody') return current.parent;
    const rebindsThis = current.type === 'FunctionExpression' || current.type === 'FunctionDeclaration';
    const ownerType = current.parent?.type;
    if (rebindsThis && ownerType !== 'MethodDefinition' && ownerType !== 'PropertyDefinition') return undefined;
  }
  return undefined;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow a Game subclass from using the name of a field the engine owns on every Game (pile, random, phase, settings, ...). The engine rebuilds those fields on every restore, so the game\'s own value is silently lost.',
      recommended: true,
    },
    messages: {
      engineFieldShadow: '{{text}}',
    },
    schema: [],
  },

  create(context) {
    // Read from the whole file first, so a subclass declared above its same-file base is still recognised.
    let games = new Set<string>();

    function report(node: AstNode, classNode: AstNode, field: string): void {
      const parent = superClassName(classNode);
      if (!parent || !games.has(parent)) return;
      context.report({
        node: node as unknown as Rule.Node,
        messageId: 'engineFieldShadow',
        data: { text: describeEngineFieldShadow(className(classNode), field) },
      });
    }

    return {
      Program(program) {
        games = collectSubclassNames(program, ['Game']);
      },

      'ClassDeclaration, ClassExpression'(node: Rule.Node) {
        const classNode = node as unknown as AstNode;
        for (const member of (classNode.body as { body: AstNode[] }).body) {
          const field = claimedMemberField(member);
          if (field) report(member, classNode, field);
        }
      },

      AssignmentExpression(node) {
        const assignment = node as unknown as AstNode;
        const field = assignedThisField(assignment);
        const classNode = field ? enclosingThisClass(assignment) : undefined;
        if (field && classNode) report(assignment, classNode, field);
      },
    };
  },
};

export default rule;
