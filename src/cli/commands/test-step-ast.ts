/**
 * `test-step-ast.ts` — the source readers `boardsmith test-step-check` is built on (#290).
 *
 * Each function takes a file's text and answers one question about it by parsing it, never by
 * matching lines: which tests a test file declares and which claims each one cites, which verbs a
 * rules file defines, which verbs a test file dispatches through the engine, and which lines call
 * a guard unreachable. Kept apart from the command so the mutation runner can share the parser.
 */
import { parse } from '@typescript-eslint/parser';
import { scanTestCitations } from './trace-check.js';

/** The part of an ESTree node these readers look at. */
export interface AstNode {
  type: string;
  range: [number, number];
  loc: { start: { line: number }; end: { line: number } };
  [key: string]: unknown;
}

interface Comment {
  value: string;
  loc: { start: { line: number }; end: { line: number } };
}

export interface ParsedSource {
  ast: AstNode;
  comments: Comment[];
  tokens: Array<{ type: string; value: string; range: [number, number] }>;
}

/** Parses TypeScript with locations, comments and tokens. Throws a readable error naming `file`. */
/**
 * A file this check cannot read: nested too deeply for the parser, or not parseable. The message
 * says what to do; a caller that can carry on without the file catches this and names it instead.
 */
export class UnreadableSourceError extends Error {
  constructor(
    message: string,
    /** Why, in a few words for a finding that names the file. */
    readonly reason: string,
  ) {
    super(message);
    this.name = 'UnreadableSourceError';
  }
}

export function parseSource(source: string, file = 'this file'): ParsedSource {
  let program: ReturnType<typeof parse>;
  try {
    program = parse(source, {
      comment: true,
      tokens: true,
      loc: true,
      range: true,
      ecmaVersion: 'latest',
      sourceType: 'module',
    });
  } catch (err) {
    if (err instanceof RangeError) {
      throw new UnreadableSourceError(
        `${file} is nested too deeply for this check to read (usually a very long chain such as ` +
          "`a + b + c + ...`). Build the value another way, for example an array of parts joined with " +
          "`.join('')`, and run this check again.",
        'nested too deeply for the parser',
      );
    }
    throw new UnreadableSourceError(
      `Could not parse ${file} as TypeScript: ${(err as Error).message}\n` +
        'Fix the syntax error (run `npx vue-tsc --noEmit`) and run this check again.',
      'not parseable as TypeScript',
    );
  }
  return {
    ast: program as unknown as AstNode,
    comments: (program.comments ?? []) as unknown as Comment[],
    tokens: (program.tokens ?? []) as unknown as ParsedSource['tokens'],
  };
}

function isNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && typeof (value as AstNode).type === 'string';
}

/** Visits every node depth-first, handing each one its ancestors (outermost first). */
export function walk(node: AstNode, visit: (node: AstNode, ancestors: AstNode[]) => void): void {
  const stack: AstNode[] = [];
  const go = (current: AstNode): void => {
    visit(current, stack);
    stack.push(current);
    for (const [key, value] of Object.entries(current)) {
      if (key === 'parent') continue;
      if (Array.isArray(value)) value.filter(isNode).forEach(go);
      else if (isNode(value)) go(value);
    }
    stack.pop();
  };
  go(node);
}

/** The text of a string literal or an expression-free template literal, else undefined. */
function literalText(node: unknown): string | undefined {
  if (!isNode(node)) return undefined;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && (node.expressions as unknown[]).length === 0) {
    return ((node.quasis as Array<{ value: { cooked: string } }>)[0]?.value.cooked) ?? undefined;
  }
  return undefined;
}

/** A title for a test: a literal, or a template literal with its placeholders kept as `${}`. */
function titleText(node: unknown): string {
  const text = literalText(node);
  if (text !== undefined) return text;
  if (isNode(node) && node.type === 'TemplateLiteral') {
    return (node.quasis as Array<{ value: { cooked: string } }>).map((q) => q.value.cooked).join('${}');
  }
  return '';
}

/** The name of a callee: `foo` for `foo(...)`, `bar` for `x.y.bar(...)`. */
function calleeName(callee: AstNode): string | undefined {
  if (callee.type === 'Identifier') return callee.name as string;
  if (callee.type === 'MemberExpression' && !callee.computed && isNode(callee.property)) {
    return (callee.property as AstNode).name as string;
  }
  return undefined;
}

