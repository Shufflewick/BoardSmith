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
import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describeSurface } from './fingerprint.js';
import { tempTree } from '../testing/temp-tree.test-helper.js';

const dir = tempTree('bs575-surface-');

let written = 0;

/** The surface lines of an entrypoint whose whole source is `source`. */
async function surfaceOf(source: string): Promise<string[]> {
  // Each version gets its own file: a module is cached by path, so reusing one
  // would describe the first version's runtime values against the second's source.
  const file = join(dir, `entry-${written++}.ts`);
  writeFileSync(file, source);
  // Dynamic import: the module under test is a file this test just wrote.
  const module = () => import(pathToFileURL(file).href);
  return describeSurface([{ specifier: 'fixture', source: file, module }]);
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
  private secret = 0;
  #hidden = 0;
  get label(): string { return 'p'; }
  move(): void {}
  *[Symbol.iterator](): Iterator<number> { yield this.#hidden; }
}
export function helper(): number { return 1; }
export async function settle(): Promise<number> { return 1; }
export function* walk(): Generator<number> { yield 1; }
export async function* stream(): AsyncGenerator<number> { yield 1; }
export class Refused extends Error { code = 'x'; }
export const Order = {
  DEFAULT: 1,
  skipIf(): boolean { return false; },
  get current(): number { return 1; },
};
export enum Code { INVALID = 'INVALID', LATE = 'LATE' }
export const LIST = [1, 2];
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
      'field secret',
      'method [Symbol.iterator]',
    ]) {
      expect(line).toContain(member);
    }
  });

  it('records no #private member', async () => {
    const [line] = await surfaceOf(BASE);
    expect(line).not.toContain('#hidden');
    expect(await moves(BASE.replaceAll('#hidden', '#concealed'))).toBe(false);
  });

  it('moves when a TypeScript private field is renamed', async () => {
    expect(await moves(BASE.replace('private secret = 0;', 'private kept = 0;'))).toBe(true);
  });

  it('records no member of the language on an Error subclass or an async or generator function', async () => {
    const [line] = await surfaceOf(BASE);
    expect(line).toContain('Refused{field code}');
    expect(line).toMatch(/,settle,/);
    expect(line).toMatch(/,stream,/);
    expect(line).toMatch(/,walk$/);
  });

  it('moves when a well-known symbol member is removed', async () => {
    expect(await moves(BASE.replace('*[Symbol.iterator](): Iterator<number> { yield this.#hidden; }', ''))).toBe(true);
  });

  it('names the keys of a plain object export with their kinds, and of an enum', async () => {
    const [line] = await surfaceOf(BASE);
    expect(line).toContain('Order{field DEFAULT,field skipIf,get current}');
    expect(line).toContain('Code{field INVALID,field LATE}');
    expect(line).toMatch(/,LIST,/);
  });

  it('moves when a plain object export or an enum loses a key', async () => {
    expect(await moves(BASE.replace('DEFAULT: 1,', ''))).toBe(true);
    expect(await moves(BASE.replace(", LATE = 'LATE'", ''))).toBe(true);
  });

  it('does not move when a plain object value changes', async () => {
    expect(await moves(BASE.replace('DEFAULT: 1,', 'DEFAULT: 2,'))).toBe(false);
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
    // What a game can call on Piece is unchanged. The whole hash still moves,
    // because Base's own line gains the member; this checks Piece's line only.
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
