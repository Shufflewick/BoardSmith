import ts from 'typescript';

/**
 * Whether an edit to a vitest config changed only which test files are collected (#479).
 *
 * `chunk-merge` vouches for a config edit with the signed chunks' own tests only when the edit can
 * change nothing but which files run: the run then shows every one of the chunk's files ran, and
 * only those, and that they passed. Any other edit (an alias that stubs a module, a setup file that
 * mocks one, a different environment) can make a test pass without the code it tests, so it voids
 * the sign-off as any other edit does.
 *
 * Both versions are parsed. Each `include` / `exclude` of the config's own `test` object is read
 * only when its value is plain data, so nothing in it can run: a list of string literals, template
 * strings without expressions, and spreads of vitest's own `configDefaults.include` /
 * `configDefaults.exclude`. Any other value, in either version, means the edit is not only a
 * collection change. Those properties taken out, the rest of the two files must be the same tokens,
 * comments and layout aside. A file that does not parse, or anything not recognised, is refused.
 */
export function onlyTestCollectionChanged(before: string, after: string): boolean {
  const a = tokensOutsideCollection(before);
  const b = tokensOutsideCollection(after);
  return a !== undefined && b !== undefined && a.length === b.length && a.every((token, i) => token === b[i]);
}

const COLLECTION_KEYS = new Set(['include', 'exclude']);

/** The vitest and vite helpers whose object argument is a config, and where they come from. */
const CONFIG_MODULES = new Set(['vitest/config', 'vite']);
const CONFIG_HELPERS = new Set(['defineConfig', 'mergeConfig', 'defineProject']);

function keyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

/** How many times the file declares each name, at any depth (a parameter, a variable, an import). */
function declarationCounts(source: ts.SourceFile): Map<string, number> {
  const declared = new Map<string, number>();
  const visit = (node: ts.Node): void => {
    const name = (node as { name?: ts.Node }).name;
    if (name && ts.isIdentifier(name) && ts.isDeclaration(node)) declared.set(name.text, (declared.get(name.text) ?? 0) + 1);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return declared;
}

/** The value imports `statement` binds from vitest or vite, as `[local name, exported name]`. */
function configModuleImports(statement: ts.Statement): Array<[string, string]> {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return [];
  const bindings = statement.importClause?.namedBindings;
  if (!CONFIG_MODULES.has(statement.moduleSpecifier.text) || statement.importClause?.isTypeOnly) return [];
  if (!bindings || !ts.isNamedImports(bindings)) return [];
  return bindings.elements.filter((e) => !e.isTypeOnly).map((e) => [e.name.text, (e.propertyName ?? e.name).text]);
}

/**
 * Each local name bound by a value import from vitest or vite, with the name it was exported as,
 * but only when nothing else in the file declares the same name (a parameter or variable that
 * could shadow it where the config is written).
 */
function trustedImports(source: ts.SourceFile): Map<string, string> {
  const declared = declarationCounts(source);
  return new Map(source.statements.flatMap(configModuleImports).filter(([local]) => declared.get(local) === 1));
}

/** Whether `object` is a vitest config: the default export, or the argument of vitest's or vite's config helpers. */
function isConfigObject(object: ts.ObjectLiteralExpression, imports: Map<string, string>): boolean {
  const parent = object.parent;
  if (ts.isExportAssignment(parent)) return !parent.isExportEquals;
  return (
    ts.isCallExpression(parent) &&
    parent.arguments.includes(object) &&
    ts.isIdentifier(parent.expression) &&
    CONFIG_HELPERS.has(imports.get(parent.expression.text) ?? '')
  );
}

/** Whether `node` is `configDefaults.include` or `configDefaults.exclude`, with `configDefaults` vitest's own. */
function isVitestDefaultList(node: ts.Expression, imports: Map<string, string>): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    !node.questionDotToken &&
    COLLECTION_KEYS.has(node.name.text) &&
    ts.isIdentifier(node.expression) &&
    imports.get(node.expression.text) === 'configDefaults'
  );
}

/** Whether `value` is a list whose evaluation can run no code. */
function isPlainList(value: ts.Expression, imports: Map<string, string>): boolean {
  return (
    ts.isArrayLiteralExpression(value) &&
    value.elements.every(
      (e) =>
        ts.isStringLiteral(e) ||
        ts.isNoSubstitutionTemplateLiteral(e) ||
        (ts.isSpreadElement(e) && isVitestDefaultList(e.expression, imports)),
    )
  );
}

/**
 * Every `include` / `exclude` property of the config's own `test` object, or `undefined` when one
 * of them holds a value that is not plain data.
 */
function collectionProperties(source: ts.SourceFile): Set<ts.Node> | undefined {
  const imports = trustedImports(source);
  const found = new Set<ts.Node>();
  let plain = true;
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && COLLECTION_KEYS.has(keyName(node.name) ?? '')) {
      const test = node.parent.parent;
      if (
        ts.isPropertyAssignment(test) &&
        keyName(test.name) === 'test' &&
        ts.isObjectLiteralExpression(test.parent) &&
        isConfigObject(test.parent, imports)
      ) {
        found.add(node);
        if (!isPlainList(node.initializer, imports)) plain = false;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return plain ? found : undefined;
}

/**
 * The file's tokens, comments aside, with its collection properties left out, and a single `,`
 * between an object's remaining members (so a comma left behind, or a trailing one, says nothing).
 * `undefined` when the file does not parse or a collection value is not plain data.
 */
function tokensOutsideCollection(text: string): string[] | undefined {
  const { diagnostics } = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.Latest } });
  if (diagnostics?.length) return undefined;
  const source = ts.createSourceFile('vitest.config.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const removed = collectionProperties(source);
  if (removed === undefined) return undefined;
  const tokens: string[] = [];
  const emit = (node: ts.Node): void => {
    if (ts.isJSDoc(node)) return;
    if (ts.isObjectLiteralExpression(node)) {
      tokens.push('{');
      node.properties.filter((p) => !removed.has(p)).forEach((p, i) => {
        if (i > 0) tokens.push(',');
        emit(p);
      });
      tokens.push('}');
      return;
    }
    const children = node.getChildren(source);
    if (children.length === 0) {
      if (node.kind !== ts.SyntaxKind.EndOfFileToken) tokens.push(node.getText(source));
      return;
    }
    children.forEach(emit);
  };
  emit(source);
  return tokens;
}
