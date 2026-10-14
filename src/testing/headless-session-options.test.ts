/**
 * `createHeadlessSession` starts a game with every option the project's
 * boardsmith.json declares (#701), as `createTestGame` does and from the same
 * file: a game's tests import its gameDefinition from source, which carries no
 * declarations, so the session reads them from the project.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Game, Player, Action, actionStep, type GameOptions } from '../engine/index.js';
import { createHeadlessSession } from './headless-session.js';
import { selectGameOptions } from '../session/game-option-selection.js';
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

const definition = { gameClass: OptionsGame, gameType: 'options', minPlayers: 1, maxPlayers: 2 };
const gameOptions = [
  { id: 'rounds', type: 'number', label: 'Rounds', default: 3 },
  { id: 'lootScale', type: 'number', label: 'Loot scale', default: 1, designerOnly: true },
];

const home = process.cwd();
afterEach(() => process.chdir(home));

function inProject(): void {
  const dir = tempTree('bs-headless-options-');
  writeFileSync(join(dir, 'boardsmith.json'), JSON.stringify({ name: 'options', backend: 'table', gameOptions }));
  process.chdir(dir);
}

describe('createHeadlessSession fills the options boardsmith.json declares (#701)', () => {
  it('a session started with no options plays every declared option at its default', async () => {
    inProject();
    const session = createHeadlessSession(definition, { playerCount: 1, seed: 's' });
    await session.start();
    const game = session.readGame() as OptionsGame;
    expect([game.rounds, game.lootScale]).toEqual([3, 1]);
  });

  it('a chosen option is kept', async () => {
    inProject();
    const options = selectGameOptions({ rounds: { type: 'number', label: 'Rounds', default: 3 } }, { rounds: 7 });
    const session = createHeadlessSession(definition, { playerCount: 1, seed: 's', options });
    await session.start();
    const game = session.readGame() as OptionsGame;
    expect([game.rounds, game.lootScale]).toEqual([7, 1]);
  });
});
