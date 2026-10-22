/**
 * A test that reads a repository file by its path also links that file, so `vitest run --changed` runs the test
 * when the file alone changes (#1418).
 *
 * `agent-policy verify` runs the tests `--changed` picks, and vitest picks a test by the files it imports at run
 * time. `src-linked-to-tests.test.mjs` holds only that *some* test imports each file, so a test that reads a file
 * another test imports was skipped by a change to that file. The test links what it reads with
 * `import.meta.glob('./file')`, which loads nothing. A glob with a query (`{ query: '?raw' }`) does not link:
 * vitest 3 drops every import that carries one.
 *
 * This scan finds `readFileSync` and `readFile` calls in tests whose path the file's own constants spell out
 * (`join(ROOT, 'src', 'x.ts')`, `new URL('./x.ts', import.meta.url)`), and asks vitest which tests `--changed`
 * picks for each file read, following an `export const` imported from another file. A path built at run time
 * (a parameter, a loop over a list) is not seen.
 */
import { describe, it, expect } from 'vitest';
import { createVitest } from 'vitest/node';
import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { trackedTestFiles } from './tracked-tests.test-helper.mjs';
import { tempTree } from '../src/testing/temp-tree.test-helper.ts';

// Links this guard to the tests it scans and the code their imports reach, so `--changed` runs it when one changes; nothing loads.
import.meta.glob(['/src/**', '!/src/**/*.md', '/docs/**/*.test.ts', '/scripts/**/*.test.mjs']);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const OPTIONS = { noLib: true, noResolve: true, types: [], allowJs: true };
/** A checker over `sourceFile` alone, used only to resolve each name to the declaration it refers to. */
function checkerFor(sourceFile) {
  const host = ts.createCompilerHost(OPTIONS);
  host.getSourceFile = (fileName) => (fileName === sourceFile.fileName ? sourceFile : undefined);
  return ts.createProgram([sourceFile.fileName], OPTIONS, host).getTypeChecker();
}

const PATH_CALLS = { join, resolve, dirname };
const IMPORT_META = { url: (file) => pathToFileURL(file), dirname, filename: (file) => file };
const nameOf = (callee) => (ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined);
const WRAPPERS = [ts.isParenthesizedExpression, ts.isAsExpression, ts.isSatisfiesExpression, ts.isNonNullExpression];
const unwrap = (node) => (WRAPPERS.some((is) => is(node)) ? unwrap(node.expression) : node);
const isImportMeta = (node) =>
  ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression) && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword;
const isNewUrl = (node) => ts.isNewExpression(node) && nameOf(node.expression) === 'URL' && node.arguments?.length === 2;
const isExported = (node) => node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
/** The `export const` declaration of `name` in a file. */
const exportedConst = (sourceFile, name) =>
  sourceFile.statements
    .filter((node) => ts.isVariableStatement(node) && isExported(node))
    .flatMap((node) => node.declarationList.declarations)
    .find((node) => ts.isIdentifier(node.name) && node.name.text === name);

// The files tests import constants from, each parsed once.
const imports = new Map();
const parsedImport = (file) => {
  if (!imports.has(file)) imports.set(file, evaluatorFor(file, readFileSync(file, 'utf-8')));
  return imports.get(file);
};

/** What each expression in one file always holds: a string, a URL, or undefined when it is built at run time. */
function evaluatorFor(fileName, source) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const checker = checkerFor(sourceFile);
  const following = new Set();
  const held = (declaration) => {
    if (!ts.isVariableDeclaration(declaration) || !declaration.initializer || following.has(declaration)) return undefined;
    if (!(ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const)) return undefined;
    following.add(declaration);
    const result = value(declaration.initializer);
    following.delete(declaration);
    return result;
  };
  /** An `export const` of the repository file an import specifier names. */
  const imported = (specifier) => {
    const from = specifier.parent.parent.parent.moduleSpecifier.text;
    if (!from.startsWith('.')) return undefined;
    const target = [from.replace(/\.js$/, '.ts'), from].map((path) => resolve(dirname(fileName), path)).find((path) => existsSync(path));
    if (!target) return undefined;
    const other = parsedImport(target);
    const declaration = exportedConst(other.sourceFile, (specifier.propertyName ?? specifier.name).text);
    return declaration && other.held(declaration);
  };
  const template = (node) => {
    const parts = [node.head.text, ...node.templateSpans.flatMap((span) => [value(span.expression), span.literal.text])];
    return parts.every((part) => typeof part === 'string') ? parts.join('') : undefined;
  };
  const identifier = (node) => {
    const [declaration] = checker.getSymbolAtLocation(node)?.declarations ?? [];
    // vite-node gives every module its own `__dirname` and `__filename`.
    if (!declaration) return { __dirname: dirname(fileName), __filename: fileName }[node.text];
    return ts.isImportSpecifier(declaration) ? imported(declaration) : held(declaration);
  };
  const newUrl = (node) => {
    const [spec, base] = node.arguments.map(value);
    return typeof spec === 'string' && base instanceof URL ? new URL(spec, base) : undefined;
  };
  const call = (node) => {
    const name = nameOf(node.expression);
    const args = node.arguments.map(value);
    if (name === 'fileURLToPath') return args[0] instanceof URL ? fileURLToPath(args[0]) : undefined;
    const pathCall = Object.hasOwn(PATH_CALLS, name) && args.every((arg) => typeof arg === 'string') && isAbsolute(args[0] ?? '');
    return pathCall ? PATH_CALLS[name](...args) : undefined;
  };
  const KINDS = [
    [ts.isStringLiteralLike, (node) => node.text],
    [ts.isTemplateExpression, template],
    [isImportMeta, (node) => IMPORT_META[node.name.text]?.(fileName)],
    [ts.isIdentifier, identifier],
    [isNewUrl, newUrl],
    [ts.isCallExpression, call],
  ];
  const value = (node) => {
    const bare = unwrap(node);
    return KINDS.find(([is]) => is(bare))?.[1](bare);
  };
  return { sourceFile, value, held };
}

