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

  it('refuses to start outside any game project, rather than leave the options out', () => {
    process.chdir(tempTree('bs-test-game-no-project-'));
    expect(() => createTestGame(OptionsGame, { playerCount: 1 })).toThrow(
      /No boardsmith\.json in .* or any folder above it.*Run the tests from inside the game project/,
    );
  });
});
