import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { applyViewPatch, diffView, patchView, stampRev } from './view-patch.js';
import pkg from '../../package.json';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const entry = (pkg.exports as Record<string, { types?: string }>)['./view-patch']?.types;
// Built once, at the top of the file, where no test timeout applies: the flags of Nuxt's default tsconfig (#1624).
const consumer = entry === undefined ? undefined : ts.createProgram([path.join(ROOT, entry)], {
  target: ts.ScriptTarget.ES2022,
  lib: ['lib.es2022.d.ts'],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noUncheckedIndexedAccess: true,
  noImplicitOverride: true,
  verbatimModuleSyntax: true,
  types: [],
  noEmit: true,
});

// #1616: a push carries what changed in a seat's view, not the whole view.

/** `to`, rebuilt from `from` and the patch between them. */
function roundTrip(from: unknown, to: unknown): unknown {
  return patchView(from, diffView(from, to));
}

describe('diffView and patchView', () => {
  const cases: Array<[string, unknown, unknown]> = [
    ['a changed leaf', { a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 } }],
    ['an added and a removed key', { a: 1, b: 2 }, { a: 1, c: 3 }],
    ['an appended array item', { log: ['x', 'y'] }, { log: ['x', 'y', 'z'] }],
    ['a truncated array', { log: ['x', 'y', 'z'] }, { log: ['x'] }],
    ['an item inserted mid-array', { hand: [1, 2, 4] }, { hand: [1, 2, 3, 4] }],
    ['an item removed mid-array', { hand: [1, 2, 3, 4] }, { hand: [1, 3, 4] }],
    ['lines pruned from the front and one appended', { log: ['a', 'b', 'c', 'd'] }, { log: ['c', 'd', 'e'] }],
    ['a deep change inside an array item', { children: [{ id: 1, at: { x: 1 } }, { id: 2 }] }, { children: [{ id: 1, at: { x: 2 } }, { id: 2 }] }],
    ['an array becoming an object', { v: [1] }, { v: { 0: 1 } }],
    ['a null becoming an object', { v: null }, { v: { a: 1 } }],
    ['a whole new root', [1, 2], { a: 1 }],
    ['an emptied array', { log: ['a'] }, { log: [] }],
  ];

  it.each(cases)('rebuilds the new view exactly: %s', (_name, from, to) => {
    expect(roundTrip(from, to)).toEqual(to);
  });

  it('sets a key named __proto__ as a key, as JSON.parse reads one (#1616 review F8)', () => {
    const from = JSON.parse('{"names":{"a":1}}');
    const to = JSON.parse('{"names":{"a":1,"__proto__":2}}');
    const next = roundTrip(from, to) as { names: Record<string, number> };
    expect(Object.keys(next.names)).toEqual(['a', '__proto__']);
    expect(Object.getPrototypeOf(next.names)).toBe(Object.prototype);
  });

  it('says nothing about a view that did not change', () => {
    expect(diffView({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toEqual([]);
  });

  it('carries only the changed leaf, not its container', () => {
    const big = Array.from({ length: 50 }, (_, i) => ({ id: i, name: `card ${i}` }));
    const ops = diffView({ deck: big }, { deck: big.map((card) => (card.id === 7 ? { ...card, name: 'drawn' } : card)) });
    expect(ops).toEqual([['set', ['deck', 7, 'name'], 'drawn']]);
  });

  it('carries only the new lines when old ones are pruned from the front', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    expect(diffView({ log: lines }, { log: [...lines.slice(5), 'line 30'] })).toEqual([
      ['splice', ['log'], 0, 5, []],
      ['splice', ['log'], 25, 0, ['line 30']],
    ]);
  });

  it('keeps every unchanged subtree as the same object, and never touches the held view', () => {
    const from = { players: [{ seat: 1, score: 3 }, { seat: 2, score: 5 }], board: { cells: [1, 2] } };
    const held = structuredClone(from);
    const next = patchView(from, diffView(from, { ...from, players: [from.players[0], { seat: 2, score: 6 }] })) as typeof from;
    expect(next.board).toBe(from.board);
    expect(next.players[0]).toBe(from.players[0]);
    expect(next.players[1]).not.toBe(from.players[1]);
    expect(from).toEqual(held);
  });
});

describe('applyViewPatch', () => {
  const v1 = stampRev({ state: { board: 'a' } });
  const v2 = stampRev({ state: { board: 'b' } });

  it('applies a patch to the view it was made against', () => {
    expect(applyViewPatch(v1, { base: v1.rev, ops: diffView(v1, v2) })).toEqual(v2);
  });

  it('refuses a patch made against a view the page does not hold', () => {
    const v3 = stampRev({ state: { board: 'c' } });
    expect(applyViewPatch(v1, { base: v2.rev, ops: diffView(v2, v3) })).toBeUndefined();
    expect(applyViewPatch(undefined, { base: v2.rev, ops: diffView(v2, v3) })).toBeUndefined();
  });
});

describe('stampRev', () => {
  it('names a view by its content, whatever rev it carried', () => {
    const view = { state: { board: 'a' } };
    expect(stampRev({ ...view, rev: 'stale' }).rev).toBe(stampRev(view).rev);
    expect(stampRev({ state: { board: 'b' } }).rev).not.toBe(stampRev(view).rev);
  });
});

describe('boardsmith/view-patch', () => {
  it('reaches only view-patch.ts, so a consumer compiles nothing else of the engine (#1624)', () => {
    expect(pkg.exports['./view-patch']).toEqual({ types: './src/session/view-patch.ts', import: './src/session/view-patch.ts' });
    const files = consumer!.getSourceFiles().filter((f) => !consumer!.isSourceFileDefaultLibrary(f));
    expect(files.map((f) => path.relative(ROOT, f.fileName))).toEqual(['src/session/view-patch.ts']);
  });

  it('typechecks under a consumer\'s strict and noUncheckedIndexedAccess (#1624)', () => {
    const errors = ts.getPreEmitDiagnostics(consumer!).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    expect(errors).toEqual([]);
  });
});
