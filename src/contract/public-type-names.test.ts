/**
 * THE PUBLIC EXPORT SURFACE: ONE TYPE NAME, ONE DECLARATION (#367, #369, #374-#376),
 * AND ONE ENTRY POINT PER DECLARATION (#526).
 *
 * `ActionResult` was declared four times: in the engine (what an action's
 * `execute()` returns), in the session (what its session class's
 * `performAction` returned), in the client (what the server answers an action request with) and
 * in the UI (what the action controller resolves). `boardsmith`,
 * `boardsmith/session` and `boardsmith/client` each exported theirs under that
 * one name, so a game importing from two of them got two different types with
 * nothing in the compiler to say which one it held. The audit's duplicate-export
 * check only saw it when a branch changed two of the declaring files at once
 * (the #265 blind spot), so it sat in the tree.
 *
 * This test asks the compiler for the exports of every entry point in
 * package.json's `exports`, follows each type export to the declaration it
 * names, and fails when one exported name reaches more than one declaration.
 * A layer that needs a different shape gives it a different name; a layer that
 * needs the same shape imports the one declaration.
 *
 * It also fails when one declaration is exported from more than one entry point
 * (outside `SHARED_ACCEPTED` below), so an author never has to guess which entry
 * is the right one for a name, and when any export starts with `_`, the mark of
 * a test hook that tests should import by relative path instead.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Exported name -> sorted `file:declaredName` of every declaration it reaches -> the entry points exporting it. */
type Collisions = Map<string, Map<string, string[]>>;

/** The module symbol of one entry point, or a thrown error naming the entry that could not be read. */
function entryModule(program: ts.Program, checker: ts.TypeChecker, entry: string, file: string): ts.Symbol {
  const source = program.getSourceFile(file);
  const moduleSymbol = source && checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error(`The entry point ${entry} (${file}) is not a module in the program, so its exports cannot be checked.`);
  return moduleSymbol;
}

/** `file:declaredName` of the type an export names, following re-exports and renames; null for a value. */
function typeDeclarationId(checker: ts.TypeChecker, exported: ts.Symbol, root: string): string | null {
  const target = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
  const declaration = target.flags & ts.SymbolFlags.Type ? target.declarations?.[0] : undefined;
  return declaration ? `${path.relative(root, declaration.getSourceFile().fileName)}:${target.name}` : null;
}

/**
 * `file:declaredName` of the declaration any export (value or type) names,
 * following re-exports and renames. An export of a module the compiler cannot
 * read (a `.vue` component) is named by that module's file and the binding.
 */
function declarationId(checker: ts.TypeChecker, exported: ts.Symbol, root: string): string {
  const symbol = lastReadableAlias(checker, exported);
  const declaration = symbol.declarations?.[0];
  if (!declaration) throw new Error(`The export ${exported.name} has no declaration the compiler can find, so its entry points cannot be checked.`);
  if (ts.isExportSpecifier(declaration)) return unreadableModuleExportId(declaration, root);
  return `${path.relative(root, declaration.getSourceFile().fileName)}:${symbol.name}`;
}

/** `file:binding` for a re-export of a module the compiler cannot read, from the export's own text. */
function unreadableModuleExportId(specifier: ts.ExportSpecifier, root: string): string {
  const from = specifier.parent.parent.moduleSpecifier;
  if (!from || !ts.isStringLiteral(from)) throw new Error(`The export ${specifier.name.text} names no module the compiler can find, so its entry points cannot be checked.`);
  const file = path.resolve(path.dirname(specifier.getSourceFile().fileName), from.text);
  return `${path.relative(root, file)}:${(specifier.propertyName ?? specifier.name).text}`;
}

/** The end of an export's alias chain, or its last link the compiler can read. */
function lastReadableAlias(checker: ts.TypeChecker, exported: ts.Symbol): ts.Symbol {
  let symbol = exported;
  while (symbol.flags & ts.SymbolFlags.Alias) {
    const next = checker.getImmediateAliasedSymbol(symbol);
    if (!next?.declarations?.length) return symbol;
    symbol = next;
  }
  return symbol;
}

