/**
 * `createTestGame` starts a game with every option the project declares in
 * `boardsmith.json` (#701), so a game reads `options.x` without repeating its
 * default in code, and its tests play the game production plays. The project is
 * the directory vitest runs in, as for every project file a test helper reads.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
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

/** Runs the test from a project whose boardsmith.json holds `config`. */
function inProject(config: Record<string, unknown>): void {
  const dir = tempTree('bs-test-game-options-');
  writeFileSync(join(dir, 'boardsmith.json'), JSON.stringify({ name: 'options', backend: 'table', ...config }));
  process.chdir(dir);
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
});