/** The absolute paths a source reads with `readFileSync` or `readFile`, where its constants spell the path out. */
function readsOf(fileName, source) {
  if (!source.includes('readFile')) return [];
  const { sourceFile, value } = evaluatorFor(fileName, source);
  const reads = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ['readFileSync', 'readFile'].includes(nameOf(node.expression)) && node.arguments.length) {
      const read = value(node.arguments[0]);
      if (read instanceof URL && read.protocol === 'file:') reads.push(fileURLToPath(read));
      else if (typeof read === 'string' && isAbsolute(read)) reads.push(read);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return reads;
}

describe('readsOf: the files a test reads by a path it spells out (#1418)', () => {
  const FILE = join(ROOT, 'src', 'cli', 'x.test.ts');
  const reads = (source) => readsOf(FILE, source);

  it('follows constants built from the test file’s own location', () => {
    const source = [
      "const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');",
      "const SRC = join(ROOT, 'src');",
      "readFileSync(join(SRC, 'session', 'types.ts'), 'utf-8');",
    ].join('\n');
    expect(reads(source)).toEqual([join(ROOT, 'src', 'session', 'types.ts')]);
  });

  it('reads every way a test spells its own folder', () => {
    expect(reads("fs.readFileSync(path.join(import.meta.dirname, '../a.ts'));")).toEqual([join(ROOT, 'src', 'a.ts')]);
    expect(reads("readFileSync(resolve(__dirname, 'a.ts'));")).toEqual([join(ROOT, 'src', 'cli', 'a.ts')]);
    expect(reads("await fs.promises.readFile(new URL('./a.ts', import.meta.url));")).toEqual([join(ROOT, 'src', 'cli', 'a.ts')]);
    expect(reads("const here = dirname(import.meta.filename);\nawait readFile(`${here}/a.ts`);")).toEqual([join(ROOT, 'src', 'cli', 'a.ts')]);
  });

  it('resolves a name to the declaration in scope, not a same-named one elsewhere', () => {
    const source = [
      "const DIR = join(import.meta.dirname, 'outer');",
      "function f() { const DIR = join(import.meta.dirname, 'inner'); readFileSync(join(DIR, 'a.ts')); }",
    ].join('\n');
    expect(reads(source)).toEqual([join(ROOT, 'src', 'cli', 'inner', 'a.ts')]);
  });

  it('follows a constant another file in the repository exports', () => {
    const dir = tempTree('bs-reads-linked-');
    writeFileSync(join(dir, 'root.test-helper.ts'), "export const REPO_ROOT = join(import.meta.dirname, 'repo');\n");
    const source = "import { REPO_ROOT as REPO } from './root.test-helper.js';\nreadFileSync(join(REPO, 'a.ts'));";
    expect(readsOf(join(dir, 'x.test.ts'), source)).toEqual([join(dir, 'repo', 'a.ts')]);
  });

  it('leaves out a path it cannot spell out', () => {
    const unseen = [
      "const read = (name) => readFileSync(join(import.meta.dirname, name));",
      "for (const name of ['a.ts']) readFileSync(join(import.meta.dirname, name));",
      "let dir = import.meta.dirname;\nreadFileSync(join(dir, 'a.ts'));",
      "import { REPO_ROOT } from './root.js';\nreadFileSync(join(REPO_ROOT, 'a.ts'));",
      "readFileSync(join(process.cwd(), 'a.ts'));",
      "readFileSync('a.ts');",
    ];
    for (const source of unseen) expect(reads(source), source).toEqual([]);
  });
});

const tracked = new Set(execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf-8' }).split('\0'));
const reads = trackedTestFiles(['src', 'docs', 'scripts']).flatMap(({ path, text }) =>
  [...new Set(readsOf(join(ROOT, path), text).map((file) => relative(ROOT, file)))]
    .filter((file) => file !== path && tracked.has(file))
    .map((file) => ({ test: path, file })),
);

// Asks vitest whether `--changed` picks each test for each file it reads, here where no test timeout applies (#354).
const vitest = await createVitest('test', { watch: false }, { root: ROOT });
const unlinked = [];
for (const { test, file } of reads) {
  vitest.config.related = [join(ROOT, file)];
  const picked = await vitest.getRelevantTestSpecifications([join(ROOT, test)]);
  if (!picked.some((spec) => spec.moduleId === join(ROOT, test))) unlinked.push(`${test} reads ${file}`);
}
await vitest.close();

describe('the files tests read by path (#1418)', () => {
  it('has every repository file a test reads by a path it spells out linked from that test', () => {
    expect(
      unlinked,
      'A change to only one of these files does not run the test that reads it, so verify can pass with that test ' +
        "red. Add `import.meta.glob('<path to the file, relative to the test>');` to the test (a glob with " +
        "`{ query: '?raw' }` does not link), or import the file if loading it is harmless.",
    ).toEqual([]);
  });
});
