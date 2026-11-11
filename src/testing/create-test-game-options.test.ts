/**
 * `createTestGame` starts a game with every option the project declares in
 * `boardsmith.json` (#701), so a game reads `options.x` without repeating its
 * default in code, and its tests play the game production plays. The project is
 * the nearest boardsmith.json at or above the directory vitest runs in; outside
 * any game project and outside BoardSmith's own checkout, that is an error.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Game, Player, Action, actionStep, type GameOptions } from '../engine/index.js';
import { createTestGame } from './test-game.js';
import { projectGameOptions } from '#testing/project-game-options';
import { tempTree } from './temp-tree.test-helper.js';

class OptionsGame extends Game<OptionsGame, Player> {
  rounds: unknown;
  lootScale: unknown;
  constructor(options: GameOptions & { rounds?: number; lootScale?: number }) {
    super(options);
    this.rounds = options.rounds;
    this.lootScale = options.lootScale;
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow({ root: actionStep({ actions: ['pass'], player: (ctx) => ctx.game.getPlayer(1)! }) });
  }
}

const home = process.cwd();
afterEach(() => process.chdir(home));

/** Runs the test from `under` inside a project whose boardsmith.json holds `config`. */
function inProject(config: Record<string, unknown>, under = '.'): void {
  const dir = tempTree('bs-test-game-options-');
  writeFileSync(join(dir, 'boardsmith.json'), JSON.stringify({ name: 'options', backend: 'table', ...config }));
  mkdirSync(join(dir, under), { recursive: true });
  process.chdir(join(dir, under));
}

const gameOptions = [
  { id: 'rounds', type: 'number', label: 'Rounds', default: 3 },
  { id: 'lootScale', type: 'number', label: 'Loot scale', default: 1, designerOnly: true },
];

/** A game palette whose fourth colour is not the engine default's fourth (#1552). */
const colorPalette = [
  { id: 'red', hex: '#E74C3C', label: 'Red' },
  { id: 'blue', hex: '#3498DB', label: 'Blue' },
  { id: 'green', hex: '#27AE60', label: 'Green' },
  { id: 'orange', hex: '#E67E22', label: 'Orange' },
  { id: 'purple', hex: '#9B59B6', label: 'Purple' },
];

describe('createTestGame fills the options boardsmith.json declares (#701)', () => {
  it('an option the test does not pass, designer-only or not, is its default', () => {
    inProject({ gameOptions });
    const { game } = createTestGame(OptionsGame, { playerCount: 1 });
    expect([game.rounds, game.lootScale]).toEqual([3, 1]);
  });

  it('an option the test passes is kept', () => {
    inProject({ gameOptions });
    const { game } = createTestGame(OptionsGame, { playerCount: 1, rounds: 7 });
    expect([game.rounds, game.lootScale]).toEqual([7, 1]);
  });

  it('a boardsmith.json whose options are unusable is refused, naming the problem', () => {
    inProject({ gameOptions: [{ id: 'rounds', type: 'number', label: 'Rounds' }] });
    expect(() => createTestGame(OptionsGame, { playerCount: 1 })).toThrow(/"rounds" with no default/);
  });

  it('reads the project\'s boardsmith.json from a folder inside the project, such as tests/', () => {
    inProject({ gameOptions }, 'tests/unit');
    const { game } = createTestGame(OptionsGame, { playerCount: 1 });
    expect([game.rounds, game.lootScale]).toEqual([3, 1]);
  });

  it('plays with the options boardsmith.json holds now, after it changes, even when modules are not reloaded (#1307)', () => {
    // A watch-mode rerun that does not re-evaluate modules must still see the edited file.
    inProject({ gameOptions });
    createTestGame(OptionsGame, { playerCount: 1 });
    writeFileSync('boardsmith.json', JSON.stringify({ name: 'options', backend: 'table', gameOptions: [{ ...gameOptions[0], default: 5 }] }));
    const { game } = createTestGame(OptionsGame, { playerCount: 1 });
    expect(game.rounds).toBe(5);
  });

  it('seats players in the colours boardsmith.json\'s colorPalette declares, as a host does (#1552)', () => {
    inProject({ colorPalette });
    const { game } = createTestGame(OptionsGame, { playerCount: 4 });
    expect(game.all(Player).map((p) => [p.color, p.colorLabel])).toEqual([
      ['#E74C3C', 'Red'], ['#3498DB', 'Blue'], ['#27AE60', 'Green'], ['#E67E22', 'Orange'],
    ]);
  });

  it('reads the palette shapes the dev host reads: plain hex strings, and labels named label or name (#1552)', () => {
    inProject({ colorPalette: ['#E74C3C', { color: '#3498DB', name: 'Sea' }] });
    const { game } = createTestGame(OptionsGame, { playerCount: 2 });
    expect(game.all(Player).map((p) => [p.color, p.colorLabel])).toEqual([['#E74C3C', '#E74C3C'], ['#3498DB', 'Sea']]);
  });

  it('a palette with fewer colours than seats leaves every seat in the engine palette, as the dev host does (#1552)', () => {
    inProject({ colorPalette: colorPalette.slice(0, 2) });
    const { game } = createTestGame(OptionsGame, { playerCount: 3 });
    expect(game.all(Player).map((p) => p.color)).toEqual(['#e74c3c', '#3498db', '#27ae60']);
  });

  it('a colorPalette that is not a list is refused, naming the shape, but only where colours are wanted (#1552)', () => {
    inProject({ gameOptions, colorPalette: { red: '#E74C3C' } });
    expect(() => createTestGame(OptionsGame, { playerCount: 1 })).toThrow(/"colorPalette" must be a list of \{ "id", "hex", "label" \}/);
    expect(projectGameOptions()).toMatchObject({ rounds: { default: 3 } });
  });

  it('refuses to start outside any game project, rather than leave the options out', () => {
    process.chdir(tempTree('bs-test-game-no-project-'));
    expect(() => createTestGame(OptionsGame, { playerCount: 1 })).toThrow(
      /No boardsmith\.json in .* or any folder above it.*Run the tests from inside the game project/,
    );
  });
});
