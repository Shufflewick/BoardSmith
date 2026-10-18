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
 * one, directly or through any chain of variables holding that difference,
 * whatever the matcher (#919, #1083). "A variable" is a declaration, parameter,
 * destructuring default, name destructured from a literal, class field, object
 * property or function declaration's return, and TypeScript's checker resolves
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

const WRAPPERS = [ts.isParenthesizedExpression, ts.isAsExpression, ts.isNonNullExpression, ts.isSatisfiesExpression,
  ts.isTypeAssertionExpression];
/** `node` without the parentheses and type assertions around it, which leave its value as it is. */
const bare = (node) => (WRAPPERS.some((is) => is(node)) ? bare(node.expression) : node);
const ARITHMETIC = [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken];
/**
 * Whether `node` reads a clock, bare or through an object such as `globalThis` or `window`, or does
 * arithmetic on such a read (`Date.now() + offset`), which still moves with the clock.
 */
const isClockRead = (node) => {
  const value = bare(node);
  if (ts.isBinaryExpression(value) && ARITHMETIC.includes(value.operatorToken.kind)) {
    return isClockRead(value.left) || isClockRead(value.right);
  }
  if (!ts.isCallExpression(value)) return false;
  const callee = value.expression.getText();
  // A read passed through a call (`Math.round(performance.now())`) still moves with the clock.
  return CLOCKS.some((clock) => callee === clock || callee.endsWith(`.${clock}`)) || value.arguments.some(isClockRead);
};

const OPTIONS = { noLib: true, noResolve: true, types: [], allowJs: true };
/** A checker over `sourceFile` alone, used only to resolve each name to the declaration it refers to. */
function checkerFor(sourceFile) {
  const host = ts.createCompilerHost(OPTIONS);
  host.getSourceFile = (fileName) => (fileName === sourceFile.fileName ? sourceFile : undefined);
  return ts.createProgram([sourceFile.fileName], OPTIONS, host).getTypeChecker();
}

const HAS_VALUE = [ts.isVariableDeclaration, ts.isParameter, ts.isBindingElement, ts.isPropertyDeclaration, ts.isPropertyAssignment];
/**
 * What a name destructured with no default takes from the array or object literal it is destructured from: the
 * matching element, every element from a rest on, or the matching property.
 */
function destructured(element) {
  const pattern = element.parent;
  const from = pattern.parent.initializer && bare(pattern.parent.initializer);
  if (from && ts.isArrayLiteralExpression(from)) {
    const at = pattern.elements.indexOf(element);
    return from.elements.slice(at, element.dotDotDotToken ? undefined : at + 1);
  }
  if (!from || !ts.isObjectLiteralExpression(from) || element.dotDotDotToken) return [];
  return propertyValue(from, (element.propertyName ?? element.name).getText());
}

/** The value an object literal gives `key`, written as a property or a shorthand. */
function propertyValue(literal, key) {
  const property = literal.properties.find(({ name }) => name?.getText() === key);
  if (!property) return [];
  return [ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer].filter(Boolean);
}

/** What a function returns: an arrow's expression body, or each `return` not inside a nested function. */
const returnsOf = (fn) => (!fn.body ? [] : ts.isBlock(fn.body) ? returned(fn.body) : [fn.body]);
/** What `node` returns, leaving out the returns of functions nested in it. */
function returned(node) {
  if (ts.isReturnStatement(node)) return node.expression ? [node.expression] : [];
  const found = [];
  if (!ts.isFunctionLike(node)) ts.forEachChild(node, (child) => { found.push(...returned(child)); });
  return found;
}

const isCompound = (kind) => kind >= ts.SyntaxKind.FirstCompoundAssignment && kind <= ts.SyntaxKind.LastCompoundAssignment;
/**
 * The name `node` gives values to, and those values: a declaration, parameter, field, property or default, a name
 * destructured from a literal, what a function declaration returns, `x = v`, or `x += v` (whose value is the whole
 * expression, so `x -= performance.now()` is a subtraction).
 */
function assignmentAt(node) {
  const value = HAS_VALUE.some((is) => is(node)) ? node.initializer : ts.isShorthandPropertyAssignment(node) && node.objectAssignmentInitializer;
  if (value) return { target: node.name, values: [value] };
  if (ts.isBindingElement(node)) return { target: node.name, values: destructured(node) };
  if (ts.isFunctionDeclaration(node) && node.name && node.body) return { target: node.name, values: returnsOf(node) };
  return ts.isBinaryExpression(node) ? binaryAssignment(node) : undefined;
}

/** `x = v` gives `x` the value `v`; `x += v` gives it the whole expression. */
function binaryAssignment(node) {
  const { kind } = node.operatorToken;
  if (kind !== ts.SyntaxKind.EqualsToken && !isCompound(kind)) return undefined;
  const target = ts.isPropertyAccessExpression(node.left) ? node.left.name : node.left;
  return { target, values: [kind === ts.SyntaxKind.EqualsToken ? node.right : node] };
}

const EXPECTS = ['expect', 'expect.soft'];
/** Every `expect(...)` in a source whose subject measures a clock difference, with any matcher. */
function wallClockBudgets(source, fileName = 'scanned.ts') {
  // Every finding needs a clock read written out, and most files have none: skip building a checker for them.
  if (!CLOCKS.some((clock) => source.includes(clock))) return [];
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const checker = checkerFor(sourceFile);
  const assignments = [];
  const expects = [];
  const visit = (node) => {
    const assignment = assignmentAt(node);
    if (assignment && ts.isMemberName(assignment.target)) {
      assignments.push(...assignment.values.map((value) => ({ target: assignment.target, value })));
    } else if (ts.isCallExpression(node) && EXPECTS.includes(node.expression.getText()) && node.arguments.length > 0) {
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
  const isClockTerm = (node) => isClockRead(node) || holds(clockVars, nameOf(bare(node)));
  let durations = new Set();
  /**
   * Whether `node` subtracts a clock read or a name holding one, or reads a name holding such a difference. A
   * function counts by what it returns, so a clock used only as a timeout inside it does not.
   */
  const subtractsClock = (node) => ts.isBinaryExpression(node)
    && [ts.SyntaxKind.MinusToken, ts.SyntaxKind.MinusEqualsToken].includes(node.operatorToken.kind)
    && (isClockTerm(node.left) || isClockTerm(node.right));
  const measures = (node) => (ts.isFunctionLike(node)
    ? returnsOf(node).some(measures)
    : subtractsClock(node) || holds(durations, node) || ts.forEachChild(node, measures) === true);
  // Until nothing changes, so a duration handed from name to name is followed to the end.
  for (let size = -1; size !== durations.size;) {
    size = durations.size;
    durations = bindingsOf(assignments.filter(({ value }) => measures(value)));
  }

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

  it('finds clock reads wrapped in a type assertion, a non-null mark or an offset (#919)', () => {
    const wrapped = ['performance.now() as number', 'performance.now()!', '<number>performance.now()',
      'performance.now() satisfies number', 'performance.now() + offset'];
    for (const read of wrapped) {
      const source = [`const t0 = ${read};`, `const t1 = ${read};`, 'expect(t1 - t0).toBeLessThan(5);'].join('\n');
      expect(wallClockBudgets(source), read).toHaveLength(1);
    }
  });

  it('finds a duration given by a default in a destructuring assignment (#919)', () => {
    const source = ['let d;', '({ d = Date.now() - s } = {});', 'expect(d).toBeLessThan(5);'].join('\n');
    expect(wallClockBudgets(source)).toHaveLength(1);
  });

  it('finds a duration written as a shorthand property in the subject (#919)', () => {
    const source = ['const elapsed = Date.now() - s;', 'expect({ elapsed }).toEqual({ elapsed: 1 });'].join('\n');
    expect(wallClockBudgets(source)).toHaveLength(1);
  });

  it('finds clock reads assigned to this in one method and subtracted in another (#919)', () => {
    const source = [
      'class C {',
      '  t0 = 0; t1 = 0;',
      '  a() { this.t0 = performance.now(); this.t1 = performance.now(); }',
      '  b() { expect(this.t1 - this.t0).toBeLessThan(5); }',
      '}',
    ].join('\n');
    expect(wallClockBudgets(source)).toHaveLength(1);
  });

  it('finds a clock read passed through a call (#1083)', () => {
    const source = ['const t0 = Math.round(performance.now());', 'expect(Math.round(performance.now()) - t0).toBeLessThan(5);'];
    expect(wallClockBudgets(source.join('\n'))).toHaveLength(1);
  });

  it('finds a duration assigned to this in a JavaScript constructor with no declared field (#1083)', () => {
    const source = 'class C { constructor() { this.e = Date.now() - s; } check() { expect(this.e).toBeLessThan(5); } }';
    expect(wallClockBudgets(source, 'x.test.mjs')).toHaveLength(1);
  });

  it('finds a duration passed along through other names (#1083)', () => {
    const start = 'const duration = Date.now() - s;';
    const forms = {
      'a plain copy': 'const d = duration;\nexpect(d).toBeLessThan(5);',
      'an array rest': 'const [...r] = [duration];\nexpect(r[0]).toBeLessThan(5);',
      'an array element': 'const [, d] = [1, duration];\nexpect(d).toBeLessThan(5);',
      'an object literal': 'const { a } = { a: duration };\nexpect(a).toBeLessThan(5);',
      'a renamed shorthand': 'const { duration: a } = { duration };\nexpect(a).toBeLessThan(5);',
      'a function declaration': 'function took() { return duration; }\nexpect(took()).toBeLessThan(5);',
    };
    for (const [form, rest] of Object.entries(forms)) {
      expect(wallClockBudgets(`${start}\n${rest}`), form).toHaveLength(1);
    }
  });

  it('does not flag a name destructured beside a duration (#1083)', () => {
    const start = 'const duration = Date.now() - s;';
    expect(wallClockBudgets(`${start}\nconst [d, n] = [duration, 3];\nexpect(n).toBe(3);`)).toEqual([]);
    expect(wallClockBudgets(`${start}\nconst [d, ...r] = [duration, 3];\nexpect(r).toEqual([3]);`)).toEqual([]);
    expect(wallClockBudgets(`${start}\nconst { a, b } = { a: duration, b: 3 };\nexpect(b).toBe(3);`)).toEqual([]);
  });

  it('does not flag a function that times out on the clock but returns something else (#1083)', () => {
    const source = 'function waitFor() { const s = Date.now(); while (Date.now() - s < 5) {} return done; }';
    expect(wallClockBudgets(`${source}\nexpect(waitFor()).toBe(true);`)).toEqual([]);
  });

  it('judges arrows, function expressions and methods by what they return, not by their bodies (#1083)', () => {
    const wait = '{ const s = Date.now(); while (Date.now() - s < 5) {} return done; }';
    const awaited = `const waitFor = async () => ${wait};\nconst ok = await waitFor();\nexpect(ok).toBe(true);`;
    const expression = `const waitFor = function () ${wait};\nexpect(waitFor()).toBe(true);`;
    const method = `const h = { wait() ${wait}, n: 3 };\nconst n = h.n;\nexpect(n).toBe(3);`;
    expect(wallClockBudgets(awaited)).toEqual([]);
    expect(wallClockBudgets(expression)).toEqual([]);
    expect(wallClockBudgets(method)).toEqual([]);
    expect(wallClockBudgets('const took = () => Date.now() - s;\nexpect(took()).toBeLessThan(5);')).toHaveLength(1);
    expect(wallClockBudgets('const took = () => { return Date.now() - s; };\nexpect(took()).toBeLessThan(5);')).toHaveLength(1);
  });

  it('finds a duration built by compound assignment (#1083)', () => {
    expect(wallClockBudgets('let e = 0;\ne += Date.now() - s;\nexpect(e).toBeLessThan(5);')).toHaveLength(1);
    expect(wallClockBudgets('let e = Date.now();\ne -= s;\nexpect(e).toBeLessThan(5);')).toHaveLength(1);
    expect(wallClockBudgets('let e = 0;\ne -= performance.now();\nexpect(e).toBeLessThan(5);')).toHaveLength(1);
  });

  it('finds a budget asserted with expect.soft (#1083)', () => {
    expect(wallClockBudgets('expect.soft(Date.now() - start).toBeLessThan(500);')).toHaveLength(1);
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
      wallClockBudgets(text, path).map(
        ({ line, text }) => `${path}:${line}  ${text}`,
      ),
    );
    expect(
      findings,
      'These tests assert how long something took, which fails on a busy machine with nothing '
        + 'wrong. Assert the work done instead (calls, reads, timers scheduled) or the path taken '
        + '(CLAUDE.md, "Testing": never assert how long something took).',
    ).toEqual([]);
  });
});
