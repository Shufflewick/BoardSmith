/**
 * No test asserts how long something took (#360).
 *
 * The merge gate (`agent-policy merge`) runs the whole suite while other merges and
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
 * whatever the matcher (#919, #1083, #1104). "A variable" is a declaration,
 * parameter (including what a call passes it), destructuring default, name
 * destructured at any depth from a literal or a variable, by declaration or
 * assignment, class field, object property, or the return of a function
 * declaration, method or getter. An array `push`ed a duration holds one, and
 * so does each element a for-of or an element callback (`forEach`, `map`, ...,
 * inline, by name, as a method, through another variable or through a
 * parameter, and `reduce`'s second parameter) takes from it (#1130, #1157, #1168). A property is judged by its own value, not by what else its object
 * holds, including one read from an element of an array variable (#1157); `.length`
 * judged from the whole value is a count (#1168). An array element destructured from a variable rather than a
 * literal takes the whole array. TypeScript's checker resolves
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

/** What a function returns: an arrow's expression body, or each `return` not inside a nested function. */
const returnsOf = (fn) => (!fn.body ? [] : ts.isBlock(fn.body) ? returned(fn.body) : [fn.body]);
/** What `node` returns, leaving out the returns of functions nested in it. */
function returned(node) {
  if (ts.isReturnStatement(node)) return node.expression ? [node.expression] : [];
  const found = [];
  if (!ts.isFunctionLike(node)) ts.forEachChild(node, (child) => { found.push(...returned(child)); });
  return found;
}

/** The value a declaration, parameter, field, property or default gives its name, if it gives one. */
const declaredValue = (node) => (HAS_VALUE.some((is) => is(node)) ? node.initializer
  : ts.isShorthandPropertyAssignment(node) && node.objectAssignmentInitializer);
const RETURNS = [ts.isFunctionDeclaration, ts.isMethodDeclaration, ts.isGetAccessorDeclaration];
const isCompound = (kind) => kind >= ts.SyntaxKind.FirstCompoundAssignment && kind <= ts.SyntaxKind.LastCompoundAssignment;

/** The array methods that hand a callback each element, and which of its parameters takes it. */
const ELEMENT_PARAMETER = new Map([...['forEach', 'map', 'flatMap', 'filter', 'find', 'some', 'every'].map((name) => [name, 0]),
  ['reduce', 1], ['reduceRight', 1]]);
/** Whether `node` hands a callback to an array method that passes it each element. */
const isElementCall = (node) => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
  && ELEMENT_PARAMETER.has(node.expression.name.text) && node.arguments.length > 0;
