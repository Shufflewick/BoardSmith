/**
 * No test loads a module with `import()` inside a function unless it says why (#365).
 *
 * A module's first load (compile and evaluation) is slow on a busy machine, and
 * `scripts/merge-branch.sh` runs the suite at load averages past 100. When the
 * first load happens inside a test body, a helper a test calls, or a hook, it
 * counts against that test's timeout, and the test fails with nothing wrong.
 * #354, #355 and #363 were that. A static import, or a top-level `await
 * import()`, does the load while the file is collected, where no test timeout
 * applies.
 *
 * Some loads belong inside the test: a fresh module after `vi.resetModules()`,
 * a module `vi.doMock` has just replaced a dependency of, a file the test
 * itself wrote, or the import being what is under test. Those say so with a
 * comment directly above the statement, such as
 * `// Dynamic import: after vi.resetModules(), so the registry loads fresh.`
 * (see `src/ui/components/dice/die-preview-registry.fresh.test.ts`).
 *
 * The comment covers that statement and the later statements of the same
 * block, so a test that loads two modules after one reset needs it once. This
 * scan reads the syntax tree, so an `import(` inside a string (an ESLint rule's
 * test case) is not a finding, and a `typeof import(...)` type is not a load.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const REASON = /^\/\/\s*Dynamic import:\s*\S/;

function hasReason(sourceFile, statement) {
  const text = sourceFile.getFullText();
  return (ts.getLeadingCommentRanges(text, statement.getFullStart()) ?? []).some((range) =>
    REASON.test(text.slice(range.pos, range.end)),
  );
}

/** The statement holding `node`, and the statements before it in the same block. */
function statementAndPredecessors(node) {
  let statement = node;
  while (statement.parent && !('statements' in statement.parent)) statement = statement.parent;
  const siblings = statement.parent.statements;
  return siblings.slice(0, siblings.indexOf(statement) + 1);
}

/** Every `import()` a source makes inside a function without a `// Dynamic import:` reason. */
function unexplainedDynamicImports(path, source) {
  if (!source.includes('import(')) return [];
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );
  const findings = [];
  const visit = (node, insideFunction) => {
    if (
      insideFunction
      && ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && !statementAndPredecessors(node).some((statement) => hasReason(sourceFile, statement))
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      findings.push({ line: line + 1, text: source.split('\n')[line].trim() });
    }
    ts.forEachChild(node, (child) => visit(child, insideFunction || ts.isFunctionLike(node)));
  };
  visit(sourceFile, false);
  return findings;
}

describe('unexplainedDynamicImports', () => {
  it('finds an import() in a test body', () => {
    const source = [
      "it('loads', async () => {",
      "  const { thing } = await import('./thing.js');",
      '});',
    ].join('\n');
    expect(unexplainedDynamicImports('a.test.ts', source)).toEqual([
      { line: 2, text: "const { thing } = await import('./thing.js');" },
    ]);
  });

  it('finds an import() in a helper a test calls', () => {
    const source = "async function load() { return import('./thing.js'); }";
    expect(unexplainedDynamicImports('a.test.mjs', source)).toHaveLength(1);
  });

  it('leaves a top-level import() alone, because it runs while the file is collected', () => {
    expect(unexplainedDynamicImports('a.test.ts', "const { thing } = await import('./thing.js');")).toEqual([]);
  });

  it('accepts one that says why, and the reason covers the rest of its block', () => {
    const source = [
      "it('loads fresh', async () => {",
      '  vi.resetModules();',
      '  // Dynamic import: after vi.resetModules(), so both load fresh.',
      "  const registry = await import('./registry.js');",
      "  await import('./index.js');",
      '});',
    ].join('\n');
    expect(unexplainedDynamicImports('a.test.ts', source)).toEqual([]);
  });

  it('does not let a reason in one test cover another', () => {
    const source = [
      "it('one', async () => {",
      '  // Dynamic import: the import is what is under test.',
      "  await import('./a.js');",
      '});',
      "it('two', async () => {",
      "  await import('./b.js');",
      '});',
    ].join('\n');
    expect(unexplainedDynamicImports('a.test.ts', source)).toEqual([{ line: 6, text: "await import('./b.js');" }]);
  });

  it('does not count a comment that gives no reason', () => {
    const source = ["it('x', async () => {", '  // Dynamic import:', "  await import('./a.js');", '});'].join('\n');
    expect(unexplainedDynamicImports('a.test.ts', source)).toHaveLength(1);
  });

  it('ignores import( inside a string and a typeof import() type', () => {
    const source = [
      "it('x', async () => {",
      "  const code = `const mod = await import('node:fs');`;",
      "  const actual = await vi.importActual<typeof import('./a.js')>('./a.js');",
      '});',
    ].join('\n');
    expect(unexplainedDynamicImports('a.test.ts', source)).toEqual([]);
  });
});

describe('the test suite (#365)', () => {
  it('loads no module inside a function without saying why', () => {
    const tracked = execFileSync('git', ['ls-files', 'src', 'docs', 'scripts'], { cwd: ROOT, encoding: 'utf-8' })
      .split('\n')
      .filter((path) => /\.test\.(?:ts|mjs)$/.test(path));
    const findings = tracked.flatMap((path) =>
      unexplainedDynamicImports(path, readFileSync(join(ROOT, path), 'utf-8')).map(
        ({ line, text }) => `${path}:${line}  ${text}`,
      ),
    );
    expect(
      findings,
      'These tests load a module inside a function, so the first load counts against a test '
        + 'timeout and fails on a busy machine. Import it at the top of the file (a static import, '
        + 'or a top-level `await import()` when it must follow a stub). If the load has to happen '
        + 'there, put `// Dynamic import: <why>` directly above the statement.',
    ).toEqual([]);
  });
});
