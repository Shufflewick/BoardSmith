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
 * matcher (#919). A variable counts only in the function it was assigned in
 * and the functions inside it.
 *
 * It does not flag a timestamp checked against the clock
 * (`expect(entry.timestamp).toBeLessThanOrEqual(Date.now())`), which is a
 * claim about a value, not about elapsed time. It does flag a clock read minus
 * a constant (`expect(now - 5000)`), since that subject still subtracts one.
 */
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { trackedTestFiles } from './tracked-tests.test-helper.mjs';

const CLOCKS = new Set(['Date.now', 'performance.now', 'process.hrtime', 'process.hrtime.bigint']);

const bare = (node) => (ts.isParenthesizedExpression(node) ? bare(node.expression) : node);
const isClockRead = (node) => ts.isCallExpression(node) && CLOCKS.has(node.expression.getText());
/** The function (or file) whose body `node` is in, which is where a name assigned there is visible. */
const scopeOf = (node) => {
  let scope = node.parent;
  while (scope.parent && !ts.isFunctionLike(scope)) scope = scope.parent;
  return scope;
};

/** Every `expect(...)` in a source whose subject measures a clock difference, with any matcher. */
function wallClockBudgets(source) {
  const sourceFile = ts.createSourceFile('scanned.ts', source, ts.ScriptTarget.Latest, true);
  const assignments = [];
  const expects = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      assignments.push({ name: node.name.text, value: bare(node.initializer), scope: scopeOf(node) });
    } else if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(node.left)
    ) {
      assignments.push({ name: node.left.text, value: bare(node.right), scope: scopeOf(node) });
    } else if (ts.isCallExpression(node) && node.expression.getText() === 'expect' && node.arguments.length > 0) {
      expects.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  /** Whether identifier `node` is a name recorded in `names` for its function or one enclosing it. */
  const tracked = (names, node) => {
    const scopes = names.get(node.text);
    for (let scope = scopeOf(node); scope; scope = scope.parent && scopeOf(scope)) if (scopes?.has(scope)) return true;
    return false;
  };
  const record = (names, { name, scope }) => names.set(name, (names.get(name) ?? new Set()).add(scope));
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
