/**
 * THE PROTOCOL SHAPES ARE DECLARED EXACTLY ONCE, AND THE BARRELS EXPORT THOSE.
 *
 * `PickMetadata` and the shapes around it used to be declared three times — here
 * in `protocol.ts`, again in `session/types.ts`, and again in
 * `ui/composables/useActionControllerTypes.ts`. Nothing tied the copies
 * together, so a new pick field was three edits with nothing forcing the third:
 * #249's `orderedList` had to be added to all three, and the leftover
 * divergence was reported by `boardsmith audit` as a 79-line clone group
 * against whoever touched a pick field next.
 *
 * A copy is easy to write and invisible once written, so the gate is here rather
 * than in review. A layer that genuinely needs more than the wire shape says so
 * by EXTENDING it (`interface ValidElement extends WireValidElement`, which is
 * how the UI adds its enriched `element`) or by binding its type parameter
 * (`type PickMetadata = WirePickMetadata<ValidElement>`). Both keep one
 * declaration of every field; a bare `interface PickMetadata { ... }` somewhere
 * else does not, and that is what this refuses.
 *
 * `ElementRef` IS THE SHAPE EVERY BARREL HANDS OUT (#263).
 *
 * One declaration in the tree is only half of it. `ElementRef` was declared
 * three times — here in `protocol.ts` (reached from `boardsmith/types`), again
 * in `ui/composables/useBoardInteraction.ts` (re-exported from `boardsmith/ui`)
 * and again in `engine/tutorial/types.ts` (re-exported from `boardsmith`) — so a
 * game importing it from two barrels got two different types under one name,
 * with nothing in the compiler to say which one it had: the protocol copy
 * carried a `className` field the other two did not. Checking that both barrels
 * merely COMPILE proves nothing, since three similar interfaces compile fine and
 * that is exactly how the divergence survived. The second describe block below
 * follows the export chain from each public entry point back to the file that
 * declares the interface, and requires all of them to land on this one.
 *
 * `RefWithRole` is deliberately covered by neither half: the engine's is over
 * `BoardElementRef` and the protocol's over `ElementRef`, protocol.ts says in
 * prose why it declares its own, and it is recorded in the dead-code baseline.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');
const OWNER = path.join(SRC, 'types', 'protocol.ts');

/** The shapes that make up a pick, all owned by `types/protocol.ts`. */
const PICK_SHAPE = [
  'PickMetadata',
  'ActionMetadata',
  'PickChoicesResponse',
  'ChoiceWithRefs',
  'PickFilter',
  // The element a choice points at. It was declared three more times (#263) —
  // in the UI's useBoardInteraction and in the engine's tutorial types, both of
  // which re-export the protocol's now. Which barrel exports which declaration
  // is checked in element-ref-single-source.test.ts.
  'ElementRef',
] as const;

/** The public entry points in package.json's `exports` that offer `ElementRef`. */
const BARRELS = {
  boardsmith: path.join(SRC, 'engine', 'index.ts'),
  'boardsmith/ui': path.join(SRC, 'ui', 'index.ts'),
  'boardsmith/types': path.join(SRC, 'types', 'index.ts'),
} as const;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(ts|vue)$/.test(entry.name) ? [full] : [];
  });
}

/**
 * A fresh declaration of `name`'s own body — `interface name {` with no
 * `extends`. An `interface X extends Wire {}` is an extension of the one
 * declaration, not a second one, so it is deliberately not matched.
 */
