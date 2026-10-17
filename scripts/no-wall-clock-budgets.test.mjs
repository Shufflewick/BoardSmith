/**
 * No test asserts how long something took (#360).
 *
 * The merge gate (`agent-policy thread merge`) runs the whole suite while other merges and
 * worktree suites run on the same machine, at load averages past 100. A test
 * that asserts `elapsed < 1000` then fails with nothing regressed, refuses an
 * unrelated merge, and every agent has to prove the red is not theirs. #354,
 * #355, #360 and #363 were four of those in one day.
 *
 * So the claim a budget stood for has to be stated as the work done: count the
 * reads, the calls or the timers scheduled (see the #313 test in
 * `src/ui/composables/useBoardInteraction.test.ts`), or prove the path taken
 * by what it returned. This scan reads the syntax tree and fails on any
 * `expect(...)` whose subject subtracts a clock read, or a variable assigned
 * one, directly or through a variable holding that difference, whatever the
 * matcher (#919). A variable counts only where its declaration is visible: a
 * `let`, `const` or catch binding in its block, a `var` or parameter in its
 * function, minus any inner block or function that declares the same name again.
 *
 * It does not flag a timestamp checked against the clock
 * (`expect(entry.timestamp).toBeLessThanOrEqual(Date.now())`), which is a
 * claim about a value, not about elapsed time. It does flag a clock read minus
 * a constant (`expect(now - 5000)`), since that subject still subtracts one.
 */
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { trackedTestFiles } from './tracked-tests.test-helper.mjs';

const CLOCKS = ['Date.now', 'performance.now', 'process.hrtime', 'process.hrtime.bigint'];

const bare = (node) => (ts.isParenthesizedExpression(node) ? bare(node.expression) : node);
/** Whether `node` calls a clock, bare or through an object such as `globalThis` or `window`. */
const isClockRead = (node) => {
  const callee = ts.isCallExpression(node) && node.expression.getText();
  return Boolean(callee) && CLOCKS.some((clock) => callee === clock || callee.endsWith(`.${clock}`));
};
const isBlockScope = (node) =>
  ts.isBlock(node) || ts.isCatchClause(node) || ts.isForStatement(node) || ts.isForInStatement(node)
  || ts.isForOfStatement(node);
/** The nearest node around `node` (a block, loop, catch, function or the file) that matches `isScope`. */
const enclosing = (node, isScope) => {
  let scope = node.parent;
  while (scope.parent && !ts.isFunctionLike(scope) && !isScope(scope)) scope = scope.parent;
  return scope;
};
/** The block, loop, catch, function or file `node` is in: where a `let` or `const` declared there is visible. */
const scopeOf = (node) => enclosing(node, isBlockScope);
/** Where declaration `node` is visible: its function for a `var` or parameter, its block otherwise. */
const declarationScope = (node) =>
  ts.isParameter(node) || (ts.isVariableDeclarationList(node.parent) && !(node.parent.flags & ts.NodeFlags.BlockScoped))
    ? enclosing(node, () => false)
    : scopeOf(node);

/** The name `node` assigns and the value it assigns, when it is `const x = v`, `(x = v) =>` or `x = v`. */
function assignmentAt(node) {
  if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name) && node.initializer) {
    return { name: node.name.text, value: bare(node.initializer) };
  }
  const assigns = ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken;
  return assigns && ts.isIdentifier(node.left) ? { name: node.left.text, value: bare(node.right) } : undefined;
}

