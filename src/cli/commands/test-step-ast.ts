/**
 * `test-step-ast.ts` — the source readers `boardsmith test-step-check` is built on (#290).
 *
 * Each function takes a file's text and answers one question about it by parsing it, never by
 * matching lines: which tests a test file declares and which claims each one cites, which verbs a
 * rules file defines, which verbs a test file dispatches through the engine, and which lines call
 * a guard unreachable. Kept apart from the command so the mutation runner can share the parser.
 */
import { isBuiltin } from 'node:module';
import { posix } from 'node:path';
import { parse, parseForESLint } from '@typescript-eslint/parser';
import { scanTestCitations } from './trace-check.js';

/** The part of an ESTree node these readers look at. */
export interface AstNode {
  type: string;
  range: [number, number];
  loc: { start: { line: number }; end: { line: number } };
  [key: string]: unknown;
}

interface Comment {
  type: 'Line' | 'Block';
  value: string;
  loc: { start: { line: number }; end: { line: number } };
}

export interface ParsedSource {
  ast: AstNode;
  comments: Comment[];
  tokens: Array<{ type: string; value: string; range: [number, number] }>;
}

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

const PARSE_OPTIONS = Object.freeze({
  comment: true,
  tokens: true,
  loc: true,
  range: true,
  ecmaVersion: 'latest',
  sourceType: 'module',
} as const);

/** Runs a parse, turning a failure into an `UnreadableSourceError` that says what to do about `file`. */
function parseOrExplain<T>(run: () => T, file: string): T {
  try {
    return run();
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
        'Fix the syntax error (run `boardsmith typecheck`) and run this check again.',
      'not parseable as TypeScript',
    );
  }
}

/** Parses TypeScript with locations, comments and tokens. Throws a readable error naming `file`. */
export function parseSource(source: string, file = 'this file'): ParsedSource {
  const program = parseOrExplain(() => parse(source, PARSE_OPTIONS), file);
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

const argAt = (call: AstNode, index: number) => (call.arguments as AstNode[])[index];

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

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
  PropertyDefinition: (node) => [node.key, node.value],
});

/** A function-like node with a name: declaration, `const f = () => {}`, or a method. */
function namedFunction(node: AstNode): { name: string; fn: AstNode } | undefined {
  const reader = NAMED_FUNCTION_READERS[node.type];
  if (!reader) return undefined;
  const [id, fn] = reader(node);
  const name = identifierName(id);
  return name !== undefined && isFunction(fn) ? { name, fn } : undefined;
}

/** A file's project-relative path and text. */
export interface SourceFile {
  path: string;
  text: string;
}

type ScopeManager = ReturnType<typeof parseForESLint>['scopeManager'];
type Reference = ScopeManager['scopes'][number]['references'][number];
type Variable = NonNullable<Reference['resolved']>;

/** A file parsed with its scopes, which reading a value back from where it is used needs. */
interface ScopedSource extends ParsedSource {
  file: string;
  parents: Map<AstNode, AstNode>;
  /** Each identifier a file reads or writes, with the variable it names. */
  references: Map<unknown, Reference>;
}

function parseScoped(source: string, file = 'this file'): ScopedSource {
  const { ast, scopeManager } = parseOrExplain(() => parseForESLint(source, PARSE_OPTIONS), file);
  const program = ast as unknown as AstNode;
  const parents = new Map<AstNode, AstNode>();
  walk(program, (node, ancestors) => {
    const parent = ancestors[ancestors.length - 1];
    if (parent) parents.set(node, parent);
  });
  const references = new Map<unknown, Reference>();
  for (const scope of scopeManager.scopes) for (const reference of scope.references) references.set(reference.identifier, reference);
  return {
    ast: program,
    comments: ast.comments as unknown as Comment[],
    tokens: ast.tokens as unknown as ParsedSource['tokens'],
    file,
    parents,
    references,
  };
}

/** Any element of an array, as a step of a value path. */
const EACH = Symbol('each');
type PathStep = string | typeof EACH;

/** Bounds how deep a value is read, so a helper that recurses into its own parameter still ends. */
const MAX_PATH = 8;

const pathText = (path: readonly PathStep[]) =>
  path.map((step) => (step === EACH ? '[]' : /^[A-Za-z_$][\w$]*$/.test(step) ? `.${step}` : `[${JSON.stringify(step)}]`)).join('');

/** A named function's parameter a value is read from, at `path` inside it. */
interface ParameterValue {
  fn: AstNode;
  name: string;
  index: number;
  path: PathStep[];
}

/** What an expression may hold: the expressions it was last bound to, or a parameter of the function it is in. */
type Value = AstNode | ParameterValue;

type Read = (node: unknown, path: PathStep[]) => Value[];