function declaresOwnBody(source: string, name: string): boolean {
  return new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?interface\\s+${name}(?:<[^>]*>)?\\s*\\{`).test(source);
}

/** One step along an export chain: keep looking for `name`, now in `file`. */
interface Hop {
  file: string;
  name: string;
}

/** Resolve a module specifier the way this package's `.js`-suffixed imports mean it. */
function resolveModule(fromFile: string, specifier: string): string {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base.replace(/\.js$/, '.ts'), base, `${base}.ts`, path.join(base, 'index.ts')];
  const found = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (found) return found;
  throw new Error(
    `Cannot resolve "${specifier}" imported by ${path.relative(SRC, fromFile)}, so this test cannot ` +
      `follow the export chain. Teach resolveModule the new module layout.`,
  );
}

function moduleOf(statement: ts.ExportDeclaration | ts.ImportDeclaration): string | null {
  const specifier = statement.moduleSpecifier;
  return specifier && ts.isStringLiteral(specifier) ? specifier.text : null;
}

/** `export interface ElementRef { ... }` or `export type ElementRef = ...` in this file. */
function declaresLocally(statement: ts.Statement, name: string): boolean {
  if (ts.isInterfaceDeclaration(statement)) return statement.name.text === name;
  if (ts.isTypeAliasDeclaration(statement)) return statement.name.text === name;
  return false;
}

/** `export { type ElementRef } from './x.js'`, or `export type { ElementRef }` with no module. */
function namedExportHop(statement: ts.ExportDeclaration, file: string, name: string): Hop | null {
  const clause = statement.exportClause;
  if (!clause || !ts.isNamedExports(clause)) return null;
  const hit = clause.elements.find((element) => element.name.text === name);
  if (!hit) return null;
  const local = (hit.propertyName ?? hit.name).text;
  const specifier = moduleOf(statement);
  return { file: specifier ? resolveModule(file, specifier) : file, name: local };
}

/** `import type { ElementRef } from './protocol.js'` backing a local re-export. */
function namedImportHop(statement: ts.ImportDeclaration, file: string, name: string): Hop | null {
  const bindings = statement.importClause?.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return null;
  const hit = bindings.elements.find((element) => element.name.text === name);
  const specifier = moduleOf(statement);
  if (!hit || !specifier) return null;
  return { file: resolveModule(file, specifier), name: (hit.propertyName ?? hit.name).text };
}

function hopFor(statement: ts.Statement, file: string, name: string): Hop | null {
  if (ts.isExportDeclaration(statement)) return namedExportHop(statement, file, name);
  if (ts.isImportDeclaration(statement)) return namedImportHop(statement, file, name);
  return null;
}

/** `export * from './protocol.js'` targets, searched only after named exports, which win. */
function starTargets(source: ts.SourceFile, file: string): string[] {
  return source.statements.flatMap((statement) => {
    if (!ts.isExportDeclaration(statement) || statement.exportClause) return [];
    const specifier = moduleOf(statement);
    return specifier ? [resolveModule(file, specifier)] : [];
  });
}

/**
 * Follow `name` from `file` through re-exports and imports to the file whose own
 * `interface`/`type` declaration it ultimately names, or null if the chain runs out.
 * A barrel that stops exporting the name at all fails the assertions below, which
 * is intended: that is as much a regression as a second declaration.
 */
function declaringFile(file: string, name: string, seen = new Set<string>()): string | null {
  const key = `${file}#${name}`;
  if (seen.has(key)) return null;
  seen.add(key);

  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf-8'), ts.ScriptTarget.ES2022, true);
  if (source.statements.some((statement) => declaresLocally(statement, name))) return file;

  for (const statement of source.statements) {
    const hop = hopFor(statement, file, name);
    if (hop) return declaringFile(hop.file, hop.name, seen);
  }
  for (const target of starTargets(source, file)) {
    const found = declaringFile(target, name, seen);
    if (found) return found;
  }
  return null;
}

describe('the protocol shapes have one declaration each', () => {
  const files = sourceFiles(SRC).filter((file) => !file.endsWith('.test.ts'));

  it.each(PICK_SHAPE)('%s is declared only in types/protocol.ts', (name) => {
    const offenders = files.filter(
      (file) => file !== OWNER && declaresOwnBody(fs.readFileSync(file, 'utf-8'), name),
    );
    expect(offenders.map((file) => path.relative(SRC, file))).toEqual([]);
  });

  it.each(PICK_SHAPE)('%s really is declared in types/protocol.ts', (name) => {
    expect(declaresOwnBody(fs.readFileSync(OWNER, 'utf-8'), name)).toBe(true);
  });
});

describe('every barrel exports the one ElementRef', () => {
  it.each(Object.entries(BARRELS))('%s exports the declaration in types/protocol.ts', (_barrel, entry) => {
    const found = declaringFile(entry, 'ElementRef');
    expect(found && path.relative(SRC, found)).toBe(path.relative(SRC, OWNER));
  });
});