// -------------------------------------------------------------------------------------------
// Test blocks
// -------------------------------------------------------------------------------------------

export interface TestBlock {
  title: string;
  /** Line of the `it(`/`test(` call, the line vitest reports as the test's location. */
  line: number;
  endLine: number;
  /** Claim numbers cited by the title, the comment directly above, or any enclosing describe. */
  claims: number[];
  /** Skipped, todo, `fails` or conditional: it never counts as covering anything. */
  skipped: boolean;
}

const TEST_NAMES = new Set(['it', 'test', 'xit', 'xtest']);
const SUITE_NAMES = new Set(['describe', 'suite', 'xdescribe']);
const SKIPPED_NAMES = new Set(['xit', 'xtest', 'xdescribe']);
const SKIPPING_MODIFIERS = new Set(['skip', 'todo', 'fails', 'skipIf', 'runIf']);

/**
 * Classifies a call as a test or a suite. Walks `it.only.each(...)(...)` down to its root name,
 * collecting every modifier on the way, so a skip anywhere in the chain is seen.
 */
/** The root name of a call chain and every modifier on the way: `it.only.each(...)(...)`. */
function calleeChain(call: AstNode): { root: string | undefined; modifiers: string[] } {
  const modifiers: string[] = [];
  let callee = call.callee as AstNode;
  for (;;) {
    if (callee.type === 'CallExpression') callee = callee.callee as AstNode;
    else if (callee.type === 'MemberExpression' && !callee.computed) {
      modifiers.push((callee.property as AstNode).name as string);
      callee = callee.object as AstNode;
    } else break;
  }
  return { root: callee.type === 'Identifier' ? (callee.name as string) : undefined, modifiers };
}

/** Classifies a call as a test or a suite; a skip anywhere in the chain marks it skipped. */
function classifyCall(call: AstNode): { kind: 'test' | 'suite'; skipped: boolean } | undefined {
  const { root, modifiers } = calleeChain(call);
  if (root === undefined) return undefined;
  const kind = TEST_NAMES.has(root) ? 'test' : SUITE_NAMES.has(root) ? 'suite' : undefined;
  if (kind === undefined) return undefined;
  return { kind, skipped: SKIPPED_NAMES.has(root) || modifiers.some((m) => SKIPPING_MODIFIERS.has(m)) };
}

/** The text of the comments directly above `line`, contiguous, with no code between. */
function leadingCommentText(comments: Comment[], line: number): string {
  const parts: string[] = [];
  let cursor = line;
  for (let i = comments.length - 1; i >= 0; i--) {
    const c = comments[i];
    if (c.loc.end.line >= line) continue;
    if (c.loc.end.line !== cursor - 1) break;
    parts.unshift(c.value);
    cursor = c.loc.start.line;
  }
  return parts.join('\n');
}

interface RawBlock {
  kind: 'test' | 'suite';
  title: string;
  line: number;
  endLine: number;
  range: [number, number];
  skipped: boolean;
  citationText: string;
}

function collectBlocks(parsed: ParsedSource): RawBlock[] {
  const blocks: RawBlock[] = [];
  walk(parsed.ast, (node, ancestors) => {
    if (node.type !== 'CallExpression') return;
    // `it.each(table)(title, fn)` and `it.skipIf(cond)(title, fn)`: the inner call only builds
    // the test function, and the OUTER call is the test that carries the title.
    const parent = ancestors[ancestors.length - 1];
    if (parent?.type === 'CallExpression' && parent.callee === node) return;
    const info = classifyCall(node);
    if (!info) return;
    const args = node.arguments as AstNode[];
    const title = titleText(args[0]);
    const line = node.loc.start.line;
    blocks.push({
      kind: info.kind,
      title,
      line,
      endLine: node.loc.end.line,
      range: node.range,
      skipped: info.skipped,
      citationText: `${title}\n${leadingCommentText(parsed.comments, line)}`,
    });
  });
  return blocks;
}

function encloses(outer: RawBlock, inner: { range: [number, number] }): boolean {
  return outer.range[0] <= inner.range[0] && inner.range[1] <= outer.range[1] && outer !== inner;
}