/** The static key of a property or member: `a.name`, `a['name']`, `{ name: ... }`. */
function staticKey(key: unknown, computed: unknown): string | undefined {
  if (!isNode(key)) return undefined;
  if (key.type === 'Literal' && (typeof key.value === 'string' || typeof key.value === 'number')) return String(key.value);
  return computed ? undefined : identifierName(key);
}

const isObjectLiteral = (value: Value): value is AstNode => isNode(value) && value.type === 'ObjectExpression';

/** Whether an object literal may give `key` a value: it names it, or spreads something that may. */
const mayDefine = (object: AstNode, key: string) =>
  (object.properties as AstNode[]).some((p) => p.type === 'SpreadElement' || staticKey(p.key, p.computed) === key);

/**
 * What an object literal gives `key`, read at `rest`: the last property naming it, or what a
 * spread of object literals after that property gives it. A spread this check cannot read is
 * taken not to name the key, as `{ command, ...answered }` handed to the runner does not.
 */
function propertyValues(object: AstNode, key: string, rest: PathStep[], read: Read): Value[] {
  const found: Value[] = [];
  for (const property of [...(object.properties as AstNode[])].reverse()) {
    if (property.type === 'Property') {
      if (property.kind === 'init' && staticKey(property.key, property.computed) === key) return [...found, ...read(property.value, rest)];
      continue;
    }
    const spread = read(property.argument, []).filter(isObjectLiteral);
    const defining = spread.filter((source) => mayDefine(source, key));
    found.push(...defining.flatMap((source) => read(source, [key, ...rest])));
    if (spread.length > 0 && defining.length === spread.length) return found;
  }
  return found;
}

/** The element at `index` of an array literal, unless a spread before it moves it. */
function elementAt(array: AstNode, index: string): AstNode | undefined {
  const elements = (array.elements as Array<AstNode | null>).slice(0, Number(index) + 1);
  return /^\d+$/.test(index) && !elements.some((e) => e?.type === 'SpreadElement') ? (elements[Number(index)] ?? undefined) : undefined;
}

/** The truth of a condition that is a literal, or undefined when the condition can go either way. */
const constantTruth = (test: AstNode): boolean | undefined => (test.type === 'Literal' ? Boolean(test.value) : undefined);

const ARRAY_BUILDERS = new Set(['map', 'flatMap']);
const ITERATORS = new Set([...ARRAY_BUILDERS, 'forEach']);

const memberMethod = (call: AstNode): string | undefined =>
  (call.callee as AstNode).type === 'MemberExpression' ? calleeName(call.callee as AstNode) : undefined;

/** The expressions a function returns: an arrow's body, or each `return` not inside a nested function. */
function returnedExpressions(fn: AstNode): AstNode[] {
  const body = fn.body as AstNode;
  if (body.type !== 'BlockStatement') return [body];
  const returned: AstNode[] = [];
  walk(body, (node, ancestors) => {
    if (node.type === 'ReturnStatement' && isNode(node.argument) && !ancestors.some(isFunction)) returned.push(node.argument);
  });
  return returned;
}

/** The elements of `list.map(fn)` or `list.flatMap(fn)`, read at the rest of `path`. */
function builtElements(call: AstNode, path: PathStep[], read: Read): Value[] {
  const method = memberMethod(call);
  const fn = argAt(call, 0);
  if (method === undefined || !ARRAY_BUILDERS.has(method) || !isFunction(fn)) return [];
  const rest = path.slice(1);
  if (method === 'map') return returnedExpressions(fn).flatMap((returned) => read(returned, rest));
  const producesArray = (v: Value) => isNode(v) && (v.type === 'ArrayExpression' || (v.type === 'CallExpression' && ARRAY_BUILDERS.has(memberMethod(v) ?? '')));
  return returnedExpressions(fn).flatMap((returned) => read(returned, []).flatMap((v) => (producesArray(v) ? read(v, path) : reread(v, rest, read))));
}

/** Reads a value already found at `[]` again at `path`. */
const reread = (value: Value, path: PathStep[], read: Read): Value[] => (path.length === 0 ? [value] : isNode(value) ? read(value, path) : []);

const unwrapped = (node: AstNode, path: PathStep[], read: Read) => read(node.expression, path);

