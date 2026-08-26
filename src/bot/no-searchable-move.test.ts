/**
 * A bot with nothing it can search must stall its own seat, not the table (#29).
 *
 * `runSearch` builds its sandbox from the bot's OWN seat's redacted payload —
 * which is right, a bot must search its own information state — and enumerates
 * the root moves from that sandbox. When per-seat redaction removes exactly the
 * state the seat's only action derives its choices from, the sandbox enumerates
 * nothing while the authoritative game offers a full move list.
 *
 * That used to `throw new Error('No available moves')`, and the throw escaped
 * all the way out: `handleBotTurn` did not guard it, so it left `executeOp` as a
 * raw exception; the dev host logged it and returned; the covered seat never
 * acted; and a simultaneousActionStep could not close its round, so every other
 * seat at the table waited forever. Bot cover is not opt-in — a page reload in
 * dev is a disconnect — so this was reachable with no bot flag anywhere.
 *
 * A stall the host can report is not a fix for the underlying redaction gap
 * (see #19/#31), but it is the difference between one seat idling and a locked
 * session.
 */
import { describe, it, expect } from 'vitest';
import { Game, Space, Piece, Player, Action, defineFlow, actionStep, type GameOptions } from '../engine/index.js';
import { createBot } from './index.js';
import { GameRunner } from '../runtime/runner.js';

class Secret extends Piece<BlindGame, Player> {}
class Vault extends Space<BlindGame, Player> {}

/**
 * The seat's only action chooses from a hidden zone's contents, and the zone is
 * hidden from that very seat — so its own redacted view offers no choices.
 */
class BlindGame extends Game<BlindGame, Player> {
  vault!: Vault;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Secret, Vault]);
    this.vault = this.create(Vault, 'vault');
    this.vault.createMany(3, Secret, 'secret');
    this.vault.contentsHidden();

    this.registerAction(
      Action.create('reveal')
        .prompt('Reveal')
        .chooseElement('secret', { from: (ctx) => (ctx.game as BlindGame).vault })
        .execute(() => {})
    );
    this.setFlow(defineFlow({ root: actionStep({ actions: ['reveal'] }) }));
  }
}

function blindBot() {
  const runner = new GameRunner({
    GameClass: BlindGame,
    gameType: 'blind',
    gameOptions: { playerCount: 2, playerNames: ['A', 'B'], seed: 'blind' },
  });
  runner.start();
  return createBot(runner.game, BlindGame, 'blind', 1, runner.actionHistory, 'easy');
}

describe('a bot whose own information state offers no move', () => {
  it('resolves to null instead of throwing', async () => {
    await expect(blindBot().play()).resolves.toBeNull();
  });

  it('says why, so the host can report the stall rather than guess at it', async () => {
    const bot = blindBot();
    await bot.play();
    expect(bot.lastStallReason).toMatch(/information state|no move/i);
  });

  it('does the same through playWithStats, with an empty stats array', async () => {
    const result = await blindBot().playWithStats();
    expect(result.move).toBeNull();
    expect(result.stats).toEqual([]);
  });
});

describe('a bot that CAN see its choices is unaffected', () => {
  class OpenGame extends Game<OpenGame, Player> {
    vault!: Vault;
    constructor(options: GameOptions) {
      super(options);
      this.registerElements([Secret, Vault]);
      this.vault = this.create(Vault, 'vault');
      this.vault.createMany(3, Secret, 'secret');
      this.registerAction(
        Action.create('reveal')
          .prompt('Reveal')
          .chooseElement('secret', { from: (ctx) => (ctx.game as OpenGame).vault })
          .execute(() => {})
      );
      this.setFlow(defineFlow({ root: actionStep({ actions: ['reveal'] }) }));
    }
  }

  it('still returns a move', async () => {
    const runner = new GameRunner({
      GameClass: OpenGame,
      gameType: 'open',
      gameOptions: { playerCount: 2, playerNames: ['A', 'B'], seed: 'open' },
    });
    runner.start();
    const bot = createBot(runner.game, OpenGame, 'open', 1, runner.actionHistory, 'easy');
    const move = await bot.play();
    expect(move).not.toBeNull();
    expect(move!.action).toBe('reveal');
    expect(bot.lastStallReason).toBeUndefined();
  });
});
