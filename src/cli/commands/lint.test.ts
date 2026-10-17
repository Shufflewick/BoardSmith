/**
 * `boardsmith lint`'s heuristic rules run on raw text, not on an AST, so each
 * one has to be narrow enough that a false positive is rarer than a real hit.
 *
 * The element-equality rule was not (#34): it matched any of a handful of
 * domain words appearing anywhere to the right of `===`, which meant it fired
 * on `a.id === card.id` — the exact pattern its own message recommends. On a
 * clean codebase that produced 111 warnings of pure noise, which is how a team
 * learns to ignore lint output. The AST rule that gets this right already
 * exists as the ESLint plugin's `no-element-identity-comparison`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lintCommand, lintFile } from './lint.js';
import { runTool } from '../lib/run-tool.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

// The config tests only need to see which tool lint hands off to, not run a real linter.
vi.mock('../lib/run-tool.js', () => ({ runTool: vi.fn(async () => 0) }));

const rulesFor = (code: string): string[] =>
  lintFile('game.ts', code).map((issue) => issue.rule);

describe('element identity comparison is left to the AST rule (#34)', () => {
  it.each([
    'const same = m.id === merc.id;',
    'const same = c.id === card.id;',
    'const same = s.sectorId === sectorId;',
    'const same = a.id === piece.id;',
    'const found = squads.find((s) => s.id === squad.id);',
  ])('does not flag the .id comparison it recommends: %s', (code) => {
    expect(rulesFor(code)).not.toContain('element-equality');
  });

  it('leaves no element-equality rule behind to false-positive with', () => {
    // The check is gone entirely rather than tightened — a text regex cannot
    // tell `a === b` on two elements from `a === b` on two numbers, and the
    // plugin rule can.
    expect(rulesFor('const same = cardA === cardB;')).not.toContain('element-equality');
  });
});

describe('element-indexof stays narrow', () => {
  it('flags indexOf on what is plainly an element', () => {
    expect(rulesFor('const i = hand.indexOf(card);')).toContain('element-indexof');
  });

  it('does not flag indexOf on an id, which is a value comparison', () => {
    expect(rulesFor('const i = ids.indexOf(cardId);')).not.toContain('element-indexof');
    expect(rulesFor('const i = ids.indexOf(sectorId);')).not.toContain('element-indexof');
  });
});

describe('the rules that were never the problem still fire', () => {
  it('still flags .includes() on a collection of elements', () => {
    expect(rulesFor('const has = hand.includes(card);')).toContain('element-includes');
  });

  it('leaves ordinary game code alone', () => {
    expect(rulesFor('const total = game.all(Card).length + 1;')).toEqual([]);
  });
});

describe('a selected check with no config fails instead of passing (#846)', () => {
  const originalCwd = process.cwd();
  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);
  });

  it('lint --eslint in a project with no ESLint config exits 1 and names the missing file', async () => {
    const dir = tempTree('boardsmith-lint-no-eslint-');
    writeFileSync(join(dir, 'boardsmith.json'), '{}');
    process.chdir(dir);
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.join(' ')); });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit ${code}`); });

    await expect(lintCommand({ eslint: true })).rejects.toThrow('exit 1');
    expect(errors.join('\n')).toContain('eslint.config.mjs');
    // A game has no docs/ folder, so the advice names the package's own export and a public page.
    expect(errors.join('\n')).toContain('boardsmith/eslint-plugin');
    expect(errors.join('\n')).toContain('https://github.com/Shufflewick/BoardSmith/blob/main/docs/api/eslint-plugin.md');
  });

  it('lint --css in a project with no Stylelint config exits 1 and names the missing file (#1014)', async () => {
    const dir = tempTree('boardsmith-lint-no-stylelint-');
    writeFileSync(join(dir, 'boardsmith.json'), '{}');
    process.chdir(dir);
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.join(' ')); });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit ${code}`); });

    await expect(lintCommand({ css: true })).rejects.toThrow('exit 1');
    expect(errors.join('\n')).toContain('.stylelintrc.cjs');
    // Without postcss-html Stylelint cannot read the <style> blocks of the .vue files it is pointed at.
    expect(errors.join('\n')).toContain('postcss-html');
  });

  it('lint --css accepts a stylelint key in package.json, which Stylelint reads as its config (#1014)', async () => {
    const dir = tempTree('boardsmith-lint-pkg-stylelint-');
    writeFileSync(join(dir, 'boardsmith.json'), '{}');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ stylelint: { customSyntax: 'postcss-html' } }));
    process.chdir(dir);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit ${code}`); });

    await lintCommand({ css: true });
    expect(vi.mocked(runTool)).toHaveBeenCalledWith('stylelint', ['src/**/*.vue'], { cwd: process.cwd() });
  });
});