/** Every `expect(...)` in a source whose subject measures a clock difference, with any matcher. */
function wallClockBudgets(source) {
  const sourceFile = ts.createSourceFile('scanned.ts', source, ts.ScriptTarget.Latest, true);
  const assignments = [];
  const expects = [];
  const declared = new Map();
  const visit = (node) => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name)) {
      const scope = declarationScope(node);
      declared.set(scope, (declared.get(scope) ?? new Set()).add(node.name.text));
    }
    const assignment = assignmentAt(node);
    if (assignment) assignments.push({ ...assignment, at: node });
    else if (ts.isCallExpression(node) && node.expression.getText() === 'expect' && node.arguments.length > 0) {
      expects.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  /** The block or function that declares `name` as seen from `node`; an undeclared name belongs to the file. */
  const declaringScope = (name, node) => {
    for (let scope = scopeOf(node); scope; scope = scope.parent && scopeOf(scope)) {
      if (declared.get(scope)?.has(name)) return scope;
    }
    return sourceFile;
  };
  /** Whether identifier `node` refers to the declaration of a name recorded in `names`. */
  const tracked = (names, node) => names.get(node.text)?.has(declaringScope(node.text, node)) === true;
  const record = (names, { name, at }) => names.set(name, (names.get(name) ?? new Set()).add(declaringScope(name, at)));
  const isReference = (node) =>
    ts.isIdentifier(node) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node);

  const clockVars = new Map();
  assignments.filter(({ value }) => isClockRead(value)).forEach((entry) => record(clockVars, entry));
  const isClockTerm = (node) => isClockRead(bare(node)) || (isReference(bare(node)) && tracked(clockVars, bare(node)));
  const durations = new Map();
  /** Whether `node` subtracts a clock read or a variable holding one, or reads a variable holding such a difference. */
  const measures = (node) =>
    (ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.MinusToken
      && (isClockTerm(node.left) || isClockTerm(node.right)))
    || (isReference(node) && tracked(durations, node))
    || ts.forEachChild(node, measures) === true;
  assignments.filter(({ value }) => measures(value)).forEach((entry) => record(durations, entry));

  const lines = source.split('\n');
  return expects
    .filter((call) => measures(call.arguments[0]))
    .map((call) => {
      const line = sourceFile.getLineAndCharacterOfPosition(call.getStart()).line;
      return { line: line + 1, text: lines[line].trim() };
    });
}

