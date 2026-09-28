/**
 * A test whose fixture program writes to a path it is handed runs that program
 * in a fixture sandbox (#430).
 *
 * In #430 the fake `boardsmith test` in the old merge script's test wrote
 * its planted verdict to `argv[indexOf('--verdict-file') + 1]`. With the flag
 * missing that is `argv[0]`, and the machine's real `node` was overwritten.
 * `fixtureSandbox` (`src/testing/fixture-sandbox.test-helper.ts`) runs such a
 * program where it can write only inside its own temp tree. This scan fails on
 * a test file that writes a program which both writes files and reads a path
 * from outside itself (`process.argv`, `process.env`, a quoted shell `"$1"`),
 * unless the file uses `fixtureSandbox`.
 *
 * It reads the strings a test spells a program in (parsed, so a quote or a
 * backtick in a comment is not mistaken for one). A program written some
 * other way (read from a fixture file on disk) is not seen, and neither is a
 * test that imports the sandbox but forgets to pass its env to one spawn; the
 * sandbox's own tests say what it guarantees.
 */
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { trackedTestFiles } from './tracked-tests.test-helper.mjs';

const WRITES = /\b(?:writeFileSync|appendFileSync|writeFile|appendFile|createWriteStream)\(|(?<![=-])>>?\s*"\$/;
const HANDED = /process\.(?:argv|env)\b|"\$\{?[\w@*]/;

/** The parts `node` joins into one string, each read by `stringText`, or undefined when it joins none. */
function joinedParts(node) {
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return { parts: [node.left, node.right], separator: '' };
  }
  if (ts.isArrayLiteralExpression(node) && node.elements.length > 0) return { parts: node.elements, separator: '\n' };
  return undefined;
}

/** The text `node` spells, or undefined when it is not made only of strings. */
function stringText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join('');
  if (ts.isParenthesizedExpression(node)) return stringText(node.expression);
  const joined = joinedParts(node);
  if (!joined) return undefined;
  const texts = joined.parts.map(stringText);
  return texts.includes(undefined) ? undefined : texts.join(joined.separator);
}

/**
 * The text of every program a source spells out in strings: one string
 * literal, template, `+` chain of them or array of them is one program.
 */
function programs(source) {
  const found = [];
  const visit = (node) => {
    const program = stringText(node);
    if (program === undefined) ts.forEachChild(node, visit);
    else found.push(program);
  };
  visit(ts.createSourceFile('scanned.ts', source, ts.ScriptTarget.Latest, false));
  return found;
}

/** Whether a test source writes a program that writes to a path handed to it, outside a sandbox. */
function unsandboxedWritingFixture(source) {
  const writing = programs(source).some((program) => WRITES.test(program) && HANDED.test(program));
  return writing && !/\bfixtureSandbox\(/.test(source);
}

describe('unsandboxedWritingFixture', () => {
  it('finds the #430 stub: a program that writes to the path after --verdict-file', () => {
    const source = [
      'writeFileSync(stub,',
      "  \"const at = process.argv.indexOf('--verdict-file');\\n\" +",
      "  \"writeFileSync(process.argv[at + 1], 'planted');\\n\",",
      ');',
    ].join('\n');
    expect(unsandboxedWritingFixture(source)).toBe(true);
  });

  it('finds a shell stub that writes to its first argument', () => {
    expect(unsandboxedWritingFixture("writeLocalBin('tool', 'echo done > \"$1\"');")).toBe(true);
  });

  it('accepts the same program run in a fixture sandbox', () => {
    const source = [
      "const sandbox = fixtureSandbox('bs-x-');",
      "writeFileSync(stub, \"writeFileSync(process.env.OUT, 'x');\");",
    ].join('\n');
    expect(unsandboxedWritingFixture(source)).toBe(false);
  });

  it('leaves alone a program that writes only to a path it names itself', () => {
    expect(unsandboxedWritingFixture("const test = \"writeFileSync('slow-started', '');\";")).toBe(false);
  });
});

describe('the test suite (#430)', () => {
  it('runs every fixture program that writes to a path it is handed in a fixture sandbox', () => {
    const findings = trackedTestFiles(['src', 'scripts'])
      // This file's own examples above are unsandboxed on purpose.
      .filter(({ path, text }) => path !== 'scripts/fixture-writes-sandboxed.test.mjs' && unsandboxedWritingFixture(text))
      .map(({ path }) => path);
    expect(
      findings,
      'These tests write a program that writes to a path it is handed, and run it where it can write anywhere. '
        + 'Build the fixture under fixtureSandbox(...).root and run it with that sandbox\'s env '
        + '(src/testing/fixture-sandbox.test-helper.ts), so a wrong path fails instead of overwriting a real file.',
    ).toEqual([]);
  });
});
