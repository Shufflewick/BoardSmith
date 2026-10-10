/**
 * What the engine surface hash can see (#575).
 *
 * ShufflewickPub routes a persistent world only to a runner whose `surfaceHash`
 * equals the one its bundle's build revision declared (ShufflewickPub #599). So
 * a change a world's rules can trip over at runtime -- a static removed, an
 * instance field renamed, a method turned into a getter -- must move the hash,
 * and a change no compiled `rules.js` can observe must not, or every such edit
 * strands live worlds on an older runner for nothing.
 *
 * Each case writes a small entrypoint to a temp folder, once as it was and once
 * changed, and compares what `describeSurface` says about the two.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describeSurface } from './fingerprint.js';

const dir = mkdtempSync(join(tmpdir(), 'bs575-surface-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let written = 0;

/** The surface lines of an entrypoint whose whole source is `source`. */
async function surfaceOf(source: string): Promise<string[]> {
  // Each version gets its own file: a module is cached by path, so reusing one
  // would describe the first version's runtime values against the second's source.
  const file = join(dir, `entry-${written++}.ts`);
  writeFileSync(file, source);
  return describeSurface([
    {
      specifier: 'fixture',
      source: file,
      // Dynamic import: the module under test is a file this test just wrote.
      module: () => import(pathToFileURL(file).href),
    },
  ]);
}

const BASE = `
export class Base {
  static make(): Base { return new Base(); }
  static readonly LIMIT: number = 3;
  shared = 1;
  protected guarded = 'x';
  declare attached: string;
  baseMethod(): number { return 1; }
}
export class Piece extends Base {
  static unserializableAttributes = ['a'];
  owner: string | null = null;
  constructor(public readonly seat: number) { super(); }
  get label(): string { return 'p'; }
  move(): void {}
}
export function helper(): number { return 1; }
`;

async function moves(changed: string): Promise<boolean> {
  const before = await surfaceOf(BASE);
  const after = await surfaceOf(changed);
  return before.join('\n') !== after.join('\n');
}

describe('surfaceHash covers what a compiled rules.js can reach (#575)', () => {
  it('names statics, instance fields and prototype members with their kinds', async () => {
    const [line] = await surfaceOf(BASE);
    for (const member of [
      'static method make',
      'static field LIMIT',
      'static field unserializableAttributes',
      'field shared',
      'field guarded',
      'field attached',
      'field owner',
      'field seat',
      'method move',
      'method baseMethod',
      'get label',
    ]) {
      expect(line).toContain(member);
    }
  });

  it('moves when a static is removed', async () => {
    expect(await moves(BASE.replace("static unserializableAttributes = ['a'];", ''))).toBe(true);
  });

  it('moves when a static is added', async () => {
    expect(await moves(BASE.replace('move(): void {}', 'move(): void {}\n  static restore(): void {}'))).toBe(true);
  });

  it('moves when a static changes from a method to a field', async () => {
    expect(await moves(BASE.replace('static make(): Base { return new Base(); }', 'static make = (): Base => new Base();'))).toBe(true);
  });

  it('moves when an inherited static is removed from an exported subclass', async () => {
    // `Piece.make()` is how a game calls it, so Piece's own line carries it.
    const piece = (lines: string[]) => lines[0]!.split('Piece{')[1];
    const before = piece(await surfaceOf(BASE));
    const after = piece(await surfaceOf(BASE.replace('static make(): Base { return new Base(); }', '')));
    expect(after).not.toBe(before);
  });

  it('moves when an instance field is removed', async () => {
    expect(await moves(BASE.replace('owner: string | null = null;', ''))).toBe(true);
  });

  it('moves when an instance field is added', async () => {
    expect(await moves(BASE.replace('move(): void {}', 'move(): void {}\n  score = 0;'))).toBe(true);
  });

  it('moves when a constructor parameter property is removed', async () => {
    expect(await moves(BASE.replace('public readonly seat: number', 'seat: number'))).toBe(true);
  });

  it('reads the instance fields of a class exported as an expression', async () => {
    const [line] = await surfaceOf('export const Token = class { held = true; };\n');
    expect(line).toBe('fixture: Token{field held}');
  });

  it('moves when an instance field becomes a getter', async () => {
    expect(await moves(BASE.replace('owner: string | null = null;', 'get owner(): string | null { return null; }'))).toBe(true);
  });

  it('moves when a member moves between the instance and the class', async () => {
    expect(await moves(BASE.replace('owner: string | null = null;', 'static owner: string | null = null;'))).toBe(true);
  });

  it('does not move when only implementations and values change', async () => {
    const changed = BASE
      .replace('return new Base();', 'const made = new Base(); return made;')
      .replace('LIMIT: number = 3', 'LIMIT: number = 4')
      .replace("unserializableAttributes = ['a']", "unserializableAttributes = ['a', 'b']")
      .replace('owner: string | null = null;', "owner: string | null = 'nobody';")
      .replace("return 'p';", "return 'piece';");
    expect(await moves(changed)).toBe(false);
  });

  it('does not move when a type, an unexported class or a member type changes', async () => {
    // Types are erased from rules.js, so no compiled bundle can depend on one.
    // Covering them would strand live worlds on older runners for edits that
    // change nothing a world can run.
    const changed = `${BASE.replace('owner: string | null = null;', 'owner: string | number | null = null;')}
export type PieceKind = 'a' | 'b';
export interface PieceView { id: number }
class Internal { hidden = 1; }
`;
    expect(await moves(changed)).toBe(false);
  });

  it('does not move when a member moves up to an exported base class', async () => {
    // What a game can call on Piece is unchanged.
    const changed = BASE
      .replace('move(): void {}', '')
      .replace('baseMethod(): number { return 1; }', 'baseMethod(): number { return 1; }\n  move(): void {}');
    const piece = (lines: string[]) => lines[0]!.split('Piece{')[1]!.split('}')[0];
    expect(piece(await surfaceOf(changed))).toBe(piece(await surfaceOf(BASE)));
  });

  it('refuses a runtime export it cannot find in the source', async () => {
    const file = join(dir, `entry-${written++}.ts`);
    writeFileSync(file, 'export class Shown { field = 1; }\n');
    await expect(
      describeSurface([
        { specifier: 'fixture', source: file, module: async () => ({ Shown: class {}, Extra: class {} }) },
      ]),
    ).rejects.toThrow(/Extra/);
  });
});