/** How each kind of expression is read at a path; any other kind holds only itself. */
const VALUE_READERS: Readonly<Record<string, (node: AstNode, path: PathStep[], read: Read) => Value[]>> = Object.freeze({
  TSAsExpression: unwrapped,
  TSSatisfiesExpression: unwrapped,
  TSNonNullExpression: unwrapped,
  TSTypeAssertion: unwrapped,
  ChainExpression: unwrapped,
  ConditionalExpression: (node, path, read) => {
    const truth = constantTruth(node.test as AstNode);
    if (truth !== undefined) return read(truth ? node.consequent : node.alternate, path);
    return [...read(node.consequent, path), ...read(node.alternate, path)];
  },
  MemberExpression: (node, path, read) => {
    const key = staticKey(node.property, node.computed);
    return key === undefined ? [] : read(node.object, [key, ...path]);
  },
  ObjectExpression: (node, [first, ...rest], read) => {
    if (first === undefined) return [node];
    return typeof first === 'string' ? propertyValues(node, first, rest, read) : [];
  },
  ArrayExpression: (node, path, read) => {
    if (path.length === 0) return [node];
    if (path[0] !== EACH) return read(elementAt(node, path[0]), path.slice(1));
    return (node.elements as Array<AstNode | null>).flatMap((element) =>
      element?.type === 'SpreadElement' ? read(element.argument, path) : read(element, path.slice(1)),
    );
  },
  CallExpression: (node, path, read) => (path.length === 0 ? [node] : path[0] === EACH ? builtElements(node, path, read) : []),
});

/** How each kind of binding pattern reaches the identifier it binds, as a path. */
const PATTERN_READERS: Readonly<Record<string, (pattern: AstNode, id: unknown) => PathStep[] | undefined>> = Object.freeze({
  AssignmentPattern: (pattern, id) => patternPath(pattern.left, id),
  ArrayPattern: (pattern, id) => {
    const elements = pattern.elements as unknown[];
    const index = elements.findIndex((element) => patternPath(element, id) !== undefined);
    return index === -1 ? undefined : [String(index), ...patternPath(elements[index], id)!];
  },
  ObjectPattern: (pattern, id) => {
    for (const property of pattern.properties as AstNode[]) {
      const inner = property.type === 'Property' ? patternPath(property.value, id) : undefined;
      if (inner === undefined) continue;
      const key = staticKey(property.key, property.computed);
      return key === undefined ? undefined : [key, ...inner];
    }
    return undefined;
  },
});

/** The path from a binding pattern to the identifier it binds, or undefined when the pattern reads it some other way. */
function patternPath(pattern: unknown, id: unknown): PathStep[] | undefined {
  if (pattern === id) return [];
  const reader = isNode(pattern) ? PATTERN_READERS[pattern.type] : undefined;
  return reader?.(pattern as AstNode, id);
}

const MUTATORS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']);

/** `Object.assign(id, ...)`. */
function assignsInto(id: AstNode, parent: AstNode | undefined): boolean {
  if (parent?.type !== 'CallExpression' || argAt(parent, 0) !== id) return false;
  const callee = parent.callee as AstNode;
  return callee.type === 'MemberExpression' && identifierName(callee.object) === 'Object' && calleeName(callee) === 'assign';
}

/** `id.pop()`, `id.push(...)` and the other array methods that change the array they are called on. */
function callsMutator(source: ScopedSource, parent: AstNode | undefined): boolean {
  if (parent?.type !== 'MemberExpression') return false;
  const call = source.parents.get(parent);
  return call?.type === 'CallExpression' && call.callee === parent && MUTATORS.has(calleeName(parent) ?? '');
}

/** The outermost member expression rooted at `id` (`id.a.b`), and what holds it. */
function outermostMember(source: ScopedSource, id: AstNode): { node: AstNode; parent: AstNode | undefined } {
  let node = id;
  let parent = source.parents.get(node);
  while (parent?.type === 'MemberExpression' && parent.object === node) {
    node = parent;
    parent = source.parents.get(node);
  }
  return { node, parent };
}

/** Whether `node` is the target of an assignment, an update or a delete. */
const isWrittenTo = (node: AstNode, parent: AstNode | undefined) =>
  (parent?.type === 'AssignmentExpression' && parent.left === node) ||
  parent?.type === 'UpdateExpression' ||
  (parent?.type === 'UnaryExpression' && parent.operator === 'delete');

/** Whether `id` is changed in place: a member of it assigned, updated or deleted (`order.kind = ...`), or a call that changes it. */
function changesMember(source: ScopedSource, id: AstNode): boolean {
  const parent = source.parents.get(id);
  if (assignsInto(id, parent) || callsMutator(source, parent)) return true;
  if (parent?.type !== 'MemberExpression') return false;
  const member = outermostMember(source, id);
  return isWrittenTo(member.node, member.parent);
}

const isChanged = (source: ScopedSource, variable: Variable) =>
  variable.references.some((r) => (r.isWrite() && !r.init) || changesMember(source, r.identifier as unknown as AstNode));

/** The table of `it.each(table)(title, fn)`, `test.each` or `describe.each`, when `call` is one. */
function eachTable(call: AstNode): AstNode | undefined {
  const inner = call.callee as AstNode;
  if (inner.type !== 'CallExpression' || (inner.callee as AstNode).type !== 'MemberExpression') return undefined;
  if (calleeName(inner.callee as AstNode) !== 'each') return undefined;
  const { root } = calleeChain(inner);
  return root !== undefined && (TEST_NAMES.has(root) || SUITE_NAMES.has(root)) ? argAt(inner, 0) : undefined;
}

