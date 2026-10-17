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
 * matcher (#919). "A variable" is a declaration, parameter, destructuring
 * default, class field or object property, and TypeScript's checker resolves
 * each name to the declaration it refers to, so shadowing follows the
 * language's own scope rules rather than a copy of them.
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

const OPTIONS = { noLib: true, noResolve: true, types: [] };
/** A checker over `sourceFile` alone, used only to resolve each name to the declaration it refers to. */
function checkerFor(sourceFile) {
  const host = ts.createCompilerHost(OPTIONS);
  host.getSourceFile = (fileName) => (fileName === sourceFile.fileName ? sourceFile : undefined);
  return ts.createProgram([sourceFile.fileName], OPTIONS, host).getTypeChecker();
}

const HAS_VALUE = [ts.isVariableDeclaration, ts.isParameter, ts.isBindingElement, ts.isPropertyDeclaration, ts.isPropertyAssignment];
/** The name `node` gives a value to, and that value: a declaration, parameter, field, property or default, or `x = v`. */
function assignmentAt(node) {
  if (HAS_VALUE.some((is) => is(node)) && node.initializer) return { target: node.name, value: bare(node.initializer) };
  if (ts.isShorthandPropertyAssignment(node) && node.objectAssignmentInitializer) {
    return { target: node.name, value: bare(node.objectAssignmentInitializer) };
  }
  if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return undefined;
  return { target: ts.isPropertyAccessExpression(node.left) ? node.left.name : node.left, value: bare(node.right) };
}

/** Every `expect(...)` in a source whose subject measures a clock difference, with any matcher. */
function wallClockBudgets(source) {
  // Every finding needs a clock read written out, and most files have none: skip building a checker for them.
  if (!CLOCKS.some((clock) => source.includes(clock))) return [];
  const sourceFile = ts.createSourceFile('scanned.ts', source, ts.ScriptTarget.Latest, true);
  const checker = checkerFor(sourceFile);
  const assignments = [];
  const expects = [];
  const visit = (node) => {
    const assignment = assignmentAt(node);
    if (assignment && ts.isMemberName(assignment.target)) assignments.push(assignment);
    else if (ts.isCallExpression(node) && node.expression.getText() === 'expect' && node.arguments.length > 0) {
      expects.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  /**
   * The declarations name `name` refers to; a bare name declared nowhere is one global per spelling. Root
   * symbols, because a field read through an instance resolves to a per-instance copy of the field's symbol.
   */
  const bindingsAt = (name) => {
    const shorthand = ts.isShorthandPropertyAssignment(name.parent) && name.parent.name === name;
    const symbol = shorthand ? checker.getShorthandAssignmentValueSymbol(name.parent) : checker.getSymbolAtLocation(name);
    if (symbol) return checker.getRootSymbols(symbol);
    return ts.isPropertyAccessExpression(name.parent) && name.parent.name === name ? [] : [name.text];
  };
  const holds = (bindings, node) => ts.isMemberName(node) && bindingsAt(node).some((binding) => bindings.has(binding));
  const bindingsOf = (entries) => new Set(entries.flatMap(({ target }) => bindingsAt(target)));

  const clockVars = bindingsOf(assignments.filter(({ value }) => isClockRead(value)));
  const nameOf = (node) => (ts.isPropertyAccessExpression(node) ? node.name : node);
  const isClockTerm = (node) => isClockRead(bare(node)) || holds(clockVars, nameOf(bare(node)));
  let durations = new Set();
  /** Whether `node` subtracts a clock read or a name holding one, or reads a name holding such a difference. */
  const measures = (node) =>
    (ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.MinusToken
      && (isClockTerm(node.left) || isClockTerm(node.right)))
    || holds(durations, node)
    || ts.forEachChild(node, measures) === true;
  durations = bindingsOf(assignments.filter(({ value }) => measures(value)));

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

  it('does not let a same-named name under a switch case hide an outer duration (#919)', () => {
    const source = [
      'const elapsed = Date.now() - s;',
      "it('x', () => { switch (k) { case 1: const elapsed = 3; } expect(elapsed).toBeLessThan(5); });",
    ].join('\n');
    expect(wallClockBudgets(source)).toHaveLength(1);
  });

  it('reads a var as belonging to its whole function, not the block it is written in (#919)', () => {
    const source = 'function f() { if (a) { var e = Date.now() - s; } expect(e).toBeLessThan(5); }';
    expect(wallClockBudgets(source)).toHaveLength(1);
  });

  it('keeps a name declared in a for header inside its loop (#919)', () => {
    const source = [
      'const d = Date.now() - s;',
      'for (const d of [1]) { expect(d).toBe(1); }',
      'expect(d).toBeLessThan(5);',
    ].join('\n');
    expect(wallClockBudgets(source)).toEqual([{ line: 3, text: 'expect(d).toBeLessThan(5);' }]);
  });

  it('finds a duration held in a default parameter or destructuring default (#919)', () => {
    expect(wallClockBudgets('const check = (d = Date.now() - s) => { expect(d).toBeLessThan(5); };')).toHaveLength(1);
    expect(wallClockBudgets('const { d = Date.now() - s } = {};\nexpect(d).toBeLessThan(5);')).toHaveLength(1);
    expect(wallClockBudgets('const check = ({ d = Date.now() - s }) => { expect(d).toBeLessThan(5); };')).toHaveLength(1);
  });

  it('finds a duration held in a class field, read through this or an instance (#919)', () => {
    const throughThis = 'class C { e = Date.now() - s; check() { expect(this.e).toBeLessThan(5); } }';
    const throughInstance = 'class C { e = Date.now() - s; }\nconst c = new C();\nexpect(c.e).toBeLessThan(5);';
    expect(wallClockBudgets(throughThis)).toHaveLength(1);
    expect(wallClockBudgets(throughInstance)).toHaveLength(1);
    expect(wallClockBudgets('const e = Date.now() - s;\nexpect(other.e).toBe(1);')).toEqual([]);
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
