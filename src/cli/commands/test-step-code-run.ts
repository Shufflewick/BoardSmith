/**
 * `test-step-code-run.ts`: whether a test file runs the game's code. `boardsmith test-step-check`
 * asks it of two kinds of file:
 *
 * - A guard (a file under `tests/guards/`, #443) reads source as text, such as the a11y floor's
 *   colour-literal and asset scans, so it is never mutation-tested. A guard that runs the game's
 *   code would be a behaviour test hidden from the mutation check.
 * - A new test file a chunk writes outside its Spec Manifest is never mutation-tested either, so one
 *   that runs the game's code must be a manifest row (#485).
 *
 * A file runs the game's code when it imports a `.vue` component, `@vue/test-utils` or
 * `boardsmith/testing`, uses `renderAsSeat`, dispatches an action, or loads any module from the
 * game's `src/` other than as text (an import ending `?raw`), directly or through a support file
 * under `tests/`. Loading counts in every form: `import`, `import(...)` with a string or template
 * path, a re-export, `require(...)`, `vi.importActual(...)`, `vi.importMock(...)`, and `vi.mock(...)`
 * without a factory written inline (no second argument, or an options object such as `{ spy: true }`),
 * which loads the real module to mock it. Reading source with `readFileSync` or a `?raw` import is a scan.
 *
 * `mockedModules` answers one more question for the mutation check: which game modules a test that
 * pins earlier behaviour replaces with a mock, so their code is never what it pins (#485).
 *
 * The one game module a scan may import as code is literal constants under `src/ui/`: a contrast
 * check needs the theme's colours, and a TypeScript palette (one a WebGL scene reads, which cannot
 * read CSS custom properties) can only be read by importing it. Such an import runs nothing only
 * when every name it takes is a constant written out as literal data (strings, numbers, arrays and
 * objects of them) or a type that no value shares its name with, and the module itself runs
 * nothing when it loads: no value imports
 * and no top-level statement other than declarations. Anything else, a function from the same
 * module included, is the game's code.
 */
import { posix } from 'node:path';
import { findDispatches, parseSource, walk, type AstNode } from './test-step-ast.js';

/** Modules a scan never needs: they mount components or run a game. */
const CODE_RUNNING_MODULES = new Set(['@vue/test-utils', 'boardsmith/testing']);

/** The shell stub that mounts a board as a seat. */
const MOUNTING_HELPERS = new Set(['renderAsSeat']);

/** Where a game keeps its theme: the one place a scan may import constants from (see above). */
const THEME_CONSTANTS_DIR = 'src/ui/';

interface CodeRun {
  line: number;
  /** What the line does, in words for a finding, e.g. `imports src/rules/auction.ts`. */
  what: string;
}

/** What `findCodeRun` can see of the project beyond the file it reads. */
export interface CodeRunContext {
  /** The text of a project script (under `src/` or `tests/`), by project-relative path. */
  text(path: string): string | undefined;
  /** The project's own dispatch helpers (`findDispatchWrappers`). */
  wrappers: ReadonlyMap<string, number>;
}

type Statement = AstNode & { importKind?: string; exportKind?: string };

const isTypeOnlyImport = (node: Statement): boolean => {
  if (node.importKind === 'type' || node.exportKind === 'type') return true;
  const specifiers = (node.specifiers as Statement[] | undefined) ?? [];
  return node.type === 'ImportDeclaration' && specifiers.length > 0 && specifiers.every((s) => s.importKind === 'type');
};

/** `vi` methods that load the real module: the import helpers, and a mock with no factory (an automock). */
const LOADING_VI_METHODS = new Set(['importActual', 'importMock']);
const AUTOMOCK_VI_METHODS = new Set(['mock', 'doMock']);
const FACTORY_TYPES = new Set(['ArrowFunctionExpression', 'FunctionExpression']);

/**
 * Calls that load a module by path: `require(...)`, `vi.importActual(...)`, `vi.importMock(...)`,
 * and `vi.mock(path)` or `vi.doMock(path)` without a factory written inline, which loads the real
 * module to mock it. An options object (`{ spy: true }`) is not a factory; neither is a value whose
 * shape this cannot see, so only an inline function counts as one.
 */
