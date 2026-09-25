/**
 * ONE TYPE NAME, ONE DECLARATION, ACROSS EVERY PUBLIC ENTRY POINT (#367, #369, #374-#376).
 *
 * `ActionResult` was declared four times: in the engine (what an action's
 * `execute()` returns), in the session (what `GameSession.performAction`
 * returns), in the client (what the server answers an action request with) and
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
const COLLISIONS = typeNameCollisions(ts.createProgram(Object.values(ENTRIES), parsed.options), ENTRIES, ROOT);

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

describe('the collision check itself', () => {
  /** Compiles in-memory modules so the check can be shown to fail on a planted collision. */
  function collisionsIn(files: Record<string, string>, entries: Record<string, string>): Collisions {
    const host = ts.createCompilerHost({});
    const readFile = host.readFile.bind(host);
    host.fileExists = (file) => file in files || ts.sys.fileExists(file);
    host.readFile = (file) => files[file] ?? readFile(file);
    host.getSourceFile = (file, languageVersion) => {
      const text = files[file] ?? ts.sys.readFile(file);
      return text === undefined ? undefined : ts.createSourceFile(file, text, languageVersion, true);
    };
    const options: ts.CompilerOptions = { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, noLib: true };
    return typeNameCollisions(ts.createProgram(Object.keys(files), options, host), entries, '/virtual');
  }

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