/** A callback's parameter: a table test's row, or an element of the list `map`, `flatMap` or `forEach` runs over. */
function callbackValues(call: AstNode, fn: AstNode, index: number, path: PathStep[], read: Read): Value[] {
  const table = eachTable(call);
  if (table !== undefined) {
    return read(table, [EACH]).flatMap((row) => {
      if (isNode(row) && row.type === 'ArrayExpression') return read(row, [String(index), ...path]);
      return index === 0 ? reread(row, path, read) : [];
    });
  }
  const method = memberMethod(call);
  if (method === undefined || !ITERATORS.has(method) || argAt(call, 0) !== fn || index !== 0) return [];
  return read((call.callee as AstNode).object, [EACH, ...path]);
}

/** The name a function is declared or bound by, if any. */
function functionName(source: ScopedSource, fn: AstNode): string | undefined {
  for (const node of [fn, source.parents.get(fn)]) {
    const named = node && namedFunction(node);
    if (named?.fn === fn) return named.name;
  }
  return undefined;
}

/**
 * A parameter's values: a callback's from what it is called with, unless the callback changes it;
 * a named function's as one of its slots, which a change inside it (`name = name.trim()`) keeps.
 */
function parameterValues(source: ScopedSource, fn: AstNode, id: unknown, path: PathStep[], read: Read, changed: boolean): Value[] {
  // A TypeScript `this` parameter is never passed at a call.
  const params = (fn.params as AstNode[]).filter((param) => identifierName(param) !== 'this');
  const index = params.findIndex((param) => patternPath(param, id) !== undefined);
  if (index === -1) return [];
  const inner = [...patternPath(params[index], id)!, ...path];
  const call = source.parents.get(fn);
  if (call?.type === 'CallExpression' && (call.arguments as AstNode[]).includes(fn)) {
    return changed ? [] : callbackValues(call, fn, index, inner, read);
  }
  const name = functionName(source, fn);
  return name === undefined ? [] : [{ fn, name, index, path: inner }];
}

function variableValues(source: ScopedSource, declarator: AstNode, id: unknown, path: PathStep[], read: Read): Value[] {
  const inner = patternPath(declarator.id, id);
  if (inner === undefined) return [];
  const declaration = source.parents.get(declarator);
  const loop = declaration && source.parents.get(declaration);
  if (loop?.type === 'ForOfStatement' && loop.left === declaration) return read(loop.right, [EACH, ...inner, ...path]);
  return read(declarator.init, [...inner, ...path]);
}

/** The one variable an identifier names, unless it is declared twice or changed after it is bound. */
function stableVariable(source: ScopedSource, id: AstNode): Variable | undefined {
  const variable = source.references.get(id)?.resolved;
  return variable && variable.defs.length === 1 && !isChanged(source, variable) ? variable : undefined;
}

function identifierValues(source: ScopedSource, id: AstNode, path: PathStep[], read: Read): Value[] {
  const variable = source.references.get(id)?.resolved;
  const def = variable?.defs.length === 1 ? variable.defs[0] : undefined;
  if (def === undefined) return [];
  const changed = isChanged(source, variable!);
  if (def.type === 'Variable' && !changed) return variableValues(source, def.node as unknown as AstNode, def.name, path, read);
  if (def.type === 'Parameter') return parameterValues(source, def.node as unknown as AstNode, def.name, path, read, changed);
  return [];
}

/**
 * What `node` may hold at `path`, read back through the bindings around it: a local's value, a
 * destructured or `for...of` binding, a table test's row, a callback's element, an object
 * literal's field, either branch of a conditional. A value shadowing, a change or anything else
 * makes uncertain is left out, so a verb it would name is not counted.
 */
function valuesOf(source: ScopedSource, start: unknown, startPath: PathStep[]): Value[] {
  const reading = new Map<AstNode, Set<string>>();
  const read: Read = (node, path) => {
    if (!isNode(node) || path.length > MAX_PATH) return [];
    const key = pathText(path);
    const active = reading.get(node) ?? new Set<string>();
    if (active.has(key)) return [];
    reading.set(node, active.add(key));
    try {
      if (node.type === 'Identifier') return identifierValues(source, node, path, read);
      const reader = VALUE_READERS[node.type];
      return reader ? reader(node, path, read) : path.length === 0 ? [node] : [];
    } finally {
      active.delete(key);
    }
  };
  return read(start, startPath);
}

/** Where a helper takes the verb's name: one of its parameters, at a path inside it. */
interface Slot {
  index: number;
  path: PathStep[];
}

/** Slots keyed by their text, `0`, `1.name` or `0[].kind`. */
type Slots = ReadonlyMap<string, Slot>;

const slotText = (slot: Slot) => `${slot.index}${pathText(slot.path)}`;