function isLoadingCall(node: AstNode): boolean {
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee as AstNode;
  if (callee.type === 'Identifier') return callee.name === 'require';
  if (callee.type !== 'MemberExpression' || (callee.object as AstNode).name !== 'vi') return false;
  const method = (callee.property as AstNode).name as string;
  if (LOADING_VI_METHODS.has(method)) return true;
  const factory = (node.arguments as AstNode[])[1];
  return AUTOMOCK_VI_METHODS.has(method) && (factory === undefined || !FACTORY_TYPES.has(factory.type));
}

/**
 * The path a module specifier names: a string, or a template literal. A template with expressions
 * gives its fixed start with `*` for the computed rest, which is enough to tell whether it reaches
 * into the game's `src/`.
 */
function specifierText(node: AstNode | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === 'Literal') return typeof node.value === 'string' ? node.value : undefined;
  if (node.type !== 'TemplateLiteral') return undefined;
  const head = (node.quasis as Array<{ value: { cooked: string } }>)[0].value.cooked;
  return (node.expressions as AstNode[]).length === 0 ? head : `${head}*`;
}

/** The module a statement or expression loads: imports, dynamic imports, re-exports and loading calls. */
function loadedModule(node: AstNode): string | undefined {
  if (isLoadingCall(node)) return specifierText((node.arguments as AstNode[])[0]);
  const loads = ['ImportDeclaration', 'ImportExpression', 'ExportNamedDeclaration', 'ExportAllDeclaration'];
  return loads.includes(node.type) ? specifierText(node.source as AstNode | undefined) : undefined;
}

/** The project script a relative module path names, trying TypeScript's extension rules. */
function resolveScript(path: string, context: Pick<CodeRunContext, 'text'>): string | undefined {
  const stem = path.replace(/\.(m|c)?js$/, '');
  const candidates = [
    path,
    ...['.ts', '.mts', '.cts', '.js', '.mjs'].map((ext) => `${stem}${ext}`),
    ...['/index.ts', '/index.js'].map((index) => `${path}${index}`),
  ];
  return candidates.find((candidate) => context.text(candidate) !== undefined);
}

// -------------------------------------------------------------------------------------------
// Literal theme constants
// -------------------------------------------------------------------------------------------

const TYPE_DECLARATIONS = new Set(['TSTypeAliasDeclaration', 'TSInterfaceDeclaration']);
/** Declarations of a function, which run nothing until called. An overload signature is one. */
const FUNCTION_DECLARATIONS = new Set(['FunctionDeclaration', 'TSDeclareFunction']);
const TYPE_WRAPPERS = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSTypeAssertion', 'TSNonNullExpression']);
const INERT_INITIALIZERS = new Set(['ArrowFunctionExpression', 'FunctionExpression']);

/** A module's top-level constants and types, when loading it runs nothing; undefined otherwise. */
interface InertModule {
  /** Top-level `const` initializers, by local name. */
  constants: Map<string, AstNode | null>;
  /** Names declared as a type or interface. */
  types: Set<string>;
  /** Names declared as a value (a constant or a function). A name in both is a value. */
  values: Set<string>;
  /** Exported name to local name. */
  exports: Map<string, string>;
}

/** Records a function or type declaration; true, since declaring one runs nothing. */
function declareNamed(module: InertModule, node: AstNode, exported: boolean): true {
  const name = (node.id as AstNode | null)?.name as string | undefined;
  if (name === undefined) return true;
  (TYPE_DECLARATIONS.has(node.type) ? module.types : module.values).add(name);
  if (exported) module.exports.set(name, name);
  return true;
}

/** Records a `const` declaration; false when an initializer runs code. */
function declareConstants(module: InertModule, node: AstNode, exported: boolean): boolean {
  for (const declarator of node.declarations as AstNode[]) {
    const id = declarator.id as AstNode;
    const init = declarator.init as AstNode | null;
    if (id.type !== 'Identifier') return false;
    if (init && !INERT_INITIALIZERS.has(init.type) && literalIdentifiers(init) === undefined) return false;
    module.constants.set(id.name as string, init);
    module.values.add(id.name as string);
    if (exported) module.exports.set(id.name as string, id.name as string);
  }
  return true;
}

/** Records a declaration; false when it is not one that runs nothing. */
function declare(module: InertModule, node: AstNode, exported: boolean): boolean {
  if (TYPE_DECLARATIONS.has(node.type) || FUNCTION_DECLARATIONS.has(node.type)) return declareNamed(module, node, exported);
  if (node.type === 'VariableDeclaration' && node.kind === 'const') return declareConstants(module, node, exported);
  return false;
}