describe('wallClockBudgets', () => {
  it('finds a budget on a clock difference held in a variable', () => {
    const source = [
      'const started = performance.now();',
      'work();',
      'const elapsed = performance.now() - started;',
      'expect(elapsed).toBeLessThan(1000);',
    ].join('\n');
    expect(wallClockBudgets(source)).toEqual([{ line: 4, text: 'expect(elapsed).toBeLessThan(1000);' }]);
  });

  it('finds a budget on a clock difference written inline', () => {
    expect(wallClockBudgets('expect(Date.now() - start).toBeLessThan(500);')).toHaveLength(1);
  });

  it('finds a budget on the difference of two clock reads (#919)', () => {
    const source = [
      'const t0 = performance.now();',
      'work();',
      'const t1 = performance.now();',
      'expect(t1 - t0).toBeLessThan(100);',
    ].join('\n');
    expect(wallClockBudgets(source)).toEqual([{ line: 4, text: 'expect(t1 - t0).toBeLessThan(100);' }]);
  });

  it('finds a budget compared inside the subject, whatever the matcher (#919)', () => {
    expect(wallClockBudgets('expect(Date.now() - start < 500).toBe(true);')).toHaveLength(1);
  });

  it('finds a budget whose expect( spans lines (#919)', () => {
    const source = ['const elapsed = Date.now() - started;', 'expect(', '  elapsed,', ').toBeLessThan(500);'].join('\n');
    expect(wallClockBudgets(source)).toEqual([{ line: 2, text: 'expect(' }]);
  });

  it('is not misled by a ( inside a string in the subject', () => {
    const source = ["expect(label('(')).toBe('(');", 'const stamp = Date.now() - 5000;'].join('\n');
    expect(wallClockBudgets(source)).toEqual([]);
  });

  it('is not cut short by a ) inside a string in the subject', () => {
    expect(wallClockBudgets("expect(')' + (Date.now() - start)).toBe(')5');")).toHaveLength(1);
  });

  it('does not take a === comparison for an assignment', () => {
    const source = ['const ok = true;', 'if (ok === Date.now() - t) work();', 'expect(ok).toBe(true);'].join('\n');
    expect(wallClockBudgets(source)).toEqual([]);
  });

  it('does not let a duration held in one test flag a same-named value in another', () => {
    const source = [
      "it('a', () => { const delta = performance.now() - started; record(delta); });",
      "it('b', () => { const delta = 3; expect(delta).toBe(3); });",
    ].join('\n');
    expect(wallClockBudgets(source)).toEqual([]);
  });

  it('finds a duration assigned in a hook and asserted in a test (#919)', () => {
    const source = [
      'let duration;',
      'beforeAll(() => { const t0 = Date.now(); work(); duration = Date.now() - t0; });',
      "it('x', () => { expect(duration).toBeLessThan(5); });",
    ].join('\n');
    expect(wallClockBudgets(source)).toHaveLength(1);
  });

  it('finds clock reads assigned in a hook and subtracted in a test (#919)', () => {
    const source = [
      'let t0, t1;',
      'beforeAll(() => { t0 = performance.now(); work(); t1 = performance.now(); });',
      "it('x', () => { expect(t1 - t0).toBeLessThan(5); });",
    ].join('\n');
    expect(wallClockBudgets(source)).toHaveLength(1);
  });

  it('finds a duration assigned in an outer describe and asserted in an inner test (#919)', () => {
    const source = [
      "describe('d', () => {",
      '  let elapsed;',
      '  beforeAll(() => { const t0 = Date.now(); work(); elapsed = Date.now() - t0; });',
      "  describe('inner', () => { it('x', () => { expect(elapsed).toBeLessThan(5); }); });",
      '});',
    ].join('\n');
    expect(wallClockBudgets(source)).toHaveLength(1);
  });

  it('finds an inline clock difference in a test against a start read in a hook (#919)', () => {
    const source = [
      'let t0;',
      'beforeAll(() => { t0 = performance.now(); });',
      "it('x', () => { work(); expect(performance.now() - t0).toBeLessThan(5); });",
    ].join('\n');
    expect(wallClockBudgets(source)).toHaveLength(1);
  });

  it('finds a clock read through globalThis or window (#919)', () => {
    expect(wallClockBudgets('expect(globalThis.performance.now() - start).toBeLessThan(5);')).toHaveLength(1);
    expect(wallClockBudgets('expect(window.performance.now() - start).toBeLessThan(5);')).toHaveLength(1);
  });

  it('does not flag an inner name that shadows an outer duration (#919)', () => {
    const outer = 'const delta = performance.now() - started;';
    const redeclared = [outer, "it('x', () => { const delta = 3; expect(delta).toBe(3); });"].join('\n');
    const parameter = [outer, "it.each([3])('x', (delta) => { expect(delta).toBe(3); });"].join('\n');
    expect(wallClockBudgets(redeclared)).toEqual([]);
    expect(wallClockBudgets(parameter)).toEqual([]);
  });

  it('does not let a same-named name in an inner block, catch or later block hide an outer duration (#919)', () => {
    const inIf = [
      'const elapsed = Date.now() - s;',
      "it('x', () => { if (a) { const elapsed = 3; } expect(elapsed).toBeLessThan(5); });",
    ].join('\n');
    const inCatch = [
      'let elapsed = Date.now() - s;',
      "it('x', () => { try {} catch (elapsed) {} expect(elapsed).toBeLessThan(5); });",
    ].join('\n');
    const laterBlock = [
      'let d;',
      'beforeAll(() => { d = Date.now() - s; });',
      "it('x', () => { expect(d).toBeLessThan(5); { let d = 1; } });",
    ].join('\n');
    expect(wallClockBudgets(inIf)).toHaveLength(1);
    expect(wallClockBudgets(inCatch)).toHaveLength(1);
    expect(wallClockBudgets(laterBlock)).toHaveLength(1);
  });

  it('finds a duration held in a default parameter value (#919)', () => {
    expect(wallClockBudgets('const check = (d = Date.now() - s) => { expect(d).toBeLessThan(5); };')).toHaveLength(1);
  });

  it('leaves a timestamp checked against the clock alone', () => {
    expect(wallClockBudgets('expect(entry.timestamp).toBeLessThanOrEqual(Date.now());')).toEqual([]);
  });
});

describe('the test suite (#360)', () => {
  it('holds no wall-clock budget assertion', () => {
    const tracked = trackedTestFiles(['src', 'docs', 'scripts'])
      // This file's own examples above are budgets on purpose.
      .filter(({ path }) => path !== 'scripts/no-wall-clock-budgets.test.mjs');
    const findings = tracked.flatMap(({ path, text }) =>
      wallClockBudgets(text).map(
        ({ line, text }) => `${path}:${line}  ${text}`,
      ),
    );
    expect(
      findings,
      'These tests assert how long something took, which fails on a busy machine with nothing '
        + 'wrong. Assert the work done instead (calls, reads, timers scheduled) or the path taken.',
    ).toEqual([]);
  });
});