/** Every test the file declares, with the claims it cites and whether it can count as coverage. */
export function findTestBlocks(source: string, file?: string): TestBlock[] {
  const blocks = collectBlocks(parseSource(source, file));
  const suites = blocks.filter((b) => b.kind === 'suite');
  return blocks
    .filter((b) => b.kind === 'test')
    .map((test) => {
      const enclosing = suites.filter((s) => encloses(s, test));
      const text = [test.citationText, ...enclosing.map((s) => s.citationText)].join('\n');
      return {
        title: test.title,
        line: test.line,
        endLine: test.endLine,
        claims: scanTestCitations(text).claims,
        skipped: test.skipped || enclosing.some((s) => s.skipped),
      };
    });
}

// -------------------------------------------------------------------------------------------
// Verbs
// -------------------------------------------------------------------------------------------

/**
 * Project wrappers: a function that passes one of its own parameters on as the verb's name (to a
 * verb factory, or to an engine entry point), keyed by function name to that parameter's index.
 * Games build both — `standingVerb('bidOnItem', ...)` around `worldAction(name)`, a test harness's
 * `world.run('bidOnItem', seat)` around the world engine's `applyCommand` — so a reader that knew
 * only the library's own names would miss every verb such a game has.
 */
type Wrappers = ReadonlyMap<string, number>;

/** A file's project-relative path and text. */
export interface SourceFile {
  path: string;
  text: string;
}

/** Given the wrappers known so far, the expression a call passes as a verb name, if any. */
type VerbArgument = (call: AstNode, wrappers: Wrappers) => AstNode | undefined;

const argAt = (call: AstNode, index: number) => (call.arguments as AstNode[])[index];

/** The value of an object literal's `name` property: `{ name: command, args }`. */
function nameProperty(node: AstNode | undefined, key = 'name'): AstNode | undefined {
  if (!isNode(node) || node.type !== 'ObjectExpression') return undefined;
  const property = (node.properties as AstNode[]).find(
    (p) => p.type === 'Property' && isNode(p.key) && (p.key as AstNode).name === key,
  );
  return property?.value as AstNode | undefined;
}

/**
 * The `actionName` of an `action` op, `{ type: 'action', actionName, ... }`, as
 * a test sends it to the live session host (`session.send(seat, op)`), or
 * undefined for any other op.
 */
function actionOpName(node: AstNode | undefined): AstNode | undefined {
  return literalText(nameProperty(node, 'type')) === 'action' ? nameProperty(node, 'actionName') : undefined;
}

const isFunction = (n: unknown): n is AstNode => isNode(n) && FUNCTION_TYPES.has(n.type);

/** An identifier's name, or undefined for any other node. */
const identifierName = (n: unknown): string | undefined =>
  isNode(n) && n.type === 'Identifier' ? (n.name as string) : undefined;

/** The name a node gives the function it declares or binds, with that function. */
const NAMED_FUNCTION_READERS: Readonly<Record<string, (node: AstNode) => [unknown, unknown]>> = Object.freeze({
  FunctionDeclaration: (node) => [node.id, node],
  VariableDeclarator: (node) => [node.id, node.init],
  Property: (node) => [node.key, node.value],
  MethodDefinition: (node) => [node.key, node.value],
});

/** A function-like node with a name: declaration, `const f = () => {}`, or a method. */
function namedFunction(node: AstNode): { name: string; fn: AstNode } | undefined {
  const reader = NAMED_FUNCTION_READERS[node.type];
  if (!reader) return undefined;
  const [id, fn] = reader(node);
  const name = identifierName(id);
  return name !== undefined && isFunction(fn) ? { name, fn } : undefined;
}

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

function paramNames(fn: AstNode): Array<string | undefined> {
  return (fn.params as AstNode[]).map((p) => {
    if (p.type === 'Identifier') return p.name as string;
    if (p.type === 'AssignmentPattern' && (p.left as AstNode).type === 'Identifier') return (p.left as AstNode).name as string;
    return undefined;
  });
}

/** Whether `text` mentions any of `names`: a file that names none of them cannot involve one. */
export function mentionsAny(text: string, names: Iterable<string>): boolean {
  for (const name of names) if (text.includes(name)) return true;
  return false;
}

/**
 * Finds wrappers to a fixed point, so a wrapper around a wrapper is found too. Only files that
 * mention a name already known (`seedNames` or a wrapper found so far) are parsed at all, which
 * also keeps a huge data file that names nothing from ever reaching the parser.
 */