/**
 * A project's own helpers that pass a verb's name on, from one of their parameters, to a verb
 * factory or an engine entry point: `standingVerb('bidOnItem', ...)` around `worldAction(name)`, a
 * harness's `world.run('bidOnItem', seat)` around `applyCommand`, `apply({ name, args })` around
 * the world runner, `startOrCancel({ kind, ...fields })` around `apply`. A reader that knew only
 * the library's own names would miss every verb such a game has.
 */
export interface DispatchWrappers {
  /** Every slot of every function by each bare name: what a member call reaches, or a call to an import `exported` cannot follow. */
  byName: ReadonlyMap<string, Slots>;
  /** One function's own slots, by `<file>:<offset>`: what a call to a function its own file declares reaches. */
  byFunction: ReadonlyMap<string, Slots>;
  /** The files `byFunction` was read from; a call to a function an unread file declares falls back to `byName`. */
  files: ReadonlySet<string>;
  /**
   * The slots of the function a file read exports by a name, followed through its re-exports:
   * what a call to an import reaches. Undefined when the export is not a function this can read.
   */
  exported: (file: string, name: string) => Slots | undefined;
}

const NO_SLOTS: Slots = new Map();

/** A project with no dispatch helpers of its own. */
export const NO_DISPATCH_WRAPPERS: DispatchWrappers = Object.freeze({
  byName: new Map(),
  byFunction: new Map(),
  files: new Set<string>(),
  exported: () => undefined,
});

/** The project script a module path names, trying TypeScript's extension rules. */
export function resolveScript(path: string, exists: (path: string) => boolean): string | undefined {
  const stem = path.replace(/\.(m|c)?js$/, '');
  const candidates = [
    path,
    ...['.ts', '.mts', '.cts', '.js', '.mjs'].map((ext) => `${stem}${ext}`),
    ...['/index.ts', '/index.js'].map((index) => `${path}${index}`),
  ];
  return candidates.find(exists);
}

/** A name a module takes from another: the module it is written as coming from, and its name there. */
interface Import {
  specifier: string;
  name: string;
}

/** A name a module passes on: the file read it comes from (none for a package or a file not read), and its name there. */
interface Passed {
  from: string | undefined;
  name: string;
}

/** What a module exports by a name: a function it declares, or a name it passes on from another module. */
type Export = { fn: AstNode } | Passed;

/** A module's exports by name, and the modules whose every export it passes on (`export * from`). */
interface ModuleExports {
  named: Map<string, Export>;
  star: Array<string | undefined>;
}

/** The name an import or export specifier gives, written as an identifier or a string. */
const moduleName = (node: unknown): string => identifierName(node) ?? literalText(node) ?? '';

const isRelative = (specifier: string) => ['.', '..'].includes(specifier) || /^\.\.?\//.test(specifier);

/** The file read a module specifier names, for a relative one. */
function resolveImport(file: string, specifier: unknown, files: ReadonlySet<string>): string | undefined {
  if (typeof specifier !== 'string' || !isRelative(specifier)) return undefined;
  return resolveScript(posix.join(posix.dirname(file), specifier).replace(/\/$/, ''), (path) => files.has(path));
}

const IMPORTED_NAMES: Readonly<Record<string, (specifier: AstNode) => string>> = Object.freeze({
  ImportSpecifier: (specifier) => moduleName(specifier.imported),
  ImportDefaultSpecifier: () => 'default',
});

/** The module and name an identifier was imported by, when an `import` statement names one export. */
function importOf(source: ScopedSource, id: AstNode): Import | undefined {
  const def = source.references.get(id)?.resolved?.defs[0];
  const declaration = def?.parent as unknown as AstNode | undefined;
  if (def?.type !== 'ImportBinding' || declaration?.type !== 'ImportDeclaration') return undefined;
  const specifier = def.node as unknown as AstNode;
  const name = IMPORTED_NAMES[specifier.type]?.(specifier);
  return name === undefined ? undefined : { specifier: (declaration.source as AstNode).value as string, name };
}

/** What a module's own binding exports: a function the module declares, or a name it imported. */
function bindingExport(source: ScopedSource, id: unknown, files: ReadonlySet<string>): Export | undefined {
  if (!isNode(id) || id.type !== 'Identifier') return undefined;
  const fn = localFunction(source, id);
  if (fn) return { fn };
  const imported = importOf(source, id);
  return imported && { from: resolveImport(source.file, imported.specifier, files), name: imported.name };
}

type ExportReader = (node: AstNode, module: ModuleExports, source: ScopedSource, files: ReadonlySet<string>) => void;

const exportedFrom = (node: AstNode, source: ScopedSource, files: ReadonlySet<string>) =>
  resolveImport(source.file, (node.source as AstNode | null)?.value, files);

