import type { Rule } from 'eslint';
import { describeEngineFieldShadow, isEngineOwnedGameField } from '../../engine/element/engine-owned-fields.js';

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
 * Reported, inside a class that extends `Game` (or a same-file subclass of it,
 * transitively):
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

/** The name a member key or a `this.<name>` property spells, when it is static. */
function staticName(key: unknown, computed: unknown): string | undefined {
  const node = key as { type?: string; name?: string; value?: unknown } | undefined;
  if (node?.type === 'Identifier' && !computed) return node.name;
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  return undefined;
}

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

function superName(classNode: AstNode): string | undefined {
  const superClass = classNode.superClass as { type?: string; name?: string } | null | undefined;
  return superClass?.type === 'Identifier' ? superClass.name : undefined;
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

/** Every class name that is a Game: `Game` itself, then same-file subclasses, transitively. */
function gameClassNames(classes: readonly AstNode[]): Set<string> {
  const names = new Set<string>(['Game']);
  let grew = true;
  while (grew) {
    grew = false;
    for (const classNode of classes) {
      const parent = superName(classNode);
      const name = className(classNode);
      if (parent && names.has(parent) && !names.has(name)) {
        names.add(name);
        grew = true;
      }
    }
  }
  return names;
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
    // Collected during the walk and judged at the end, so a subclass declared
    // above its same-file base class is still recognised.
    const classes: AstNode[] = [];
    const claims: Array<{ node: AstNode; classNode: AstNode; field: string }> = [];

    return {
      'ClassDeclaration, ClassExpression'(node: Rule.Node) {
        const classNode = node as unknown as AstNode;
        classes.push(classNode);
        for (const member of (classNode.body as { body: AstNode[] }).body) {
          const field = claimedMemberField(member);
          if (field) claims.push({ node: member, classNode, field });
        }
      },

      AssignmentExpression(node) {
        const assignment = node as unknown as AstNode;
        const field = assignedThisField(assignment);
        const classNode = field ? enclosingThisClass(assignment) : undefined;
        if (field && classNode) claims.push({ node: assignment, classNode, field });
      },

      'Program:exit'() {
        const games = gameClassNames(classes);
        for (const { node, classNode, field } of claims) {
          const parent = superName(classNode);
          if (!parent || !games.has(parent)) continue;
          context.report({
            node: node as unknown as Rule.Node,
            messageId: 'engineFieldShadow',
            data: { text: describeEngineFieldShadow(className(classNode), field) },
          });
        }
      },
    };
  },
};

export default rule;