/** Every declaration two or more entry points export, mapped to those entry points, and every `_` export as `entry:name`. */
function surfaceProblems(program: ts.Program, entries: Record<string, string>, root: string): {
  shared: Map<string, string[]>;
  underscored: string[];
} {
  const checker = program.getTypeChecker();
  const byDeclaration = new Map<string, string[]>();
  const underscored: string[] = [];
  for (const [entry, file] of Object.entries(entries)) {
    for (const exported of checker.getExportsOfModule(entryModule(program, checker, entry, file))) {
      if (exported.name.startsWith('_')) underscored.push(`${entry}:${exported.name}`);
      const id = declarationId(checker, exported, root);
      const exporters = byDeclaration.get(id) ?? [];
      if (!exporters.includes(entry)) exporters.push(entry);
      byDeclaration.set(id, exporters);
    }
  }
  return { shared: new Map([...byDeclaration].filter(([, exporters]) => exporters.length > 1)), underscored };
}

/**
 * Every exported type name that two or more entry points resolve to different
 * declarations. `entries` maps an entry point's public name to its source file.
 */
function typeNameCollisions(program: ts.Program, entries: Record<string, string>, root: string): Collisions {
  const checker = program.getTypeChecker();
  const byName: Collisions = new Map();
  for (const [entry, file] of Object.entries(entries)) {
    for (const exported of checker.getExportsOfModule(entryModule(program, checker, entry, file))) {
      const id = typeDeclarationId(checker, exported, root);
      if (!id) continue;
      const declarations = byName.get(exported.name) ?? new Map<string, string[]>();
      declarations.set(id, [...(declarations.get(id) ?? []), entry]);
      byName.set(exported.name, declarations);
    }
  }
  return new Map([...byName].filter(([, declarations]) => declarations.size > 1));
}

/** The `.ts` entry points package.json publishes, keyed by their import specifier. */
function publicEntryPoints(): Record<string, string> {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as {
    exports: Record<string, string | { types?: string }>;
  };
  const entries: Record<string, string> = {};
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    const types = typeof target === 'string' ? target : target.types;
    if (!types || !types.endsWith('.ts')) continue;
    entries[path.posix.join('boardsmith', subpath)] = path.join(ROOT, types);
  }
  return entries;
}