function findWrappers(
  sources: readonly SourceFile[],
  verbArgument: VerbArgument,
  seedNames: readonly string[],
): Map<string, number> {
  const parsed = new Map<SourceFile, ParsedSource>();
  const wrappers = new Map<string, number>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const file of sources) {
      if (!mentionsAny(file.text, [...seedNames, ...wrappers.keys()])) continue;
      if (!parsed.has(file)) parsed.set(file, parseSource(file.text, file.path));
      walk(parsed.get(file)!.ast, (node) => {
        const named = namedFunction(node);
        if (!named || wrappers.has(named.name)) return;
        const params = paramNames(named.fn);
        walk(named.fn.body as AstNode, (inner) => {
          if (inner.type !== 'CallExpression' || wrappers.has(named.name)) return;
          const arg = verbArgument(inner, wrappers);
          if (arg?.type !== 'Identifier') return;
          const index = params.indexOf(arg.name as string);
          if (index === -1) return;
          wrappers.set(named.name, index);
          changed = true;
        });
      });
    }
  }
  return wrappers;
}

/** `Action.create`, the classic engine's verb factory. */
function isActionCreate(callee: AstNode): boolean {
  return (
    callee.type === 'MemberExpression' &&
    calleeName(callee) === 'create' &&
    identifierName(callee.object) === 'Action'
  );
}

/** The verb factories: `Action.create(name)`, `worldAction(name)`, and their wrappers. */
const verbFactoryArgument: VerbArgument = (call, wrappers) => {
  const callee = call.callee as AstNode;
  if (isActionCreate(callee) || identifierName(callee) === 'worldAction') return argAt(call, 0);
  const name = identifierName(callee);
  return name !== undefined && wrappers.has(name) ? argAt(call, wrappers.get(name)!) : undefined;
};

/** The names a file must mention to define a verb itself. */
export const VERB_FACTORY_NAMES = Object.freeze(['Action.create', 'worldAction']);

/** Every project function that defines a verb named by one of its parameters. */
export function findVerbWrappers(sources: readonly SourceFile[]): Map<string, number> {
  return findWrappers(sources, verbFactoryArgument, VERB_FACTORY_NAMES);
}

/** Every verb name the file defines (only on `onLines`, when given), in source order. */
export function findDefinedVerbs(
  source: string,
  file?: string,
  wrappers: Wrappers = new Map(),
  onLines?: ReadonlySet<number>,
): string[] {
  const verbs: string[] = [];
  walk(parseSource(source, file).ast, (node) => {
    if (node.type !== 'CallExpression') return;
    if (onLines && !onLines.has(node.loc.start.line)) return;
    const name = literalText(verbFactoryArgument(node, wrappers));
    if (name !== undefined && !verbs.includes(name)) verbs.push(name);
  });
  return verbs;
}

/**
 * The engine entry points a test can dispatch a verb through, and which argument carries the
 * verb's name. `assertActionFails` is deliberately absent: a verb only ever seen failing has not
 * been shown to work. `action(...)` counts only when the builder is `execute()`d, the world
 * engine's `applyCommand(player, { name, args })` carries the name inside its command object, and
 * the live session host's `send(seat, { type: 'action', actionName, ... })` inside its op.
 */
const DISPATCH_ENTRY_POINTS: Readonly<Record<string, number>> = Object.freeze({
  doAction: 1,
  tryAction: 1,
  take: 1,
  performAction: 0,
});

/** Names every way a verb counts as dispatched, for error messages. */
export const DISPATCH_FORMS =
  "testGame.doAction(seat, 'verb'), testGame.tryAction(seat, 'verb'), " +
  "testGame.action('verb', seat)...execute(), runner.performAction('verb', seat), " +
  "session.send(seat, { type: 'action', actionName: 'verb', ... }) on the live session host, " +
  "world.take(seat, 'verb'), or a helper of the project's own " +
  'under tests/ that passes the verb name it is given to one of these (or to the world engine\'s applyCommand)';

const dispatchArgument: VerbArgument = (call, wrappers) => {
  const name = calleeName(call.callee as AstNode);
  if (name === undefined) return undefined;
  if (name in DISPATCH_ENTRY_POINTS) return argAt(call, DISPATCH_ENTRY_POINTS[name]);
  if (name === 'applyCommand') return nameProperty(argAt(call, 1));
  if (name === 'send') return actionOpName(argAt(call, 1));
  return wrappers.has(name) ? argAt(call, wrappers.get(name)!) : undefined;
};