/** Records an `export` statement; false when it loads another module's values or runs code. */
function declareExport(module: InertModule, node: Statement): boolean {
  if (node.source) return isTypeOnlyImport(node);
  if (node.declaration) return declare(module, node.declaration as AstNode, true);
  for (const specifier of node.specifiers as AstNode[]) {
    const exported = specifier.exported as AstNode;
    module.exports.set((exported.name ?? exported.value) as string, (specifier.local as AstNode).name as string);
  }
  return true;
}

/** Records one top-level statement; false when loading the module would run it as code. */
function readStatement(module: InertModule, node: Statement): boolean {
  switch (node.type) {
    case 'ImportDeclaration':
      return isTypeOnlyImport(node);
    case 'ExportNamedDeclaration':
      return declareExport(module, node);
    case 'EmptyStatement':
      return true;
    default:
      return declare(module, node, false);
  }
}

function readInertModule(text: string, path: string): InertModule | undefined {
  const module: InertModule = { constants: new Map(), types: new Set(), values: new Set(), exports: new Map() };
  const body = parseSource(text, path).ast.body as Statement[];
  return body.every((node) => readStatement(module, node)) ? module : undefined;
}

type LiteralReader = (node: AstNode, visit: (node: AstNode) => boolean, refs: string[]) => boolean;

/** How each kind of node may appear in literal data; a kind not listed is code. */
const LITERAL_READERS: Readonly<Record<string, LiteralReader>> = Object.freeze({
  Literal: () => true,
  TemplateLiteral: (n) => (n.expressions as AstNode[]).length === 0,
  UnaryExpression: (n, visit) => (n.operator === '-' || n.operator === '+') && visit(n.argument as AstNode),
  Identifier: (n, _visit, refs) => refs.push(n.name as string) > 0,
  SpreadElement: (n, visit) => visit(n.argument as AstNode),
  ArrayExpression: (n, visit) => (n.elements as Array<AstNode | null>).every((e) => e === null || visit(e)),
  ObjectExpression: (n, visit) => (n.properties as AstNode[]).every((p) => p.type === 'SpreadElement' || isDataProperty(p)) &&
    (n.properties as AstNode[]).every((p) => visit(p.type === 'SpreadElement' ? p : (p.value as AstNode))),
});

/** A `key: value` property, not a method, getter or computed key. */
const isDataProperty = (p: AstNode) => p.kind === 'init' && !p.method && (!p.computed || (p.key as AstNode).type === 'Literal');

/** The identifiers a literal-data expression refers to, or undefined when it is not literal data. */
function literalIdentifiers(node: AstNode): string[] | undefined {
  const refs: string[] = [];
  const visit = (n: AstNode): boolean => {
    if (TYPE_WRAPPERS.has(n.type)) return visit(n.expression as AstNode);
    const reader = LITERAL_READERS[n.type];
    return reader !== undefined && reader(n, visit, refs);
  };
  return visit(node) ? refs : undefined;
}

/** Whether a local name of the module is a constant written out as literal data, all the way down. */
function isLiteralConstant(module: InertModule, name: string, seen = new Set<string>()): boolean {
  if (seen.has(name)) return true;
  seen.add(name);
  const init = module.constants.get(name);
  if (!init) return false;
  const refs = literalIdentifiers(init);
  return refs !== undefined && refs.every((ref) => ref === 'undefined' || isLiteralConstant(module, ref, seen));
}

/** Whether an import takes only literal constants and types from a module that runs nothing on load. */
function importsOnlyThemeConstants(node: AstNode, modulePath: string, context: CodeRunContext): boolean {
  if (node.type !== 'ImportDeclaration' || !modulePath.startsWith(THEME_CONSTANTS_DIR)) return false;
  const specifiers = node.specifiers as Statement[];
  if (specifiers.length === 0 || specifiers.some((s) => s.type !== 'ImportSpecifier')) return false;
  const text = context.text(modulePath);
  const module = text === undefined ? undefined : readInertModule(text, modulePath);
  if (!module) return false;
  return specifiers.every((specifier) => {
    if (specifier.importKind === 'type') return true;
    const imported = specifier.imported as AstNode;
    const local = module.exports.get((imported.name ?? imported.value) as string);
    if (local === undefined) return false;
    return module.values.has(local) ? isLiteralConstant(module, local) : module.types.has(local);
  });
}