const EXPECTS = ['expect', 'expect.soft', 'vi.expect', 'vi.expect.soft'];
/** Every `expect(...)` in a source whose subject measures a clock difference, with any matcher. */
const wallClockBudgets = (source, fileName) => scanForBudgets(source, fileName).budgets;
/** The budgets in a source, and the most name and property reads any one question needed, so a test can bound the work. */
function scanForBudgets(source, fileName = 'scanned.ts') {
  // Every finding needs a clock read written out, and most files have none: skip building a checker for them.
  if (!CLOCKS.some((clock) => source.includes(clock))) return { budgets: [], mostReads: 0 };
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const checker = checkerFor(sourceFile);

  /** What each value gives element `at` of an array pattern, or every element from `at` on for a rest. */
  const elementsAt = (values, at, rest) => values.map(bare).flatMap((from) => (ts.isArrayLiteralExpression(from)
    // Whole on purpose: an array held in a variable can be pushed to or reordered, so its positions are unknown.
    ? from.elements.slice(at, rest ? undefined : at + 1) : [from]));
  /**
   * What each value gives property `key`: the name of the property its type declares, which holds that property's
   * own value, or the whole value when its type is unknown.
   */
  const memberOf = (values, key) => values.map(bare).flatMap((from) => {
    const declaration = checker.getTypeAtLocation(from).getProperty(key)?.valueDeclaration;
    if (declaration?.name) return [declaration.name];
    // A `length` judged from the whole value is a count, whatever the array or string holds.
    return ts.isObjectLiteralExpression(from) || key === 'length' ? [] : [from];
  });
  /**
   * Each name `target` gives values to, with those values: a name or `x.name` takes them whole, and a binding or
   * assignment pattern hands each of its names its own part, however deeply nested. Defaults are their own assignments.
   */
  const unpack = (target, values) => {
    if (ts.isMemberName(target)) return [{ target, values }];
    if (ts.isPropertyAccessExpression(target)) return [{ target: target.name, values }];
    if (ts.isBinaryExpression(target) && target.operatorToken.kind === ts.SyntaxKind.EqualsToken) return unpack(target.left, values);
    if (ts.isArrayBindingPattern(target) || ts.isArrayLiteralExpression(target)) {
      return target.elements.flatMap((element, at) => {
        const rest = ts.isSpreadElement(element) || Boolean(element.dotDotDotToken);
        const name = ts.isBindingElement(element) ? element.name : ts.isSpreadElement(element) ? element.expression : element;
        return unpack(name, elementsAt(values, at, rest));
      });
    }
    if (ts.isObjectBindingPattern(target)) {
      return target.elements.flatMap((element) => (element.dotDotDotToken ? []
        : unpack(element.name, memberOf(values, (element.propertyName ?? element.name).getText()))));
    }
    if (!ts.isObjectLiteralExpression(target)) return [];
    return target.properties.flatMap((property) => {
      if (ts.isShorthandPropertyAssignment(property)) return unpack(property.name, memberOf(values, property.name.text));
      return ts.isPropertyAssignment(property) ? unpack(property.initializer, memberOf(values, property.name.getText())) : [];
    });
  };
  /** What a call or `new` gives each parameter of the function it resolves to, a rest parameter taking every argument from it on. */
  const passed = (call) => {
    const parameters = checker.getResolvedSignature(call)?.declaration?.parameters ?? [];
    const args = call.arguments ?? [];
    return parameters.flatMap((parameter, at) => unpack(parameter.name, args.slice(at, parameter.dotDotDotToken ? undefined : at + 1)));
  };
  /**
   * The names `node` gives values to, and those values: a declaration, parameter, field, property or default (each
   * name of a pattern its own part), what a function declaration, method or getter returns, what a call passes to the
   * function's parameters, `x = v`, or `x += v` (whose value is the whole expression, so `x -= performance.now()` is a
   * subtraction), what `arr.push(v)` gives `arr`, and the elements a for-of takes from an array. Element callbacks
   * are read after, in `callbackAssignments`.
   */
  const assignmentsAt = (node) => {
    const value = declaredValue(node);
    if (value) return unpack(node.name, [value]);
    if (RETURNS.some((is) => is(node)) && node.name && node.body) {
      return [{ target: node.name, values: returnsOf(node) }];
    }
    if (ts.isCallExpression(node)) return [...passed(node), ...pushAssignments(node)];
    if (ts.isNewExpression(node)) return passed(node);
    if (ts.isForOfStatement(node)) return forOfAssignments(node);
    return ts.isBinaryExpression(node) ? binaryAssignments(node) : [];
  };
  /** `for (x of arr)` gives `x` each element of `arr`. */
  const forOfAssignments = ({ initializer, expression }) => {
    const target = ts.isVariableDeclarationList(initializer) ? initializer.declarations[0].name : initializer;
    return unpack(target, elementsAt([expression], 0, true));
  };
  /** `arr.push(v)` gives `arr` the value `v`; the checker cannot resolve `push` without a standard library. */
  const pushAssignments = ({ expression, arguments: args }) => (ts.isPropertyAccessExpression(expression)
    && expression.name.text === 'push' ? unpack(expression.expression, args) : []);
  /** `x = v` gives `x` the value `v`; `x += v` gives it the whole expression. */
  const binaryAssignments = (node) => {
    const { kind } = node.operatorToken;
    if (kind === ts.SyntaxKind.EqualsToken) return unpack(node.left, [node.right]);
    return isCompound(kind) ? unpack(node.left, [node]) : [];
  };

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

  const assignments = [];
  const valuesOf = new Map();
  const record = (entries) => entries.filter(({ target }) => ts.isMemberName(target)).forEach(({ target, values }) => {
    assignments.push(...values.map((value) => ({ target, value })));
    for (const binding of bindingsAt(target)) valuesOf.set(binding, [...valuesOf.get(binding) ?? [], ...values]);
  });
  const expects = [];
  const elementCalls = [];
  const visit = (node) => {
    record(assignmentsAt(node));
    if (ts.isCallExpression(node) && EXPECTS.includes(node.expression.getText()) && node.arguments.length > 0) {
      expects.push(node);
    }
    if (isElementCall(node)) elementCalls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  /**
   * The functions `node` is or names: an inline function, a function declaration or method, or each value given a
   * name (a variable, parameter or property) that is or names one in turn. A name already followed is not followed again.
   */
  const functionsAt = (node, seen = new Set()) => {
    const value = bare(node);
    if (ts.isFunctionLike(value)) return [value];
    const name = ts.isPropertyAccessExpression(value) ? value.name : value;
    if (!ts.isMemberName(name)) return [];
    const declaration = checker.getSymbolAtLocation(name)?.valueDeclaration;
    if (declaration && ts.isFunctionLike(declaration)) return [declaration];
    const bindings = bindingsAt(name).filter((binding) => !seen.has(binding));
    bindings.forEach((binding) => seen.add(binding));
    return bindings.flatMap((binding) => valuesOf.get(binding) ?? []).flatMap((given) => functionsAt(given, seen));
  };
  /**
   * An element callback gives its element parameter each element of the array (the first, or the second for `reduce`,
   * whose first takes the start value and what the callback returns). Read once every name's values are known, since
   * the callback may be named through other names.
   */
  const callbackAssignments = (call) => {
    const { expression: array, name } = call.expression;
    const at = ELEMENT_PARAMETER.get(name.text);
    return functionsAt(call.arguments[0]).filter((callback) => callback.parameters[at]).flatMap((callback) => {
      const total = at > 0 ? unpack(callback.parameters[0].name, [...call.arguments.slice(1, 2), ...returnsOf(callback)]) : [];
      return [...unpack(callback.parameters[at].name, elementsAt([array], 0, true)), ...total];
    });
  };
  elementCalls.forEach((call) => record(callbackAssignments(call)));

  /** For each name, the properties already read through it while answering one question. */
  const reading = new Map();
  let reads = 0;
  let mostReads = 0;
  /**
   * Whether `access` reads a duration. A property the file declares holds its own value, whatever else the object
   * holds (`h.n` beside `h.took()`); one it does not, read from a name, is judged over each value given that name,
   * property by property. A name and property already read in this question are skipped, since only whether some
   * path reaches a duration matters: names given each other's properties neither loop nor are searched once per path,
   * while another property of the same name (`walk(node.child)`) is still read.
   */
  const readsDuration = (access) => {
    if (checker.getSymbolAtLocation(access.name)) return holds(durations, access.name);
    return readsProperty(bare(access.expression), access.name.text);
  };
  /** Whether property `key` read through `base` holds a duration; a value that is itself a name, such as an element taken from an array variable, is read through in turn. */
  const readsProperty = (base, key) => {
    if (!ts.isMemberName(base)) return key !== 'length' && measures(base);
    const bindings = bindingsAt(base).filter((binding) => !reading.get(binding)?.has(key));
    bindings.forEach((binding) => reading.set(binding, (reading.get(binding) ?? new Set()).add(key)));
    reads += bindings.length;
    const values = bindings.flatMap((binding) => valuesOf.get(binding) ?? []).map(bare);
    return values.some((value) => ts.isMemberName(value) && readsProperty(value, key))
      || memberOf(values.filter((value) => !ts.isMemberName(value)), key).some(measures);
  };

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
  const measures = (node) => {
    if (ts.isFunctionLike(node)) return returnsOf(node).some(measures);
    if (ts.isPropertyAccessExpression(node)) return readsDuration(node);
    return subtractsClock(node) || holds(durations, node) || ts.forEachChild(node, measures) === true;
  };
  /** Whether `node` measures a duration, as one question with nothing yet read. */
  const answers = (node) => {
    reading.clear();
    reads = 0;
    const found = measures(node);
    mostReads = Math.max(mostReads, reads);
    return found;
  };
  // Until nothing changes, so a duration handed from name to name is followed to the end.
  for (let size = -1; size !== durations.size;) {
    size = durations.size;
    durations = bindingsOf(assignments.filter(({ value }) => answers(value)));
  }

  const lines = source.split('\n');
  const budgets = expects
    .filter((call) => answers(call.arguments[0]))
    .map((call) => {
      const line = sourceFile.getLineAndCharacterOfPosition(call.getStart()).line;
      return { line: line + 1, text: lines[line].trim() };
    });
  return { budgets, mostReads };
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

  it('finds a duration returned by a class or object method (#1104)', () => {
    expect(wallClockBudgets('class A { took() { return Date.now() - s; } }\nexpect(new A().took()).toBeLessThan(5);')).toHaveLength(1);
    expect(wallClockBudgets('const h = { took() { return Date.now() - s; } };\nexpect(h.took()).toBeLessThan(5);')).toHaveLength(1);
  });

  it('judges an object property by its own value, not by a duration beside it (#1104)', () => {
    const h = 'const h = { took() { return Date.now() - s; }, n: 3 };';
    expect(wallClockBudgets(`${h}\nexpect(h.n).toBe(3);`)).toEqual([]);
    expect(wallClockBudgets(`${h}\nconst { n } = h;\nexpect(n).toBe(3);`)).toEqual([]);
  });

  it('finds a duration passed as an argument and asserted inside the function (#1104)', () => {
    const forms = {
      'a function declaration': 'function check(d) { expect(d).toBeLessThan(5); }',
      'an arrow': 'const check = (d) => { expect(d).toBeLessThan(5); };',
      'a rest parameter': 'function check(...ds) { expect(ds[0]).toBeLessThan(5); }',
    };
    for (const [form, helper] of Object.entries(forms)) {
      expect(wallClockBudgets(`${helper}\ncheck(Date.now() - s);`), form).toHaveLength(1);
    }
    const method = 'class C { check(d) { expect(d).toBeLessThan(5); } }\nnew C().check(Date.now() - s);';
    expect(wallClockBudgets(method)).toHaveLength(1);
  });

  it('finds a duration taken by nested destructuring, from a variable, or by assignment (#1104)', () => {
    const start = 'const duration = Date.now() - s;';
    const forms = {
      'a nested array': 'const [[x]] = [[duration]];\nexpect(x).toBeLessThan(5);',
      'a nested object': 'const { a: { b } } = { a: { b: duration } };\nexpect(b).toBeLessThan(5);',
      'an array variable': 'const t = [duration];\nconst [x] = t;\nexpect(x).toBeLessThan(5);',
      'an object variable': 'const o = { a: duration };\nconst { a } = o;\nexpect(a).toBeLessThan(5);',
      'an array assignment': 'let x;\n[x] = [duration];\nexpect(x).toBeLessThan(5);',
      'an object assignment': 'let a;\n({ a } = { a: duration });\nexpect(a).toBeLessThan(5);',
      'a nested assignment': 'let x;\n[[x]] = [[duration]];\nexpect(x).toBeLessThan(5);',
    };
    for (const [form, rest] of Object.entries(forms)) {
      expect(wallClockBudgets(`${start}\n${rest}`), form).toHaveLength(1);
    }
  });

  it('does not flag a name destructured beside a duration by assignment or from a variable (#1104)', () => {
    const start = 'const duration = Date.now() - s;';
    expect(wallClockBudgets(`${start}\nlet d, n;\n[d, n] = [duration, 3];\nexpect(n).toBe(3);`)).toEqual([]);
    expect(wallClockBudgets(`${start}\nconst o = { a: duration, n: 3 };\nconst { n } = o;\nexpect(n).toBe(3);`)).toEqual([]);
  });

  it('finds a duration returned by an object or class getter (#1104)', () => {
    expect(wallClockBudgets('const h = { get took() { return Date.now() - s; } };\nexpect(h.took).toBeLessThan(5);')).toHaveLength(1);
    expect(wallClockBudgets('class A { get took() { return Date.now() - s; } }\nexpect(new A().took).toBeLessThan(5);')).toHaveLength(1);
  });

  it('judges a property of a parameter by the value passed for it, not by the whole object (#1104)', () => {
    const helper = 'function f(o) { expect(o.n).toBe(3); }';
    expect(wallClockBudgets(`${helper}\nf({ t: Date.now() - s, n: 3 });`, 'x.test.mjs')).toEqual([]);
    expect(wallClockBudgets(`${helper}\nf({ t: 0, n: Date.now() - s });`, 'x.test.mjs')).toHaveLength(1);
  });

  it('follows a name passed one of its own properties without looping or losing the duration (#1104)', () => {
    const walk = 'function walk(node) { expect(node.ms).toBeLessThan(5); if (node.child) walk(node.child); }';
    for (const file of ['x.test.ts', 'x.test.mjs']) {
      expect(wallClockBudgets(`${walk}\nwalk({ child: { ms: Date.now() - s } });`, file)).toHaveLength(1);
      expect(wallClockBudgets(`${walk}\nwalk({ child: { ms: 3 } });`, file)).toEqual([]);
    }
    const swap = 'function f(a, c) { expect(a.x).toBeLessThan(5); f(c.y, a.z); }\nf({ z: Date.now() - s }, 0);';
    expect(wallClockBudgets(swap, 'x.test.mjs')).toHaveLength(1);
  });

  it('searches a name fed back its own many properties once per name and property, not once per path (#1104)', () => {
    const children = Array.from({ length: 6 }, (_, at) => `walk(node.p${at});`).join(' ');
    const walk = `const s = Date.now();\nfunction walk(node) { expect(node.ms).toBeLessThan(5); ${children} }`;
    const scan = scanForBudgets(`${walk}\nwalk({ ms: 3 });`, 'x.test.mjs');
    expect(scan.budgets).toEqual([]);
    // `node` read through 7 properties needs at most 7 reads; kept small because a per-path search needs about 2000 here and hangs at 12.
    expect(scan.mostReads).toBeLessThanOrEqual(7);
    expect(wallClockBudgets(`${walk}\nwalk({ p5: { ms: Date.now() - s } });`, 'x.test.mjs')).toHaveLength(1);
  });

  it('takes an array held in a variable whole, since its positions are unknown (#1104)', () => {
    const source = 'const t = [Date.now() - s, 3];\nconst [, n] = t;\nexpect(n).toBe(3);';
    expect(wallClockBudgets(source)).toHaveLength(1);
  });

  it('finds a budget asserted with vi.expect (#1104)', () => {
    expect(wallClockBudgets('vi.expect(Date.now() - start).toBeLessThan(500);')).toHaveLength(1);
  });

  it('does not flag a wait-loop helper that reads the clock but returns no duration (#1104)', () => {
    const method = 'class H { wait() { const s = Date.now(); while (Date.now() - s < 5) {} return done; } }';
    expect(wallClockBudgets(`${method}\nexpect(new H().wait()).toBe(true);`)).toEqual([]);
    const deadline = 'function waitUntil(end) { while (Date.now() < end) {} return done; }';
    expect(wallClockBudgets(`${deadline}\nexpect(waitUntil(Date.now() + 5)).toBe(true);`)).toEqual([]);
  });

  it('finds durations pushed into an array and asserted through Math.max (#1130)', () => {
    const source = [
      'const times = [];',
      'for (let i = 0; i < 10; i++) { const t = performance.now(); work(); times.push(performance.now() - t); }',
      'expect(Math.max(...times)).toBeLessThan(50);',
    ].join('\n');
    expect(wallClockBudgets(source)).toHaveLength(1);
  });

  it('finds a duration taken by an array callback (#1130)', () => {
    expect(wallClockBudgets('const d = Date.now() - s;\n[d].forEach((x) => expect(x).toBeLessThan(5));')).toHaveLength(1);
    expect(wallClockBudgets('const ds = [Date.now() - s];\nds.map((x) => { expect(x).toBeLessThan(5); });')).toHaveLength(1);
  });

  it('finds a duration taken by a for-of over a durations array (#1130)', () => {
    const source = ['const durations = [];', 'durations.push(Date.now() - s);', 'for (const x of durations) expect(x).toBeLessThan(5);'];
    expect(wallClockBudgets(source.join('\n'))).toHaveLength(1);
  });

  it('does not flag an array of counts asserted beside a clock read (#1130)', () => {
    const source = [
      'const calls = [];',
      'const t = performance.now();',
      'for (const n of [1, 2]) calls.push(n);',
      'calls.forEach((c) => expect(c).toBeLessThan(5));',
      'expect(Math.max(...calls)).toBeLessThan(5);',
    ].join('\n');
    expect(wallClockBudgets(source)).toEqual([]);
  });

  it('finds a duration taken by an element callback passed by name (#1157)', () => {
    const pushed = 'const ds = [];\nds.push(Date.now() - s);';
    const helpers = {
      'a function declaration': 'function check(x) { expect(x).toBeLessThan(5); }',
      'a const arrow': 'const check = (x) => { expect(x).toBeLessThan(5); };',
    };
    for (const [form, helper] of Object.entries(helpers)) {
      expect(wallClockBudgets(`${helper}\n${pushed}\nds.forEach(check);`), form).toHaveLength(1);
      expect(wallClockBudgets(`${helper}\nconst t0 = Date.now();\n[1, 2].forEach(check);`), form).toEqual([]);
    }
  });

  it('finds a duration taken by reduce as its element or its running total (#1157)', () => {
    const pushed = 'const ds = [];\nds.push(Date.now() - s);';
    const element = 'ds.reduce((total, d) => { expect(d).toBeLessThan(5); return total + d; }, 0);';
    const total = 'ds.reduce((total, d) => { expect(total).toBeLessThan(5); return total + d; }, 0);';
    expect(wallClockBudgets(`${pushed}\n${element}`)).toHaveLength(1);
    expect(wallClockBudgets(`${pushed}\n${total}`)).toHaveLength(1);
    const counts = 'const t0 = Date.now();\n[1, 2].reduce((total, c) => { expect(c).toBe(1); return total + c; }, 0);';
    expect(wallClockBudgets(counts)).toEqual([]);
  });

  it('judges a property of a pushed object by its own value, and an array length as a count (#1157)', () => {
    const records = "const rs = [];\nrs.push({ ms: Date.now() - s, name: 'a' });";
    expect(wallClockBudgets(`${records}\nfor (const r of rs) expect(r.name).toBe('a');`)).toEqual([]);
    expect(wallClockBudgets(`${records}\nrs.forEach((r) => expect(r.name).toBe('a'));`)).toEqual([]);
    expect(wallClockBudgets(`${records}\nfor (const r of rs) expect(r.ms).toBeLessThan(5);`)).toHaveLength(1);
    expect(wallClockBudgets('const ds = [];\nds.push(Date.now() - s);\nexpect(ds.length).toBe(1);')).toEqual([]);
    // A `length` the file itself declares is judged by its own value, not taken for a count.
    expect(wallClockBudgets('const o = { length: Date.now() - s };\nexpect(o.length).toBeLessThan(5);')).toHaveLength(1);
  });

  it('judges the same array name per scope, durations in one function and counts in another (#1157)', () => {
    const source = [
      'function timed() { const xs = []; xs.push(Date.now() - s); record(xs); }',
      'function counted() { const xs = []; xs.push(3); for (const x of xs) expect(x).toBe(3); expect(Math.max(...xs)).toBe(3); }',
    ].join('\n');
    expect(wallClockBudgets(source)).toEqual([]);
  });

  it('finds a duration taken by an element callback passed as a method (#1168)', () => {
    const pushed = 'const ds = [];\nds.push(Date.now() - s);';
    const helpers = {
      'a method': 'const h = { check(x) { expect(x).toBeLessThan(5); } };',
      'an arrow property': 'const h = { check: (x) => { expect(x).toBeLessThan(5); } };',
    };
    for (const [form, helper] of Object.entries(helpers)) {
      expect(wallClockBudgets(`${helper}\n${pushed}\nds.forEach(h.check);`), form).toHaveLength(1);
      expect(wallClockBudgets(`${helper}\nconst t0 = Date.now();\n[1, 2].forEach(h.check);`), form).toEqual([]);
    }
  });

  it('finds a duration taken by an element callback named through another variable (#1168)', () => {
    const pushed = 'const ds = [];\nds.push(Date.now() - s);';
    const helper = 'const c = (x) => { expect(x).toBeLessThan(5); };\nconst d = c;';
    expect(wallClockBudgets(`${helper}\n${pushed}\nds.forEach(d);`)).toHaveLength(1);
    expect(wallClockBudgets(`${helper}\nconst t0 = Date.now();\n[1, 2].forEach(d);`)).toEqual([]);
    // Names that only name each other hold no function, and must not loop.
    expect(wallClockBudgets(`let a = b;\nlet b = a;\n${pushed}\nds.forEach(a);`)).toEqual([]);
  });

  it('finds a duration taken by an element callback passed through a parameter (#1168)', () => {
    const pushed = 'const ds = [];\nds.push(Date.now() - s);';
    const helpers = 'function check(x) { expect(x).toBeLessThan(5); }\nfunction run(xs, cb) { xs.forEach(cb); }';
    expect(wallClockBudgets(`${helpers}\n${pushed}\nrun(ds, check);`)).toHaveLength(1);
    expect(wallClockBudgets(`${helpers}\nconst t0 = Date.now();\nrun([1, 2], check);`)).toEqual([]);
  });

  it('follows a duration an element callback pushes into another array (#1168)', () => {
    // The callback's parameter is resolved after the push that reads it is recorded.
    const source = 'const ds = [];\nds.push(Date.now() - s);\nconst out = [];\nds.forEach((x) => out.push(x));\nexpect(out[0]).toBeLessThan(5);';
    expect(wallClockBudgets(source)).toHaveLength(1);
  });

  it('judges a length passed in an object by its own value, and a length read from a whole array as a count (#1168)', () => {
    const helper = 'function f(o) { expect(o.length).toBeLessThan(5); }';
    for (const file of ['x.test.ts', 'x.test.mjs']) {
      expect(wallClockBudgets(`${helper}\nf({ length: Date.now() - s });`, file), file).toHaveLength(1);
      expect(wallClockBudgets(`${helper}\nconst ds = [];\nds.push(Date.now() - s);\nf(ds);`, file), file).toEqual([]);
    }
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
