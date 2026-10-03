import ts from 'typescript';

/**
 * Whether an edit to a vitest config changed only which test files are collected (#479).
 *
 * `chunk-merge` vouches for a config edit with the signed chunks' own tests only when the edit can
 * change nothing but which files run: the run then shows every one of the chunk's files still ran
 * and passed. Any other edit (an alias that stubs a module, a setup file that mocks one, a different
 * environment) can make a test pass without the code it tests, so it voids the sign-off as any
 * other edit does.
 *
 * The two versions are compared as TypeScript tokens, comments and whitespace aside, with every
 * `include` or `exclude` property of a `test` object taken out. Equal token streams mean the edit
 * touched nothing else.
 */
export function onlyTestCollectionChanged(before: string, after: string): boolean {
  const a = tokensOutsideCollection(before);
  const b = tokensOutsideCollection(after);
  return a.length === b.length && a.every((token, i) => token === b[i]);
}

const COLLECTION_KEYS = new Set(['include', 'exclude']);

function propertyName(node: ts.PropertyAssignment, source: ts.SourceFile): string {
  return ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : node.name.getText(source);
}

/** `[start, end)` of every `include` / `exclude` property directly inside a `test: { ... }` object. */
function collectionSpans(source: ts.SourceFile): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && COLLECTION_KEYS.has(propertyName(node, source))) {
      const owner = node.parent.parent;
      if (ts.isPropertyAssignment(owner) && propertyName(owner, source) === 'test') spans.push([node.getStart(source), node.end]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return spans;
}

/** The config's tokens, comments and whitespace aside, with its collection properties and their commas taken out. */
function tokensOutsideCollection(text: string): string[] {
  const source = ts.createSourceFile('vitest.config.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const spans = collectionSpans(source);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const tokens: string[] = [];
  let afterSpan = false;
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    const start = scanner.getTokenStart();
    const span = spans.find(([from, to]) => start >= from && start < to);
    if (span) {
      afterSpan = true;
      continue;
    }
    // The comma after a removed property, and one left trailing before a closing brace, say nothing.
    if (kind === ts.SyntaxKind.CommaToken && afterSpan) continue;
    afterSpan = false;
    if (kind === ts.SyntaxKind.CloseBraceToken && tokens.at(-1) === ',') tokens.pop();
    tokens.push(scanner.getTokenText());
  }
  return tokens;
}
