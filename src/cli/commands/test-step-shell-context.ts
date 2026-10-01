/**
 * `test-step-shell-context.ts`: which lines of a test provide, by hand, a key only one shell
 * provides (#453). `boardsmith test-step-check` reports each one.
 *
 * A board test once passed with a hand-built context that offered a table's `gameState` to a
 * world's board, which a world's shell never provides, and the board threw the moment it rendered
 * in the real world. `renderAsSeat`, `tableShellContext` and `worldShellContext` give exactly what
 * the real shell gives and refuse a key it does not, so a key handed to one of them is left to
 * that check. A key both shells provide (board interaction, the shared half of the game context)
 * cannot make a board pass here and throw there, so it is not reported.
 */
import { parseSource, walk, type AstNode } from './test-step-ast.js';

/**
 * The game-context fields a table's shell provides and a world's never does. A test in
 * `test-step-shell-context.test.ts` holds this list equal to the one the shells are built from.
 */
export const ONE_SHELL_CONTEXT_FIELDS = ['gameState', 'dueSeats', 'timeTravelDiff', 'turnDeadline'] as const;

/** The other keys only one shell provides: the table's announcer and animations, and the world itself. */
const ONE_SHELL_KEYS = new Set(['ANNOUNCER_KEY', 'ANIMATION_EVENTS_KEY', 'WORLD_CONTEXT_KEY']);

/** The helpers that provide one of those keys. */
const ONE_SHELL_PROVIDERS = new Set(['provideAnnouncer', 'provideAnimationEvents']);

/** The stubs whose `provide` option is checked against the real shell when the test runs. */
const CHECKED_STUBS = new Set(['renderAsSeat', 'tableShellContext', 'worldShellContext', 'assertNoHiddenInfoLeak']);

interface HandBuiltProvision {
  line: number;
  /** The key as the test names it, e.g. `GAME_CONTEXT_KEYS.gameState`, or the helper it calls. */
  key: string;
}

/** `x as symbol`, `x!` and `<symbol>x` are all `x`. */
function unwrapped(node: AstNode): AstNode {
  let current = node;
  while (['TSAsExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'TSSatisfiesExpression'].includes(current.type)) {
    current = current.expression as AstNode;
  }
  return current;
}

function identifierName(node: AstNode | undefined): string | undefined {
  return node?.type === 'Identifier' ? (node.name as string) : undefined;
}

/** The name a one-shell key goes by in `node`, or undefined when `node` is not one. */
function oneShellKey(node: AstNode | undefined): string | undefined {
  if (node === undefined) return undefined;
  const expression = unwrapped(node);
  const name = identifierName(expression);
  if (name !== undefined) return ONE_SHELL_KEYS.has(name) ? name : undefined;
  if (expression.type !== 'MemberExpression' || identifierName(expression.object as AstNode) !== 'GAME_CONTEXT_KEYS') return undefined;
  const property = expression.property as AstNode;
  const field = expression.computed ? (property.type === 'Literal' ? String(property.value) : undefined) : identifierName(property);
  return (ONE_SHELL_CONTEXT_FIELDS as readonly (string | undefined)[]).includes(field) ? `GAME_CONTEXT_KEYS.${field}` : undefined;
}

/** The called function's own name: `provide(...)` and `app.provide(...)` are both `provide`. */
function calleeName(call: AstNode): string | undefined {
  const callee = call.callee as AstNode;
  if (callee.type === 'MemberExpression' && !callee.computed) return identifierName(callee.property as AstNode);
  return identifierName(callee);
}

/**
 * Whether the object property whose ancestors these are sits in the `provide` option of a checked
 * stub: `stub(subject, seat, { provide: { [key]: value } })`.
 */
function inCheckedStubOption(ancestors: AstNode[]): boolean {
  if (ancestors.length < 4) return false;
  const [call, options, provideProperty, object] = ancestors.slice(-4);
  const isProvideOption = provideProperty.type === 'Property' && !provideProperty.computed && identifierName(provideProperty.key as AstNode) === 'provide';
  const shapes = [call.type, options.type, object.type].join(' ');
  return isProvideOption && shapes === 'CallExpression ObjectExpression ObjectExpression' && CHECKED_STUBS.has(calleeName(call) ?? '');
}

/** The key a node provides by hand, or undefined. */
function handProvided(node: AstNode, ancestors: AstNode[]): string | undefined {
  if (node.type === 'CallExpression') {
    const name = calleeName(node);
    if (name !== undefined && ONE_SHELL_PROVIDERS.has(name)) return name;
    if (name === 'provide') return oneShellKey((node.arguments as AstNode[])[0]);
    return undefined;
  }
  if (node.type === 'Property' && node.computed && !inCheckedStubOption(ancestors)) return oneShellKey(node.key as AstNode);
  return undefined;
}

/** Every place `source` provides a one-shell key by hand, in source order. */
export function findHandBuiltShellContext(source: string, file?: string): HandBuiltProvision[] {
  const found: HandBuiltProvision[] = [];
  walk(parseSource(source, file).ast, (node, ancestors) => {
    const key = handProvided(node, ancestors);
    if (key !== undefined) found.push({ line: node.loc.start.line, key });
  });
  return found;
}