/** The functions an `export const` or `export function` declares. */
function declaredFunctions(declaration: AstNode | null): Array<{ name: string; fn: AstNode }> {
  if (declaration === null) return [];
  const declarators = declaration.type === 'VariableDeclaration' ? (declaration.declarations as AstNode[]) : [declaration];
  return declarators.flatMap((node) => namedFunction(node) ?? []);
}

const EXPORT_READERS: Readonly<Record<string, ExportReader>> = Object.freeze({
  ExportAllDeclaration: (node, module, source, files) => {
    if (node.exported === null) module.star.push(exportedFrom(node, source, files));
  },
  ExportDefaultDeclaration: (node, module, source, files) => {
    const declared = isFunction(node.declaration) ? { fn: node.declaration } : bindingExport(source, node.declaration, files);
    if (declared) module.named.set('default', declared);
  },
  ExportNamedDeclaration: (node, module, source, files) => {
    for (const { name, fn } of declaredFunctions(node.declaration as AstNode | null)) module.named.set(name, { fn });
    for (const specifier of node.specifiers as AstNode[]) {
      const local = specifier.local as AstNode;
      const target = node.source ? { from: exportedFrom(node, source, files), name: moduleName(local) } : bindingExport(source, local, files);
      if (target) module.named.set(moduleName(specifier.exported), target);
    }
  },
});

function moduleExports(source: ScopedSource, files: ReadonlySet<string>): ModuleExports {
  const module: ModuleExports = { named: new Map(), star: [] };
  for (const node of source.ast.body as AstNode[]) EXPORT_READERS[node.type]?.(node, module, source, files);
  return module;
}

const functionKey = (file: string, fn: AstNode) => `${file}:${fn.range[0]}`;

/** The function an identifier names when its own file declares it as one. */
function localFunction(source: ScopedSource, id: AstNode): AstNode | undefined {
  const def = stableVariable(source, id)?.defs[0];
  if (def?.type === 'FunctionName') return def.node as unknown as AstNode;
  const declarator = def?.type === 'Variable' ? (def.node as unknown as AstNode) : undefined;
  return declarator && declarator.id === def?.name && isFunction(declarator.init) ? declarator.init : undefined;
}

/** Where an expression of a call carries a verb's name: the expression, and the path inside it. */
interface Carrier {
  node: unknown;
  path: PathStep[];
}

type Carriers = (source: ScopedSource, call: AstNode, wrappers: DispatchWrappers) => Carrier[];

/** The slots an import reaches: none from Node's own modules, the function's own from a file read, else unknown. */
function importedSlots(file: string, imported: Import, wrappers: DispatchWrappers): Slots | undefined {
  if (isBuiltin(imported.specifier)) return NO_SLOTS;
  const from = resolveImport(file, imported.specifier, wrappers.files);
  return from === undefined ? undefined : wrappers.exported(from, imported.name);
}

/** The slots of the function a callee names when its own (read) file declares it. */
function localSlots(source: ScopedSource, callee: AstNode, wrappers: DispatchWrappers): Slots | undefined {
  const local = callee.type === 'Identifier' && wrappers.files.has(source.file) ? localFunction(source, callee) : undefined;
  return local && (wrappers.byFunction.get(functionKey(source.file, local)) ?? NO_SLOTS);
}

/** Every slot of every helper by the callee's bare name (an import's own name, not its alias). */
function namedSlots(callee: AstNode, imported: Import | undefined, wrappers: DispatchWrappers): Slot[] {
  const name = (imported?.name === 'default' ? undefined : imported?.name) ?? calleeName(callee) ?? '';
  const slots = [...(wrappers.byName.get(name) ?? NO_SLOTS).values()];
  // `runner.apply(...)` and `fn.apply(...)` are the runner's and Function's, not a command helper named apply.
  const isEntryPoint = callee.type === 'MemberExpression' && ENTRY_POINT_NAMES.includes(name);
  return isEntryPoint ? slots.filter((slot) => slot.path.length === 0) : slots;
}

/**
 * The slots a callee reaches: an import's, read from the file it comes from; a function its own
 * (read) file declares; else every helper by its bare name.
 */
function calleeSlots(source: ScopedSource, callee: AstNode, wrappers: DispatchWrappers): Slot[] {
  const imported = callee.type === 'Identifier' ? importOf(source, callee) : undefined;
  const bound = imported ? importedSlots(source.file, imported, wrappers) : localSlots(source, callee, wrappers);
  return bound ? [...bound.values()] : namedSlots(callee, imported, wrappers);
}

/** The arguments a call hands a project helper's slots. */
const helperCarriers = (source: ScopedSource, call: AstNode, wrappers: DispatchWrappers): Carrier[] =>
  calleeSlots(source, call.callee as AstNode, wrappers).map((slot) => ({ node: argAt(call, slot.index), path: slot.path }));

const carriedValues = (source: ScopedSource, call: AstNode, carriers: Carriers, wrappers: DispatchWrappers): Value[] =>
  carriers(source, call, wrappers).flatMap((carrier) => valuesOf(source, carrier.node, carrier.path));