/** Every project function (a test harness, usually) that dispatches a verb named by a parameter. */
export function findDispatchWrappers(sources: readonly SourceFile[]): Map<string, number> {
  return findWrappers(sources, dispatchArgument, [...Object.keys(DISPATCH_ENTRY_POINTS), 'applyCommand', 'send']);
}

/** The verb of `x.action('verb', seat).select(...).execute()`, found by walking back the chain. */
function executedBuilderVerb(executeCallee: AstNode): string | undefined {
  let link = executeCallee.object as AstNode;
  while (link.type === 'CallExpression') {
    const linkCallee = link.callee as AstNode;
    if (linkCallee.type !== 'MemberExpression') return undefined;
    if (calleeName(linkCallee) === 'action') return literalText(argAt(link, 0));
    link = linkCallee.object as AstNode;
  }
  return undefined;
}

/** The verbs one call dispatches through the engine. */
function callVerbs(call: AstNode, wrappers: Wrappers): Array<string | undefined> {
  const callee = call.callee as AstNode;
  const name = calleeName(callee);
  if (name === 'execute' && callee.type === 'MemberExpression') return [executedBuilderVerb(callee)];
  return [literalText(dispatchArgument(call, wrappers))];
}

/** Every verb the file dispatches through the engine, outside skipped tests, with its line, in source order. */
export function findDispatches(
  source: string,
  file?: string,
  wrappers: Wrappers = new Map(),
): Array<{ verb: string; line: number }> {
  const parsed = parseSource(source, file);
  const skippedRanges = collectBlocks(parsed)
    .filter((b) => b.skipped)
    .map((b) => b.range);
  const inSkipped = (node: AstNode) =>
    skippedRanges.some(([start, end]) => start <= node.range[0] && node.range[1] <= end);

  const dispatches: Array<{ verb: string; line: number }> = [];
  walk(parsed.ast, (node) => {
    if (node.type !== 'CallExpression' || inSkipped(node)) return;
    for (const verb of callVerbs(node, wrappers)) if (verb !== undefined) dispatches.push({ verb, line: node.loc.start.line });
  });
  return dispatches;
}

/** Every verb the file dispatches through the engine, outside skipped tests, in source order. */
export function findDispatchedVerbs(source: string, file?: string, wrappers: Wrappers = new Map()): string[] {
  return [...new Set(findDispatches(source, file, wrappers).map((d) => d.verb))];
}

// -------------------------------------------------------------------------------------------
// "Unreachable" guards
// -------------------------------------------------------------------------------------------

/**
 * Wording that claims a guard cannot be reached. A guard like that is either proven by the
 * compiler (an exhaustive `never` check, which needs no such wording) or it can be reached, and
 * then the person who reaches it gets a message that tells them nothing.
 */
const UNREACHABLE_WORDING =
  /\bunreachable\b|\bnot reachable\b|\bnever (?:be )?reached\b|\bshould(?: never|n't| not) (?:happen|occur)\b|\bcan(?:not|'t| never) happen\b|\bnever happens\b/i;

interface UnreachableGuard {
  line: number;
  text: string;
}

/** Comments and string literals on `addedLines` that call a guard unreachable. */
export function findUnreachableGuards(
  source: string,
  addedLines: ReadonlySet<number>,
  file?: string,
): UnreachableGuard[] {
  const parsed = parseSource(source, file);
  const hits = new Map<number, string>();
  const consider = (line: number, text: string) => {
    if (addedLines.has(line) && UNREACHABLE_WORDING.test(text) && !hits.has(line)) {
      hits.set(line, text.trim());
    }
  };
  for (const c of parsed.comments) consider(c.loc.start.line, c.value);
  walk(parsed.ast, (node) => {
    if (node.type === 'Literal' && typeof node.value === 'string') consider(node.loc.start.line, node.value);
    if (node.type === 'TemplateElement') {
      consider(node.loc.start.line, (node.value as { cooked: string }).cooked ?? '');
    }
  });
  return [...hits.entries()].sort(([a], [b]) => a - b).map(([line, text]) => ({ line, text }));
}
