/**
 * Nothing outside `Game` reads `settings.winners` (#503).
 *
 * `settings.winners` is where `Game.finish(winners)` keeps the seats it was
 * handed, and `Game.getWinners()` is what reads it back. A game that declares
 * its winners by overriding `getWinners()` never writes it. So a reader that
 * goes to the field directly sees no winner for that game while players are
 * shown one: that is how the MCTS bot and the benchmark once scored such games
 * as draws. Every reader asks `game.getWinners()`.
 *
 * Test files may still inspect the field, to check what `finish()` stored and
 * that undo rolls it back.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = 'src/engine/element/game.ts';
const READ = [
  /settings\s*\??\.\s*winners|settings\s*\??\.?\s*\[\s*['"`]winners['"`]\s*\]/g,
  /\{[^{}]*\bwinners\b[^{}]*\}\s*=\s*[^;=\n]*\bsettings\b(?!\s*\??\.)/g,
];

/** Every read of `settings.winners` in `source`, by the line it starts on. */
function winnersReads(source) {
  const lines = source.split('\n');
  return READ.flatMap((re) => [...source.matchAll(re)])
    .map((m) => source.slice(0, m.index).split('\n').length)
    .sort((a, b) => a - b)
    .map((line) => ({ line, text: lines[line - 1].trim() }));
}

describe('winnersReads', () => {
  it('finds a direct read, an optional read, an indexed read and a destructured read', () => {
    const source = [
      'const a = game.settings.winners;',
      'const b = (game as any).settings?.winners;',
      "const c = game.settings['winners'];",
      'const d = game.getWinners();',
      'const { winners } = game.settings;',
      'const { phase, winners: w } = (game as any).settings;',
      'const {',
      '  winners,',
      '} = this.settings;',
      'const { round } = game.settings;',
    ].join('\n');
    expect(winnersReads(source).map((f) => f.line)).toEqual([1, 2, 3, 5, 6, 7]);
  });
});

describe('settings.winners is read only by Game (#503)', () => {
  it('no shipped source outside Game reads it', () => {
    const sources = execFileSync('git', ['ls-files', 'src'], { cwd: ROOT, encoding: 'utf-8' })
      .split('\n')
      .filter((path) => /\.(?:ts|vue)$/.test(path))
      .filter((path) => !/\.test\.ts$|\.test-helper\.ts$/.test(path))
      .filter((path) => path !== OWNER);
    const findings = sources.flatMap((path) =>
      winnersReads(readFileSync(join(ROOT, path), 'utf-8')).map((f) => `${path}:${f.line}: ${f.text}`),
    );
    expect(findings, 'Read the result with game.getWinners(), which honours a getWinners() override.').toEqual([]);
  });
});
