/**
 * ONE TYPE NAME, ONE DECLARATION, ACROSS EVERY PUBLIC ENTRY POINT (#367, #369).
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
 *
 * `KNOWN_COLLISIONS` is the debt that was already in the tree when this guard
 * was added, each entry pinned to its exact set of declarations and to the
 * issue that removes it. It can only shrink: an entry whose collision is gone
 * fails until it is deleted, and a new declaration of a listed name fails like
 * any other collision.
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

/**
 * Collisions that predate this guard, each with the issue that removes it. The
 * declarations are exact: another declaration of one of these names fails.
 */
const KNOWN_COLLISIONS: Record<string, { issue: number; declarations: string[] }> = {
  GameElement: { issue: 374, declarations: ['src/engine/element/game-element.ts:GameElement', 'src/ui/types.ts:GameElement'] },
  Player: { issue: 374, declarations: ['src/engine/player/player.ts:Player', 'src/ui/types.ts:Player'] },
  ValidElement: { issue: 374, declarations: ['src/types/protocol.ts:ValidElement', 'src/ui/composables/useActionControllerTypes.ts:ValidElement'] },
  PickMetadata: { issue: 374, declarations: ['src/types/protocol.ts:PickMetadata', 'src/ui/composables/useActionControllerTypes.ts:PickMetadata'] },
  ActionMetadata: { issue: 374, declarations: ['src/types/protocol.ts:ActionMetadata', 'src/ui/composables/useActionControllerTypes.ts:ActionMetadata'] },
  PickStepResult: { issue: 374, declarations: ['src/session/pending-action-manager.ts:PickStepResult', 'src/ui/composables/useActionControllerTypes.ts:PickStepResult'] },
  HexOrientation: { issue: 374, declarations: ['src/engine/element/hex-grid.ts:HexOrientation', 'src/ui/composables/useHexGrid.ts:HexOrientation'] },
  CreateGameRequest: { issue: 375, declarations: ['src/session/types.ts:CreateGameRequest', 'src/types/protocol.ts:CreateGameRequest'] },
  PlayerConfig: { issue: 375, declarations: ['src/bot-trainer/benchmark.ts:PlayerConfig', 'src/session/types.ts:PlayerConfig', 'src/types/protocol.ts:PlayerConfig'] },
  ClaimSeatRequest: { issue: 375, declarations: ['src/session/types.ts:ClaimSeatRequest', 'src/types/protocol.ts:ClaimSeatRequest'] },
  ClaimSeatResponse: { issue: 375, declarations: ['src/session/types.ts:ClaimSeatResponse', 'src/types/protocol.ts:ClaimSeatResponse'] },
  JoinLobbyRequest: { issue: 375, declarations: ['src/session/types.ts:JoinLobbyRequest', 'src/types/protocol.ts:JoinLobbyRequest'] },
  JoinLobbyResponse: { issue: 375, declarations: ['src/session/types.ts:JoinLobbyResponse', 'src/types/protocol.ts:JoinLobbyResponse'] },
  GameClass: { issue: 375, declarations: ['src/bot-trainer/types.ts:GameClass', 'src/session/types.ts:GameClass'] },
};

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

describe('every public type name has one declaration (#367, #369)', () => {
  it('no two entry points export one type name from different declarations', () => {
    const unexplained = [...COLLISIONS].filter(([name, declarations]) => {
      const known = KNOWN_COLLISIONS[name];
      return !known || JSON.stringify([...declarations.keys()].sort()) !== JSON.stringify([...known.declarations].sort());
    });
    expect(
      unexplained.map(([name]) => name),
      unexplained.length === 0
        ? ''
        : 'These type names reach more than one declaration across the public entry points, so an importer ' +
            'gets a different type depending on which entry it imports from. Give each shape its own name, or ' +
            'import the one declaration everywhere:\n' +
            unexplained.map(([name, declarations]) => describeCollision(name, declarations)).join('\n'),
    ).toEqual([]);
  });

  it('every known collision still exists, so a fixed one is taken off the list', () => {
    const fixed = Object.keys(KNOWN_COLLISIONS).filter((name) => !COLLISIONS.has(name));
    expect(fixed, `No longer collide; delete them from KNOWN_COLLISIONS: ${fixed.join(', ')}`).toEqual([]);
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