// -------------------------------------------------------------------------------------------
// findCodeRun
// -------------------------------------------------------------------------------------------

/** Why loading `specifier` from `file` runs the game's code, or undefined when it does not. */
function codeRunByImport(
  node: AstNode,
  specifier: string,
  file: string,
  context: CodeRunContext,
  visited: Set<string>,
): string | undefined {
  if (isTypeOnlyImport(node as Statement)) return undefined;
  if (specifier.endsWith('.vue') || CODE_RUNNING_MODULES.has(specifier)) return `imports ${specifier}`;
  return specifier.startsWith('.') ? codeRunByRelativeImport(node, specifier, file, context, visited) : undefined;
}

/** `codeRunByImport` for a relative path: a module of the game's `src/`, or a support file under `tests/`. */
function codeRunByRelativeImport(
  node: AstNode,
  specifier: string,
  file: string,
  context: CodeRunContext,
  visited: Set<string>,
): string | undefined {
  const [pathPart, query] = specifier.split('?');
  if (query === 'raw') return undefined;
  const target = posix.normalize(posix.join(posix.dirname(file), pathPart));
  const resolved = resolveScript(target, context) ?? target;
  if (resolved.startsWith('src/')) {
    return importsOnlyThemeConstants(node, resolved, context) ? undefined : `imports ${resolved} from the game's src/`;
  }
  const text = resolved.startsWith('tests/') && !visited.has(resolved) ? context.text(resolved) : undefined;
  const inner = text === undefined ? undefined : codeRunIn(text, resolved, context, visited);
  return inner && `imports ${resolved}, which ${inner.what}`;
}

function codeRunIn(source: string, file: string, context: CodeRunContext, visited: Set<string>): CodeRun | undefined {
  visited.add(file);
  const found: CodeRun[] = [];
  walk(parseSource(source, file).ast, (node) => {
    const specifier = loadedModule(node);
    const what = specifier === undefined ? undefined : codeRunByImport(node, specifier, file, context, visited);
    if (what !== undefined) found.push({ line: node.loc.start.line, what });
    if (node.type === 'Identifier' && MOUNTING_HELPERS.has(node.name as string)) {
      found.push({ line: node.loc.start.line, what: `uses ${node.name as string}` });
    }
  });
  for (const { verb, line } of findDispatches(source, file, context.wrappers)) {
    found.push({ line, what: `dispatches the action "${verb}"` });
  }
  return found.sort((a, b) => a.line - b.line)[0];
}

/**
 * The first line of a test file that runs the game's code (see the file comment), or undefined
 * for a file that only reads source as text. `file` is the file's project-relative path.
 */
export function findCodeRun(source: string, file: string, context: CodeRunContext): CodeRun | undefined {
  return codeRunIn(source, file, context, new Set());
}

// -------------------------------------------------------------------------------------------
// mockedModules
// -------------------------------------------------------------------------------------------

const MOCKING_VI_METHODS = new Set(['mock', 'doMock']);

/**
 * The project modules a test file replaces with `vi.mock(path, ...)` or `vi.doMock(path, ...)`, in
 * any form, as project-relative paths. A test that pins earlier behaviour runs the mock, not the
 * module, so the mutation check leaves these out (#485).
 */
export function mockedModules(source: string, file: string, context: Pick<CodeRunContext, 'text'>): string[] {
  const mocked = new Set<string>();
  walk(parseSource(source, file).ast, (node) => {
    if (node.type !== 'CallExpression') return;
    const callee = node.callee as AstNode;
    if (callee.type !== 'MemberExpression' || (callee.object as AstNode).name !== 'vi') return;
    if (!MOCKING_VI_METHODS.has((callee.property as AstNode).name as string)) return;
    const specifier = specifierText((node.arguments as AstNode[])[0]);
    if (specifier === undefined || !specifier.startsWith('.') || /[?*]/.test(specifier)) return;
    const resolved = resolveScript(posix.normalize(posix.join(posix.dirname(file), specifier)), context);
    if (resolved !== undefined) mocked.add(resolved);
  });
  return [...mocked].sort();
}