// Built once, here, because compiling every entry point is slow one-time setup.
const ENTRIES = publicEntryPoints();
const parsed = ts.getParsedCommandLineOfConfigFile(path.join(ROOT, 'tsconfig.json'), {}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
    throw new Error(`tsconfig.json could not be read: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
  },
});
if (!parsed) throw new Error('tsconfig.json could not be parsed, so the public exports cannot be compiled.');
const PROGRAM = ts.createProgram(Object.values(ENTRIES), parsed.options);
const COLLISIONS = typeNameCollisions(PROGRAM, ENTRIES, ROOT);
const SURFACE = surfaceProblems(PROGRAM, ENTRIES, ROOT);

/**
 * Declarations deliberately exported from more than one entry point, as
 * `file:declaredName`. This list may only shrink: a new shared export picks
 * one entry point instead.
 */
const SHARED_ACCEPTED: readonly string[] = [
  // Game-author types a host also names: games declare their policies at the
  // root, and the hosts that apply them take them from their own entry.
  'src/engine/element/game.ts:GameClass',
  'src/engine/action/types.ts:PickTrace',
  'src/engine/utils/snapshot.ts:CheckpointPolicy',
  'src/engine/utils/snapshot.ts:UndoPolicy',
  // Engine shapes a custom UI reads off the view it is handed.
  'src/engine/element/hex-grid.ts:HexOrientation',
  'src/engine/element/game.ts:AnimationEvent',
  'src/types/protocol.ts:ElementRef',
  'src/world/contract.ts:WorldActionOffer',
  // The flow state a client renders.
  'src/engine/flow/public-flow-state.ts:PublicFlowState',
  // Player colours: the lobby (session) offers them and the UI paints them.
  'src/session/colors.ts:STANDARD_PLAYER_COLORS',
  'src/session/colors.ts:ColorChoice',
  // boardsmith/ui/auto-ui is the auto UI on its own; boardsmith/ui carries it too.
  'src/ui/components/auto-ui/ActionPanel.vue:default',
  'src/ui/types.ts:GameViewElement',
  'src/ui/types.ts:BoardPlayer',
  'src/ui/components/auto-ui/renderer-registry.ts:registerRenderer',
  'src/ui/composables/useActionControllerTypes.ts:EnrichedPickMetadata',
  'src/ui/composables/useActionControllerTypes.ts:EnrichedActionMetadata',
];

function describeCollision(name: string, declarations: Map<string, string[]>): string {
  const lines = [...declarations].map(([id, entries]) => `    ${id}  (exported by ${entries.join(', ')})`);
  return `  ${name}\n${lines.join('\n')}`;
}

describe('every public type name has one declaration (#367, #369, #374, #375, #376)', () => {
  it('no two entry points export one type name from different declarations', () => {
    expect(
      [...COLLISIONS.keys()],
      'These type names reach more than one declaration across the public entry points, so an importer ' +
        'gets a different type depending on which entry it imports from. Give each shape its own name, or ' +
        'import the one declaration everywhere:\n' +
        [...COLLISIONS].map(([name, declarations]) => describeCollision(name, declarations)).join('\n'),
    ).toEqual([]);
  });
});

describe('every public declaration has one entry point (#526)', () => {
  it('no declaration is exported from two entry points unless SHARED_ACCEPTED lists it', () => {
    const unaccepted = [...SURFACE.shared].filter(([id]) => !SHARED_ACCEPTED.includes(id));
    expect(
      unaccepted.map(([id]) => id),
      'These declarations are exported from more than one entry point, so an author cannot tell which ' +
        'one to import from. Export each from the one entry point it belongs to:\n' +
        unaccepted.map(([id, exporters]) => `  ${id}  (exported by ${exporters.join(', ')})`).join('\n'),
    ).toEqual([]);
  });

  it('every SHARED_ACCEPTED entry is still shared, so the list only shrinks', () => {
    expect(
      SHARED_ACCEPTED.filter((id) => !SURFACE.shared.has(id)),
      'These SHARED_ACCEPTED entries are no longer exported from two entry points. Delete them from the list.',
    ).toEqual([]);
  });

  it('no entry point exports a name starting with _', () => {
    expect(
      SURFACE.underscored,
      'These exports start with _, which marks a test hook. Import it by relative path in the tests and ' +
        'drop it from the public entry point:\n' + SURFACE.underscored.map((name) => `  ${name}`).join('\n'),
    ).toEqual([]);
  });
});

describe('the checks themselves', () => {
  /** Compiles in-memory modules so each check can be shown to fail on a planted case. */
  function virtualProgram(files: Record<string, string>): ts.Program {
    const host = ts.createCompilerHost({});
    const readFile = host.readFile.bind(host);
    host.fileExists = (file) => file in files || ts.sys.fileExists(file);
    host.directoryExists = (dir) => Object.keys(files).some((file) => file.startsWith(`${dir}/`)) || ts.sys.directoryExists(dir);
    host.readFile = (file) => files[file] ?? readFile(file);
    host.getSourceFile = (file, languageVersion) => {
      const text = files[file] ?? ts.sys.readFile(file);
      return text === undefined ? undefined : ts.createSourceFile(file, text, languageVersion, true);
    };
    const options: ts.CompilerOptions = { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, noLib: true };
    return ts.createProgram(Object.keys(files), options, host);
  }

  function collisionsIn(files: Record<string, string>, entries: Record<string, string>): Collisions {
    return typeNameCollisions(virtualProgram(files), entries, '/virtual');
  }

  it('reports one declaration exported from two entry points, and an export starting with _', () => {
    const found = surfaceProblems(
      virtualProgram({
        '/virtual/a.ts': 'export function shared() {}\nexport function _resetForTests() {}',
        '/virtual/b.ts': "export { shared as alsoShared } from './a';",
      }),
      { 'pkg/a': '/virtual/a.ts', 'pkg/b': '/virtual/b.ts' },
      '/virtual',
    );
    console.log(JSON.stringify([...found.shared]));expect([...found.shared]).toEqual([['a.ts:shared', ['pkg/a', 'pkg/b']]]);
    expect(found.underscored).toEqual(['pkg/a:_resetForTests']);
  });

  it('reports one name declared twice with different shapes', () => {
    const found = collisionsIn(
      {
        '/virtual/a.ts': 'export interface Result { ok: boolean }',
        '/virtual/b.ts': 'export interface Result { ok: boolean; state: string }',
      },
      { 'pkg/a': '/virtual/a.ts', 'pkg/b': '/virtual/b.ts' },
    );
    expect([...found.keys()]).toEqual(['Result']);
  });

  it('accepts one declaration re-exported, and renamed, through several entry points', () => {
    const found = collisionsIn(
      {
        '/virtual/a.ts': 'export interface Result { ok: boolean }',
        '/virtual/b.ts': "export type { Result } from './a';",
        '/virtual/c.ts': "import type { Result } from './a';\nexport type { Result as Outcome };",
      },
      { 'pkg/a': '/virtual/a.ts', 'pkg/b': '/virtual/b.ts', 'pkg/c': '/virtual/c.ts' },
    );
    expect([...found.keys()]).toEqual([]);
  });
});