/** Whether `text` mentions any of `names`: a file that names none of them cannot involve one. */
export function mentionsAny(text: string, names: Iterable<string>): boolean {
  for (const name of names) if (text.includes(name)) return true;
  return false;
}

/**
 * Finds helpers to a fixed point, so a helper around a helper is found too. Only files that
 * mention a name already known (`seedNames` or a helper found so far) are parsed at all, which
 * also keeps a huge data file that names nothing from ever reaching the parser. A name keeps every
 * slot any function by that name has, since a game's test files declare many local `run` helpers.
 */
function findWrappers(sources: readonly SourceFile[], carriers: Carriers, seedNames: readonly string[]): DispatchWrappers {
  const texts = new Map(sources.map((file) => [file.path, file.text]));
  const parsed = new Map<string, ScopedSource>();
  const scoped = (path: string): ScopedSource => {
    const source = parsed.get(path) ?? parseScoped(texts.get(path)!, path);
    parsed.set(path, source);
    return source;
  };
  const modules = new Map<string, ModuleExports>();
  const exportsOf = (path: string): ModuleExports => {
    const module = modules.get(path) ?? moduleExports(scoped(path), wrappers.files);
    modules.set(path, module);
    return module;
  };
  const exported = (file: string, name: string, seen = new Set<string>()): Slots | undefined => {
    const key = `${file}:${name}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const module = exportsOf(file);
    const target = module.named.get(name);
    if (target && 'fn' in target) return wrappers.byFunction.get(functionKey(file, target.fn)) ?? NO_SLOTS;
    // `export *` never passes on a default export.
    const passed = target ? [target] : name === 'default' ? [] : module.star.map((from) => ({ from, name }));
    const found = passed.flatMap((next) => (next.from === undefined ? [] : [exported(next.from, next.name, seen)]));
    const read = found.filter((slots) => slots !== undefined);
    return read.length === 0 ? undefined : new Map(read.flatMap((slots) => [...slots]));
  };
  const wrappers = {
    byName: new Map<string, Map<string, Slot>>(),
    byFunction: new Map<string, Map<string, Slot>>(),
    files: new Set(texts.keys()),
    exported: (file: string, name: string) => exported(file, name),
  };
  const add = (map: Map<string, Map<string, Slot>>, key: string, slot: Slot): boolean => {
    const slots = map.get(key) ?? new Map<string, Slot>();
    if (slots.has(slotText(slot))) return false;
    map.set(key, slots.set(slotText(slot), slot));
    return true;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const file of sources) {
      if (!mentionsAny(file.text, [...seedNames, ...wrappers.byName.keys()])) continue;
      const source = scoped(file.path);
      walk(source.ast, (node) => {
        if (node.type !== 'CallExpression') return;
        for (const value of carriedValues(source, node, carriers, wrappers)) {
          if (isNode(value)) continue;
          const slot = { index: value.index, path: value.path };
          const named = add(wrappers.byName, value.name, slot);
          if (add(wrappers.byFunction, functionKey(source.file, value.fn), slot) || named) changed = true;
        }
      });
    }
  }
  return wrappers;
}

/** `Action.create`, the classic engine's verb factory, or `worldAction`, the world engine's. */
function isVerbFactory(callee: AstNode): boolean {
  if (identifierName(callee) === 'worldAction') return true;
  return callee.type === 'MemberExpression' && calleeName(callee) === 'create' && identifierName(callee.object) === 'Action';
}

const verbFactoryCarriers: Carriers = (source, call, wrappers) =>
  isVerbFactory(call.callee as AstNode) ? [{ node: argAt(call, 0), path: [] }] : helperCarriers(source, call, wrappers);

/** The names a file must mention to define a verb itself. */
export const VERB_FACTORY_NAMES = Object.freeze(['Action.create', 'worldAction']);

/** A project's verb factory wrappers, by name, to the index of the parameter that names the verb. */
export type Wrappers = ReadonlyMap<string, ReadonlySet<number>>;

/** Every project function that defines a verb named by one of its parameters. */
export function findVerbWrappers(sources: readonly SourceFile[]): Map<string, Set<number>> {
  const wrappers = new Map<string, Set<number>>();
  for (const [name, slots] of findWrappers(sources, verbFactoryCarriers, VERB_FACTORY_NAMES).byName) {
    const indexes = [...slots.values()].filter((slot) => slot.path.length === 0).map((slot) => slot.index);
    if (indexes.length > 0) wrappers.set(name, new Set(indexes));
  }
  return wrappers;
}

/** The arguments of a call that name the verb it defines: a factory's first, or a wrapper's. */
const factoryIndexes = (callee: AstNode, wrappers: Wrappers): Iterable<number> =>
  isVerbFactory(callee) ? [0] : (wrappers.get(identifierName(callee) ?? '') ?? []);

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
    for (const index of factoryIndexes(node.callee as AstNode, wrappers)) {
      const name = literalText(argAt(node, index));
      if (name !== undefined && !verbs.includes(name)) verbs.push(name);
    }
  });
  return verbs;
}

/**
 * The engine entry points a test can dispatch a verb through, and which argument carries the
 * verb's name. `assertActionFails` is deliberately absent: a verb only ever seen failing has not
 * been shown to work. `action(...)` counts only when the builder is `execute()`d, the world
 * engine's `applyCommand(player, { name, args })` carries the name inside its command object, the
 * world runner's `apply({ command: { name, args }, ... })` inside its request's command, and
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
  "world.take(seat, 'verb'), " +
  "runner.apply({ command: { name: 'verb', ... }, ... }) on the world runner, " +
  'or a helper of the project\'s own ' +
  'under tests/ that passes the verb name, or the whole command, it is given to one of these (or to the world engine\'s applyCommand). ' +
  'The name may be written at the call, or come from an it.each row, a for...of, forEach, map or flatMap over a literal list, ' +
  'a field of an object literal, or either branch of a conditional';

/** Every name a built-in entry point is called by. */
const ENTRY_POINT_NAMES = Object.freeze([...Object.keys(DISPATCH_ENTRY_POINTS), 'applyCommand', 'apply', 'send', 'execute']);

/** The `action('verb', seat)` call an `execute()` chain starts from, found by walking back the chain. */
function executedBuilder(executeCallee: AstNode): AstNode | undefined {
  let link = executeCallee.object as AstNode;
  while (link.type === 'CallExpression') {
    const linkCallee = link.callee as AstNode;
    if (linkCallee.type !== 'MemberExpression') return undefined;
    if (calleeName(linkCallee) === 'action') return link;
    link = linkCallee.object as AstNode;
  }
  return undefined;
}

/** What a built-in entry point's call carries the verb in, if the call is one. */
function entryPointCarriers(source: ScopedSource, call: AstNode, name: string): Carrier[] {
  const callee = call.callee as AstNode;
  if (name in DISPATCH_ENTRY_POINTS) return [{ node: argAt(call, DISPATCH_ENTRY_POINTS[name]), path: [] }];
  if (name === 'applyCommand') return [{ node: argAt(call, 1), path: ['name'] }];
  if (name === 'apply') return [{ node: argAt(call, 0), path: ['command', 'name'] }];
  if (name === 'execute' && callee.type === 'MemberExpression') {
    const builder = executedBuilder(callee);
    return builder ? [{ node: argAt(builder, 0), path: [] }] : [];
  }
  if (name !== 'send') return [];
  const isActionOp = (op: Value) =>
    isNode(op) && op.type === 'ObjectExpression' && valuesOf(source, op, ['type']).some((t) => isNode(t) && literalText(t) === 'action');
  return valuesOf(source, argAt(call, 1), []).filter(isActionOp).map((op) => ({ node: op, path: ['actionName'] }));
}

const dispatchCarriers: Carriers = (source, call, wrappers) => {
  const name = calleeName(call.callee as AstNode);
  return name === undefined ? [] : [...entryPointCarriers(source, call, name), ...helperCarriers(source, call, wrappers)];
};

/** Every project function (a test harness, usually) that dispatches a verb named by a parameter, or a command it is given. */
export function findDispatchWrappers(sources: readonly SourceFile[]): DispatchWrappers {
  return findWrappers(sources, dispatchCarriers, ENTRY_POINT_NAMES);
}

/** Every verb the file dispatches through the engine, outside skipped tests, with its line, in source order. */
export function findDispatches(
  source: string,
  file?: string,
  wrappers: DispatchWrappers = NO_DISPATCH_WRAPPERS,
): Array<{ verb: string; line: number }> {
  const scoped = parseScoped(source, file);
  const skippedRanges = collectBlocks(scoped)
    .filter((b) => b.skipped)
    .map((b) => b.range);
  const inSkipped = (node: AstNode) =>
    skippedRanges.some(([start, end]) => start <= node.range[0] && node.range[1] <= end);

  const dispatches: Array<{ verb: string; line: number }> = [];
  walk(scoped.ast, (node) => {
    if (node.type !== 'CallExpression' || inSkipped(node)) return;
    for (const value of carriedValues(scoped, node, dispatchCarriers, wrappers)) {
      const verb = isNode(value) ? literalText(value) : undefined;
      if (verb !== undefined) dispatches.push({ verb, line: node.loc.start.line });
    }
  });
  return dispatches;
}

/** Every verb the file dispatches through the engine, outside skipped tests, in source order. */
export function findDispatchedVerbs(source: string, file?: string, wrappers: DispatchWrappers = NO_DISPATCH_WRAPPERS): string[] {
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
