import { describe, it, expect } from 'vitest';
import { gameModulesLoaded } from './test-step-code-run.js';

/** A project of `files`, read the way test-step-check reads one. */
const projectOf = (files: Record<string, string>) => ({ text: (path: string) => files[path] });

/**
 * #485 ruling (2026-10-03): an exempt chunk's `none (regression)` row is mutation-tested on the game
 * code it loads, since the chunk added none of its own. These are the modules that code is drawn from.
 */
describe('gameModulesLoaded', () => {
  it('follows the game modules a test loads, through support files and src/ imports, nearest first', () => {
    const project = projectOf({
      'tests/pin.test.ts': `import { it } from 'vitest';
import { helper } from './support/game';
import { score } from '../src/rules/score';
import Board from '../src/ui/Board.vue';
it('x', () => { helper(); score(); void Board; });
`,
      'tests/support/game.ts': `import { gameDefinition } from '../../src/rules/index.js';\nexport const helper = () => gameDefinition;\n`,
      'src/rules/index.ts': `export * from './flow';\nimport { score } from './score';\nexport const gameDefinition = { score };\n`,
      'src/rules/flow.ts': `import { deal } from './deck/index';\nexport const flow = () => deal();\n`,
      'src/rules/deck/index.ts': `export const deal = () => 1;\n`,
      'src/rules/score.ts': `export const score = () => 2;\n`,
      'src/ui/Board.vue': `<script setup lang="ts">\nimport { palette } from './theme';\n</script>\n<template><p>{{ palette }}</p></template>\n`,
      'src/ui/theme.ts': `export const palette = 'x';\n`,
    });
    expect(gameModulesLoaded(project.text('tests/pin.test.ts')!, 'tests/pin.test.ts', project)).toEqual([
      { path: 'src/rules/index.ts', depth: 1 },
      { path: 'src/rules/score.ts', depth: 1 },
      { path: 'src/ui/Board.vue', depth: 1 },
      { path: 'src/rules/flow.ts', depth: 2 },
      { path: 'src/ui/theme.ts', depth: 2 },
      { path: 'src/rules/deck/index.ts', depth: 3 },
    ]);
  });

  it('leaves out what runs no game code: types, text, packages, test files and declarations', () => {
    const project = projectOf({
      'tests/pin.test.ts': `import type { Bid } from '../src/rules/types';
import raw from '../src/rules/auction.ts?raw';
import { createTestGame } from 'boardsmith/testing';
import { shared } from '../src/rules/shared.test';
import { decl } from '../src/rules/globals';
import { bid } from '../src/rules/auction';
void raw; void createTestGame; void shared; void decl; void bid;
`,
      'src/rules/types.ts': `export type Bid = number;\n`,
      'src/rules/auction.ts': `export const bid = 1;\n`,
      'src/rules/shared.test.ts': `export const shared = 1;\n`,
      'src/rules/globals.d.ts': `export declare const decl: number;\n`,
    });
    expect(gameModulesLoaded(project.text('tests/pin.test.ts')!, 'tests/pin.test.ts', project)).toEqual([
      { path: 'src/rules/auction.ts', depth: 1 },
    ]);
  });

  it('counts every way of loading a module: dynamic import, require, vi.importActual and an automock', () => {
    const project = projectOf({
      'tests/pin.test.ts': `import { vi } from 'vitest';
vi.mock('../src/rules/a', { spy: true });
await import('../src/rules/b');
require('../src/rules/c');
await vi.importActual('../src/rules/d');
`,
      'src/rules/a.ts': 'export const a = 1;\n',
      'src/rules/b.ts': 'export const b = 1;\n',
      'src/rules/c.ts': 'export const c = 1;\n',
      'src/rules/d.ts': 'export const d = 1;\n',
    });
    expect(gameModulesLoaded(project.text('tests/pin.test.ts')!, 'tests/pin.test.ts', project).map((m) => m.path)).toEqual([
      'src/rules/a.ts',
      'src/rules/b.ts',
      'src/rules/c.ts',
      'src/rules/d.ts',
    ]);
  });
});
